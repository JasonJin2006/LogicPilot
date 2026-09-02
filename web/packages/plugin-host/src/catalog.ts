// Plugin catalog discovery (Phase 2B-1, ADR-0071): the Node-side scanner
// produces a catalog envelope over the frozen PluginManifest contract; this
// module is the browser-safe half - catalog payload validation and the
// RemoteCatalogDiscoverySource that feeds the transactional PluginHost.
//
// The envelope itself is a FROZEN contract
// (schemas/contracts/plugin-catalog.schema.json, ADR-0069 §1): the payload is
// validated with the generated validator, then checked for cross-entity
// consistency (entry id == manifest id, rootId references a root of the same
// scope, safe relative paths) that JSON Schema cannot express.
//
// Scope layering stays with the host (ADR-0070 §3): one source per scope,
// each projection computed per scope (cross-scope dependency resolution is a
// documented Phase 2B-2 limitation, see ADR-0071 §7).

import type { PluginManifest } from '@logicpilot/contracts';
import { resolveActivationOrder, satisfiesRange, validateContract } from '@logicpilot/contracts';
import type {
  PluginCatalog,
  PluginCatalogDiagnostic,
  PluginCatalogDiagnosticKind,
  PluginCatalogEntry,
  PluginScope,
} from '@logicpilot/contracts';
import type { DiscoveredPlugin, DiscoverySource, PluginModule } from './host.js';

// The generated contract types are re-exported so the host package stays the
// single import point for shells (the types are frozen, not host-owned).
export type {
  PluginCatalog,
  PluginCatalogDiagnostic,
  PluginCatalogDiagnosticKind,
  PluginCatalogEntry,
  PluginCatalogRoot,
  PluginScope,
} from '@logicpilot/contracts';

export const PLUGIN_CATALOG_BRIDGE = 'logicpilot.plugin-catalog/v1';

export type PluginCatalogPayloadValidation =
  | { readonly ok: true; readonly value: PluginCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

const PLUGIN_SCOPES: readonly PluginScope[] = ['system', 'user', 'workspace'];

export function isPluginScope(value: unknown): value is PluginScope {
  return typeof value === 'string' && (PLUGIN_SCOPES as readonly string[]).includes(value);
}

/** A canonical catalog path: posix, relative, no Windows drive prefix, no
 *  backslash, no empty/'.'/'..' segments, no trailing slash. The frozen
 *  schema pattern already rejects these; this is the code-level guard for
 *  consumers that only see parsed values. */
function isSafeCatalogPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Structural validation of a bridge payload (frozen contract) plus the
 *  cross-entity consistency checks JSON Schema cannot express. Any violation
 *  rejects the WHOLE catalog (defense in depth: the source never forwards
 *  partial data, and a malformed bridge is a transport error). */
export function parsePluginCatalogPayload(value: unknown): PluginCatalogPayloadValidation {
  const validated = validateContract('PluginCatalog', value);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  const catalog = validated.value;
  const errors: string[] = [];
  const rootById = new Map(catalog.roots.map((root) => [root.id, root]));

  for (const [index, entry] of catalog.entries.entries()) {
    if (entry.id !== entry.manifest.id) {
      errors.push(
        `entries[${index}].id '${entry.id}' does not match manifest.id '${entry.manifest.id}'`,
      );
    }
    if (!isSafeCatalogPath(entry.path)) {
      errors.push(`entries[${index}].path '${entry.path}' is not a safe relative path`);
    }
    const root = rootById.get(entry.rootId);
    if (!root) {
      errors.push(`entries[${index}].rootId '${entry.rootId}' does not reference a known root`);
    } else if (root.scope !== entry.scope) {
      errors.push(
        `entries[${index}].scope '${entry.scope}' does not match root '${entry.rootId}' scope '${root.scope}'`,
      );
    }
  }

  for (const [index, diagnostic] of catalog.diagnostics.entries()) {
    if (diagnostic.path !== undefined && !isSafeCatalogPath(diagnostic.path)) {
      errors.push(`diagnostics[${index}].path is not a safe relative path`);
    }
    if (diagnostic.rootId && !rootById.has(diagnostic.rootId)) {
      errors.push(
        `diagnostics[${index}].rootId '${diagnostic.rootId}' does not reference a known root`,
      );
    }
    if (diagnostic.scope && diagnostic.rootId) {
      const root = rootById.get(diagnostic.rootId);
      if (root && root.scope !== diagnostic.scope) {
        errors.push(`diagnostics[${index}].scope does not match its root's scope`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: catalog };
}

// ---------------------------------------------------------------------------
// Loader policy (Phase 2B-1)
// ---------------------------------------------------------------------------

const noOpModule: PluginModule = { activate() {} };

function lazyModule(loader: () => Promise<PluginModule>): PluginModule {
  let loaded: PluginModule | null = null;
  return {
    activate: async (ctx) => {
      loaded = await loader();
      await loaded.activate(ctx);
    },
    deactivate: async () => {
      await loaded?.deactivate?.();
    },
  };
}

/** Default loader policy: plugins without an executable entrypoint (data-only
 *  or manifest-only) activate as no-op modules; executable entrypoints wait
 *  for the Phase 2B-3 loader. */
export function defaultCatalogEntryLoader(entry: PluginCatalogEntry): PluginModule | undefined {
  const entrypoints = entry.manifest.entrypoints;
  if (
    entrypoints.web !== undefined ||
    entrypoints.node !== undefined ||
    entrypoints.wasm !== undefined ||
    entrypoints.native !== undefined
  ) {
    return undefined;
  }
  return noOpModule;
}

// ---------------------------------------------------------------------------
// Activation-safe projection
// ---------------------------------------------------------------------------

export interface PluginCatalogExcludedEntry {
  readonly entry: PluginCatalogEntry;
  readonly reason: string;
}

export interface PluginCatalogProjection {
  readonly entries: readonly PluginCatalogEntry[];
  readonly excluded: readonly PluginCatalogExcludedEntry[];
  readonly diagnostics: readonly PluginCatalogDiagnostic[];
}

/** Projects a per-scope entry set to the subset that can be handed to the
 *  transactional host: unloadable entries, entries with missing non-optional
 *  dependencies, entries in dependency cycles and entries with unsatisfied
 *  dependency ranges are removed together with their dependents. Iterates to
 *  a fixpoint (the initial entry count is the natural pass bound); if the set
 *  cannot be reduced, it FAILS CLOSED instead of leaking an inconsistent
 *  entry to the host. Keeps the host transactional (ADR-0070 §4): a bad
 *  catalog entry never rolls back the bundled plugin set. */
export function projectCatalogEntries(
  entries: readonly PluginCatalogEntry[],
  isLoadable: (entry: PluginCatalogEntry) => boolean,
): PluginCatalogProjection {
  const excluded = new Map<string, PluginCatalogExcludedEntry>();
  const diagnostics: PluginCatalogDiagnostic[] = [];
  const set = new Map<string, PluginCatalogEntry>();

  const exclude = (
    entry: PluginCatalogEntry,
    reason: string,
    kind: PluginCatalogDiagnosticKind,
  ): void => {
    if (excluded.has(entry.id)) return;
    excluded.set(entry.id, { entry, reason });
    diagnostics.push({
      severity: 'error',
      kind,
      message: reason,
      scope: entry.scope,
      rootId: entry.rootId,
      path: entry.path,
      pluginId: entry.id,
    });
  };

  // Deduplicate by id (in-scope duplicates must never reach the host).
  for (const entry of entries) {
    if (set.has(entry.id)) {
      exclude(
        entry,
        `duplicate plugin id '${entry.id}' within scope '${entry.scope}' (kept the earlier occurrence)`,
        'duplicate-id',
      );
      continue;
    }
    set.set(entry.id, entry);
  }

  // Unloadable entries: reported, then dependents cascade via the closure below.
  for (const [id, entry] of [...set]) {
    if (!isLoadable(entry)) {
      exclude(
        entry,
        `entrypoint is not loadable in this host (dynamic web/node/wasm/native loading arrives in Phase 2B-3)`,
        'loadable',
      );
      set.delete(id);
    }
  }

  // Iterate to a fixpoint; each pass removes at least one entry or stops, so
  // the initial entry count is a valid upper bound of the pass number.
  const maxPasses = set.size + 1;
  let converged = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (set.size === 0) {
      converged = true;
      break;
    }
    // Closure: no entry may depend (non-optionally) on a missing entry.
    const missingDependents = new Set<string>();
    for (const entry of set.values()) {
      for (const dependency of entry.manifest.requires) {
        if (dependency.optional || set.has(dependency.id)) continue;
        missingDependents.add(entry.id);
        exclude(entry, `missing non-optional dependency '${dependency.id}'`, 'dependency');
        break;
      }
    }
    if (missingDependents.size > 0) {
      for (const id of missingDependents) set.delete(id);
      continue;
    }

    // Version ranges must be satisfied by the remaining set.
    const conflictingDependents = new Set<string>();
    for (const entry of set.values()) {
      for (const dependency of entry.manifest.requires) {
        const target = set.get(dependency.id);
        if (!target) continue;
        if (!satisfiesRange(target.manifest.version, dependency.range)) {
          conflictingDependents.add(entry.id);
          exclude(
            entry,
            `dependency version conflict: '${entry.id}' requires ${dependency.id}@${dependency.range ?? '*'} but ${target.manifest.version} is installed`,
            'dependency',
          );
          break;
        }
      }
    }
    if (conflictingDependents.size > 0) {
      for (const id of conflictingDependents) set.delete(id);
      continue;
    }

    // Cycles (and, defensively, missing deps the closure missed): drop the
    // reported members, then restart the closure.
    const resolution = resolveActivationOrder([...set.values()].map(toEntryResolution));
    if (resolution.ok) {
      converged = true;
      break;
    }
    const removed = new Set<string>();
    for (const cycle of resolution.cycles) {
      for (const id of cycle.split(' -> ')) {
        const entry = set.get(id);
        if (!entry) continue;
        exclude(entry, `dependency cycle: ${cycle}`, 'dependency');
        removed.add(id);
      }
    }
    for (const missing of resolution.missing) {
      const id = missing.split(' -> ')[0] ?? '';
      const entry = set.get(id);
      if (!entry) continue;
      exclude(entry, `missing dependency: ${missing}`, 'dependency');
      removed.add(id);
    }
    if (removed.size === 0) break; // No reduction possible: fail closed below.
    for (const id of removed) set.delete(id);
  }

  if (!converged) {
    // Fail closed: never leak an internally-inconsistent entry to the host.
    for (const entry of [...set.values()]) {
      exclude(entry, 'dependency projection did not converge', 'dependency');
      set.delete(entry.id);
    }
  }

  return { entries: [...set.values()], excluded: [...excluded.values()], diagnostics };
}

function toEntryResolution(entry: PluginCatalogEntry): {
  id: string;
  version: string;
  provides: readonly string[];
  requires: readonly { id: string; range?: string; optional?: boolean }[];
} {
  return {
    id: entry.id,
    version: entry.manifest.version,
    provides: entry.manifest.provides,
    requires: entry.manifest.requires,
  };
}

// ---------------------------------------------------------------------------
// Remote discovery source
// ---------------------------------------------------------------------------

export interface CatalogFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type CatalogFetch = (
  url: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<CatalogFetchResponse>;

export interface RemoteCatalogDiscoverySourceOptions {
  /** Bridge URL (same-origin or the desktop app-server base). */
  readonly url: string;
  readonly scope: PluginScope;
  /** Optional per-entry loader. Defaults to the Phase 2B-1 policy. */
  readonly resolveLoader?: (entry: PluginCatalogEntry) => PluginModule | undefined;
  /** Optional lazy loader for Node-side dynamic modules. The callback is
   *  invoked only after projection; its returned promise is awaited during
   *  activation, keeping discovery synchronous and side-effect free. */
  readonly resolveAsyncLoader?: (
    entry: PluginCatalogEntry,
  ) => (() => Promise<PluginModule>) | undefined;
  readonly fetch?: CatalogFetch;
  readonly headers?: Readonly<Record<string, string>>;
  /** Fetch the full envelope instead of a server-side scope slice so
   *  dependencies can be projected across discovery layers. */
  readonly includeAllScopes?: boolean;
  /** Already trusted entries (for example statically bundled builtins) that
   *  remote entries may depend on during projection. */
  readonly knownManifests?: readonly PluginManifest[];
  /** Transport failures must never break the host; this observer gets them. */
  readonly onError?: (error: unknown) => void;
}

/** One plugin-catalog source serving a single scope layer. A whole-catalog
 *  fetch is filtered server-side via ?scope=; the projection guarantee
 *  (projectCatalogEntries) applies for the entry's own scope + the loader. */
export class RemoteCatalogDiscoverySource implements DiscoverySource {
  readonly scope: PluginScope;
  private readonly url: string;
  private readonly fetchImpl: CatalogFetch;
  private readonly headers: Readonly<Record<string, string>> | undefined;
  private readonly includeAllScopes: boolean;
  private readonly knownManifests: readonly PluginManifest[];
  private readonly resolveLoader:
    ((entry: PluginCatalogEntry) => PluginModule | undefined) | undefined;
  private readonly resolveAsyncLoader:
    ((entry: PluginCatalogEntry) => (() => Promise<PluginModule>) | undefined) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private errorValue: unknown = undefined;
  private catalogValue: PluginCatalog | null = null;
  private excludedValue: readonly PluginCatalogExcludedEntry[] = [];
  private diagnosticsValue: readonly PluginCatalogDiagnostic[] = [];

  constructor(options: RemoteCatalogDiscoverySourceOptions) {
    this.url = options.url;
    this.scope = options.scope;
    const defaultFetch = (globalThis as { fetch?: CatalogFetch }).fetch;
    this.fetchImpl =
      options.fetch ??
      defaultFetch ??
      (() => {
        throw new Error('no fetch implementation available for remote catalog discovery');
      });
    this.headers = options.headers;
    this.includeAllScopes = options.includeAllScopes ?? false;
    this.knownManifests = options.knownManifests ?? [];
    this.resolveLoader = options.resolveLoader;
    this.resolveAsyncLoader = options.resolveAsyncLoader;
    this.onError = options.onError;
  }

  async discover(): Promise<readonly DiscoveredPlugin[]> {
    this.errorValue = undefined;
    this.catalogValue = null;
    this.excludedValue = [];
    this.diagnosticsValue = [];

    let catalog: PluginCatalog;
    try {
      const response = await this.fetchImpl(
        this.bridgeUrl(),
        this.headers ? { headers: this.headers } : undefined,
      );
      if (!response.ok) {
        throw new Error(`plugin catalog bridge responded with HTTP ${response.status}`);
      }
      const parsed = parsePluginCatalogPayload(await response.json());
      if (!parsed.ok) {
        throw new Error(`invalid plugin catalog payload: ${parsed.errors.join('; ')}`);
      }
      catalog = parsed.value;
    } catch (error) {
      this.errorValue = error;
      try {
        this.onError?.(error);
      } catch {
        // Audit observers must never break the source.
      }
      return [];
    }

    this.catalogValue = catalog;
    this.diagnosticsValue = catalog.diagnostics.filter(
      (diagnostic) => diagnostic.scope === undefined || diagnostic.scope === this.scope,
    );
    const scopeEntries = catalog.entries.filter((entry) => entry.scope === this.scope);
    const knownEntries = this.knownManifests.map((manifest): PluginCatalogEntry => ({
      id: manifest.id,
      scope: 'system',
      rootId: 'system:1',
      path: 'builtin',
      sha256: manifest.integrity?.sha256 ?? '0'.repeat(64),
      manifest,
    }));
    const candidates = this.includeAllScopes ? [...knownEntries, ...catalog.entries] : scopeEntries;
    const loaders = new Map<string, PluginModule>();
    for (const entry of candidates) {
      if (knownEntries.some((known) => known.id === entry.id && known.scope === entry.scope)) {
        loaders.set(entry.id, noOpModule);
        continue;
      }
      const module = this.resolveLoader?.(entry) ?? defaultCatalogEntryLoader(entry);
      if (module) loaders.set(entry.id, module);
      const asyncLoader = this.resolveAsyncLoader?.(entry);
      if (asyncLoader) loaders.set(entry.id, lazyModule(asyncLoader));
    }
    const projection = projectCatalogEntries(candidates, (entry) => loaders.has(entry.id));
    this.excludedValue = projection.excluded;
    this.diagnosticsValue = [...this.diagnosticsValue, ...projection.diagnostics];
    const projectedEntries = projection.entries.filter(
      (entry) =>
        entry.scope === this.scope &&
        catalog.entries.some(
          (candidate) =>
            candidate.id === entry.id &&
            candidate.scope === entry.scope &&
            candidate.rootId === entry.rootId &&
            candidate.path === entry.path,
        ),
    );
    return projectedEntries.map((entry) => ({
      manifest: withCatalogDigest(entry),
      scope: entry.scope,
      load: () => {
        const module = loaders.get(entry.id);
        if (!module) {
          // Unreachable: the projection only keeps entries with a loader.
          throw new Error(`internal: projected entry '${entry.id}' lost its loader`);
        }
        return module;
      },
    }));
  }

  /** Last successfully fetched catalog, or null when discovery never succeeded. */
  catalog(): PluginCatalog | null {
    return this.catalogValue;
  }

  /** Transport/payload error of the latest discover() (undefined when none). */
  lastError(): unknown {
    return this.errorValue;
  }

  /** Entries the projection excluded (before the host ever sees them). */
  excludedEntries(): readonly PluginCatalogExcludedEntry[] {
    return this.excludedValue;
  }

  /** Catalog + projection diagnostics relevant to this source's scope. */
  diagnostics(): readonly PluginCatalogDiagnostic[] {
    return this.diagnosticsValue;
  }

  private bridgeUrl(): string {
    if (this.includeAllScopes) return this.url;
    const separator = this.url.includes('?') ? '&' : '?';
    return `${this.url}${separator}scope=${encodeURIComponent(this.scope)}`;
  }
}

/** The scanner-computed payload digest is authoritative for lockfile
 *  projections; normalize the manifest so host.toLockfile() carries it.
 *  Sha256Hex accepts mixed case, so comparisons are case-insensitive and the
 *  projected value is canonicalized to lowercase. */
function withCatalogDigest(entry: PluginCatalogEntry): PluginManifest {
  const declared = entry.manifest.integrity;
  if (declared && declared.sha256.toLowerCase() === entry.sha256.toLowerCase()) {
    return { ...entry.manifest, integrity: { ...declared, sha256: declared.sha256.toLowerCase() } };
  }
  return { ...entry.manifest, integrity: { sha256: entry.sha256.toLowerCase() } };
}

// Plugin catalog discovery (Phase 2B-1, ADR-0071): the Node-side scanner
// produces a catalog envelope over the frozen PluginManifest contract; this
// module is the browser-safe half - catalog types, payload validation and
// the RemoteCatalogDiscoverySource that feeds the transactional PluginHost.
//
// Scope layering stays with the host (ADR-0070 §3): one source per scope,
// each projection computed per scope (cross-scope dependency resolution is a
// documented Phase 2B-2 limitation, see ADR-0071 §7).

import type { PluginManifest } from '@logicpilot/contracts';
import { resolveActivationOrder, satisfiesRange, validateContract } from '@logicpilot/contracts';
import type { DiscoveredPlugin, DiscoverySource, PluginModule, PluginScope } from './host.js';
import { isJsonObject } from './package-manager.js';

// ---------------------------------------------------------------------------
// Catalog envelope (transport shape, NOT a frozen contract)
// ---------------------------------------------------------------------------

export const PLUGIN_CATALOG_BRIDGE = 'logicpilot.plugin-catalog/v1';

export interface PluginCatalogRoot {
  /** Stable root identity inside the catalog: '<scope>:<index>' (1-based). */
  readonly id: string;
  readonly scope: PluginScope;
}

/** One validated package found by the scanner. */
export interface PluginCatalogEntry {
  readonly id: string;
  /** Effective scope. Set by the containing root - a package cannot claim one. */
  readonly scope: PluginScope;
  /** Containing root id (the catalog never exposes filesystem paths). */
  readonly rootId: string;
  /** Package directory relative to its root, posix-normalized. */
  readonly path: string;
  /** Payload digest (sha256 hex) computed by the scanner. */
  readonly sha256: string;
  readonly manifest: PluginManifest;
}

export type PluginCatalogDiagnosticKind =
  | 'json'
  | 'schema'
  | 'filesystem'
  | 'api-version'
  | 'hash-drift'
  | 'duplicate-id'
  | 'dependency'
  | 'loadable'
  | 'transport';

export interface PluginCatalogDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly kind: PluginCatalogDiagnosticKind;
  readonly message: string;
  readonly scope?: PluginScope;
  readonly rootId?: string;
  readonly path?: string;
  readonly pluginId?: string;
}

export interface PluginCatalog {
  readonly schema: 'logicpilot.plugin-catalog/v1';
  readonly contractVersion: 1;
  readonly roots: readonly PluginCatalogRoot[];
  readonly entries: readonly PluginCatalogEntry[];
  readonly diagnostics: readonly PluginCatalogDiagnostic[];
}

export type PluginCatalogPayloadValidation =
  | { readonly ok: true; readonly value: PluginCatalog }
  | { readonly ok: false; readonly errors: readonly string[] };

const PLUGIN_SCOPES: readonly PluginScope[] = ['system', 'user', 'workspace'];

export function isPluginScope(value: unknown): value is PluginScope {
  return typeof value === 'string' && (PLUGIN_SCOPES as readonly string[]).includes(value);
}

/** Structural validation of a bridge payload (defense in depth: the bridge
 *  is trusted, but the source never forwards partial/malformed catalogs). */
export function parsePluginCatalogPayload(value: unknown): PluginCatalogPayloadValidation {
  if (!isJsonObject(value)) {
    return { ok: false, errors: ['catalog payload is not an object'] };
  }
  const errors: string[] = [];
  if (value.schema !== PLUGIN_CATALOG_BRIDGE) {
    errors.push(`schema: expected ${PLUGIN_CATALOG_BRIDGE}`);
  }
  if (value.contractVersion !== 1) {
    errors.push('contractVersion: expected 1');
  }
  if (!Array.isArray(value.roots)) {
    errors.push('roots: expected an array');
  } else {
    for (const [index, root] of value.roots.entries()) {
      if (!isJsonObject(root)) {
        errors.push(`roots[${index}]: not an object`);
        continue;
      }
      if (typeof root.id !== 'string' || root.id.length === 0) {
        errors.push(`roots[${index}].id: expected a non-empty string`);
      }
      if (!isPluginScope(root.scope)) {
        errors.push(`roots[${index}].scope: invalid plugin scope`);
      }
    }
  }
  if (!Array.isArray(value.entries)) {
    errors.push('entries: expected an array');
  } else {
    for (const [index, entry] of value.entries.entries()) {
      if (!isJsonObject(entry)) {
        errors.push(`entries[${index}]: not an object`);
        continue;
      }
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        errors.push(`entries[${index}].id: expected a non-empty string`);
      }
      if (!isPluginScope(entry.scope)) {
        errors.push(`entries[${index}].scope: invalid plugin scope`);
      }
      if (typeof entry.rootId !== 'string' || entry.rootId.length === 0) {
        errors.push(`entries[${index}].rootId: expected a non-empty string`);
      }
      if (typeof entry.path !== 'string' || entry.path.length === 0) {
        errors.push(`entries[${index}].path: expected a non-empty string`);
      }
      if (typeof entry.sha256 !== 'string' || entry.sha256.length !== 64) {
        errors.push(`entries[${index}].sha256: expected a sha256 hex string`);
      }
      const manifest = validateContract('PluginManifest', entry.manifest);
      if (!manifest.ok) {
        errors.push(`entries[${index}].manifest: ${manifest.errors.join('; ')}`);
      }
    }
  }
  if (!Array.isArray(value.diagnostics)) {
    errors.push('diagnostics: expected an array');
  } else {
    for (const [index, diagnostic] of value.diagnostics.entries()) {
      if (!isJsonObject(diagnostic)) {
        errors.push(`diagnostics[${index}]: not an object`);
        continue;
      }
      if (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') {
        errors.push(`diagnostics[${index}].severity: invalid`);
      }
      if (typeof diagnostic.kind !== 'string' || diagnostic.kind.length === 0) {
        errors.push(`diagnostics[${index}].kind: expected a non-empty string`);
      }
      if (typeof diagnostic.message !== 'string' || diagnostic.message.length === 0) {
        errors.push(`diagnostics[${index}].message: expected a non-empty string`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as unknown as PluginCatalog };
}

// ---------------------------------------------------------------------------
// Loader policy (Phase 2B-1)
// ---------------------------------------------------------------------------

const noOpModule: PluginModule = { activate() {} };

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

const MAX_PROJECTION_PASSES = 8;

/** Projects a per-scope entry set to the subset that can be handed to the
 *  transactional host: unloadable entries, entries with missing non-optional
 *  dependencies, entries in dependency cycles and entries with unsatisfied
 *  dependency ranges are removed together with their dependents. Keeps the
 *  host transactional (ADR-0070 §4): a bad catalog entry never rolls back the
 *  bundled plugin set. */
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

  for (let pass = 0; pass < MAX_PROJECTION_PASSES && set.size > 0; pass++) {
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
    for (const id of missingDependents) set.delete(id);
    if (missingDependents.size > 0) continue;

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
    for (const id of conflictingDependents) set.delete(id);
    if (conflictingDependents.size > 0) continue;

    // Cycles: drop every member of every cycle, then restart the closure.
    const resolution = resolveActivationOrder([...set.values()].map(toEntryResolution));
    if (resolution.ok) break;
    if (resolution.cycles.length > 0) {
      for (const cycle of resolution.cycles) {
        for (const id of cycle.split(' -> ')) {
          const entry = set.get(id);
          if (!entry) continue;
          exclude(entry, `dependency cycle: ${cycle}`, 'dependency');
          set.delete(id);
        }
      }
      continue;
    }
    // Missing deps without cycles cannot survive the closure; bail out safely.
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
  readonly fetch?: CatalogFetch;
  readonly headers?: Readonly<Record<string, string>>;
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
  private readonly resolveLoader:
    ((entry: PluginCatalogEntry) => PluginModule | undefined) | undefined;
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
    this.resolveLoader = options.resolveLoader;
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
    const loaders = new Map<string, PluginModule>();
    for (const entry of scopeEntries) {
      const module = this.resolveLoader?.(entry) ?? defaultCatalogEntryLoader(entry);
      if (module) loaders.set(entry.id, module);
    }
    const projection = projectCatalogEntries(scopeEntries, (entry) => loaders.has(entry.id));
    this.excludedValue = projection.excluded;
    this.diagnosticsValue = [...this.diagnosticsValue, ...projection.diagnostics];
    return projection.entries.map((entry) => ({
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
    const separator = this.url.includes('?') ? '&' : '?';
    return `${this.url}${separator}scope=${encodeURIComponent(this.scope)}`;
  }
}

/** The scanner-computed payload digest is authoritative for lockfile
 *  projections; normalize the manifest so host.toLockfile() carries it. */
function withCatalogDigest(entry: PluginCatalogEntry): PluginManifest {
  const declared = entry.manifest.integrity;
  if (declared && declared.sha256 === entry.sha256) {
    return { ...entry.manifest, integrity: declared };
  }
  return { ...entry.manifest, integrity: { sha256: entry.sha256 } };
}

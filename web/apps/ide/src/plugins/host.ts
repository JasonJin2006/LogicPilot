// IDE PluginHost wiring (Phase 2): the composition root is no longer a
// static import list (ADR-0068 is superseded by the plugin platform plan).
// Builtin paradigms ship as PluginManifest v2 packages under plugins/builtin
// and activate through @logicpilot/plugin-host with dependency-resolved,
// deterministic ordering, trust gating and an append-only audit trail.
//
// Discovery is layered (ADR-0070 §3, ADR-0071):
//   - system: the bundled import map (static map, manifests are the source of
//     truth); a zero-paradigm build (empty table) must still boot, render the
//     shell and edit plain text files - that is the Phase 2 gate;
//   - user/workspace: the Node-side catalog scanner behind the local bridge
//     (GET /api/plugin-catalog). The browser never scans the filesystem; it
//     consumes the validated catalog through RemoteCatalogDiscoverySource.
//     Data-only/manifest-only packages activate as no-op modules; executable
//     entrypoints wait for the Phase 2B-3 loader (ADR-0071 §7).

import {
  PluginHost,
  RemoteCatalogDiscoverySource,
  type CatalogFetch,
  type DiscoveredPlugin,
  type DiscoverySource,
  type PluginModule,
  type PluginScope,
} from '@logicpilot/plugin-host';
import type { PluginManifest } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import { getAppConfig, sessionHeaders } from '../state/appConfig';
import {
  createPluginRegistryVerifier,
  PLUGIN_REGISTRY,
  type PluginRegistryFetchOptions,
  stopPluginRegistryLive,
} from './registry';
import { ARTIFACT_SYNC_QUEUE } from '../artifacts/artifactGraphClient';
import { setModelSemanticFallbackEnabled } from './registries/modelSemantics';
import { setSysMLSemanticFallbackEnabled } from './registries/sysmlSemantics';

// Builtin web entrypoints. Bundlers resolve these statically; the manifest
// `entrypoints.web` field documents the mapping for the packaged (non-bundled)
// host, which loads modules dynamically instead.
import { activateDesPlugin } from './builtin/des/activate';
import desManifestJson from './builtin/des/plugin.json';
import { activateSysmlPlugin } from './builtin/sysml/activate';
import sysmlManifestJson from './builtin/sysml/plugin.json';

interface BuiltinPlugin {
  readonly manifestJson: unknown;
  readonly load: () => PluginModule;
}

const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = [
  { manifestJson: desManifestJson, load: activateDesPlugin },
  { manifestJson: sysmlManifestJson, load: activateSysmlPlugin },
];

/** Validates a bundled manifest against the frozen Phase 1 contract and
 *  fails the build-time caller loudly on drift (never silently skip). */
export function parseBuiltinManifest(json: unknown): PluginManifest {
  const validated = validateContract('PluginManifest', json);
  if (!validated.ok) {
    throw new Error(`builtin plugin manifest rejected: ${validated.errors.join('; ')}`);
  }
  return validated.value;
}

/** Turns a builtin package list into a system-scope discovery source. */
function builtinSourceFor(builtins: readonly BuiltinPlugin[], scope: PluginScope): DiscoverySource {
  return {
    scope,
    discover: () => {
      const discovered: DiscoveredPlugin[] = [];
      for (const builtin of builtins) {
        discovered.push({
          manifest: parseBuiltinManifest(builtin.manifestJson),
          scope,
          load: () => builtin.load(),
        });
      }
      return discovered;
    },
  };
}

export interface IdePluginHostOptions {
  /** Empty table = zero-paradigm shell (the Phase 2 gate exercises this). */
  readonly builtins?: readonly BuiltinPlugin[];
  /** Catalog bridge config. null/omitted = auto (derive from the app server
   *  in a browser; skip in Node/test contexts); an object forces the bridge
   *  (tests inject a stub fetch). */
  readonly catalog?: IdePluginCatalogOptions | null;
  /** Optional structured contribution registry bridge. Omitted auto-derives
   * the same app-server URL/session as catalog discovery. */
  readonly registry?: IdePluginRegistryOptions | null;
}

export interface IdePluginCatalogOptions {
  /** Bridge URL. Default: same-origin '/api/plugin-catalog' (or the desktop
   *  app-server base + path when derived from getAppConfig). */
  readonly url?: string;
  /** Session headers for the production app server (browser only). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Inject a fetch implementation (tests). */
  readonly fetch?: CatalogFetch;
}

export type IdePluginRegistryOptions = PluginRegistryFetchOptions;

const CATALOG_SCOPES: readonly PluginScope[] = ['system', 'user', 'workspace'];

/** Builds one remote source per scope layer. Returns null when the catalog
 *  is disabled (zero-paradigm gate, Node contexts, no app config). */
async function remoteCatalogSources(
  explicit: IdePluginCatalogOptions | null | undefined,
  knownManifests: readonly PluginManifest[],
): Promise<RemoteCatalogDiscoverySource[] | null> {
  if (import.meta.env.VITE_ZERO_PLUGINS === '1' || import.meta.env.VITE_PLUGINS === '0') {
    return null;
  }
  let url: string;
  let headers: Readonly<Record<string, string>> | undefined;
  let fetchImpl: CatalogFetch | undefined;
  if (explicit === null) {
    return null;
  }
  if (explicit !== undefined) {
    url = explicit.url ?? '/api/plugin-catalog';
    headers = explicit.headers;
    fetchImpl = explicit.fetch;
  } else {
    // Browser-only derivation: the Tauri shell and the dev/app server expose
    // the bridge through getAppConfig (apiBase + session token). Node test
    // contexts get null and stay on the bundled sources.
    if (typeof window === 'undefined') return null;
    const config = await getAppConfig();
    if (!config) return null;
    url = `${config.apiBase}/api/plugin-catalog`;
    headers = sessionHeaders(config);
  }
  return CATALOG_SCOPES.map(
    (scope) =>
      new RemoteCatalogDiscoverySource({
        url,
        scope,
        ...(headers !== undefined ? { headers } : {}),
        ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
        includeAllScopes: true,
        knownManifests,
      }),
  );
}

/** Surfaces catalog findings in the append-only audit trail. Errors are
 *  'error' entries; entries the projection excluded before activation are
 *  'deny' entries. Bridge failures also land as 'error' - the shell boots on
 *  the bundled set instead of blanking (ADR-0071 §7). */
function auditCatalogFindings(
  host: PluginHost,
  sources: readonly RemoteCatalogDiscoverySource[],
): void {
  for (const source of sources) {
    const error = source.lastError();
    if (error !== undefined) {
      host.auditLog.append('error', undefined, `[catalog] bridge unavailable: ${String(error)}`);
    }
    for (const diagnostic of source.diagnostics()) {
      if (diagnostic.severity !== 'error') continue;
      host.auditLog.append(
        'error',
        diagnostic.pluginId,
        `[catalog] ${diagnostic.kind}: ${diagnostic.message}`,
      );
    }
    for (const excluded of source.excludedEntries()) {
      host.auditLog.append('deny', excluded.entry.id, `[catalog] ${excluded.reason}`);
    }
  }
}

let host: PluginHost | null = null;
let startPromise: Promise<PluginHost> | null = null;

/** Starts the IDE plugin host. Idempotent: a second call returns the active
 *  host (React StrictMode double-mounts effects in development). */
export async function startIdePluginHost(options: IdePluginHostOptions = {}): Promise<PluginHost> {
  if (host && host.phaseValue === 'active') return host;
  if (startPromise) return startPromise;

  const builtins =
    options.builtins ??
    // Zero-paradigm gate switch (Phase 2): an env flag strips every builtin
    // from discovery so the shell can be exercised with NO plugins at all.
    // Build tooling inlines import.meta.env flags; the default keeps the
    // bundled paradigms.
    (import.meta.env.VITE_ZERO_PLUGINS === '1' || import.meta.env.VITE_PLUGINS === '0'
      ? []
      : BUILTIN_PLUGINS);
  setModelSemanticFallbackEnabled(builtins.length > 0);
  setSysMLSemanticFallbackEnabled(builtins.length > 0);
  const sources: DiscoverySource[] = [builtinSourceFor(builtins, 'system')];
  const remoteSources = await remoteCatalogSources(
    options.catalog,
    builtins.map((builtin) => parseBuiltinManifest(builtin.manifestJson)),
  );
  if (remoteSources) sources.push(...remoteSources);

  const candidate = new PluginHost({
    sources,
    onAudit: (entry) => {
      // Expose a neutral event until the shell grows a persistent audit
      // surface. Dev tools and future audit panels can subscribe without the
      // host taking a dependency on a UI/store module.
      if (import.meta.env.DEV) {
        globalThis.dispatchEvent(new CustomEvent('logicpilot:plugin-audit', { detail: entry }));
      }
    },
  });
  host = candidate;
  startPromise = candidate
    .start()
    .then((activated) => {
      auditCatalogFindings(candidate, remoteSources ?? []);
      return refreshIdePluginRegistry(options.registry)
        .catch((error) => {
          candidate.auditLog.append(
            'error',
            undefined,
            `[registry] bridge unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .then(() => {
          void ARTIFACT_SYNC_QUEUE.drain();
          if (typeof window !== 'undefined' && options.registry !== null) {
            const configPromise = options.registry
              ? Promise.resolve(
                  options.registry.fetch
                    ? null
                    : {
                        url: (options.registry.url ?? '/api/plugin-registry').replace(
                          /\/?$/,
                          '/stream',
                        ),
                        headers: options.registry.headers,
                      },
                )
              : getAppConfig().then((config) =>
                  config
                    ? {
                        url: `${config.apiBase}/api/plugin-registry/stream`,
                        headers: sessionHeaders(config),
                        ...(config.registrySigningKeys === undefined
                          ? {}
                          : { verify: createPluginRegistryVerifier(config.registrySigningKeys) }),
                      }
                    : null,
                );
            void configPromise.then((stream) => {
              if (stream && host === candidate) PLUGIN_REGISTRY.startLive(stream);
            });
          }
          return activated;
        });
    })
    .then(() => candidate)
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

async function refreshIdePluginRegistry(
  explicit: IdePluginRegistryOptions | null | undefined,
): Promise<void> {
  if (explicit === null || import.meta.env.VITE_ZERO_PLUGINS === '1') return;
  if (explicit) {
    await PLUGIN_REGISTRY.refresh(explicit);
    return;
  }
  if (typeof window === 'undefined') return;
  const config = await getAppConfig();
  if (!config) return;
  await PLUGIN_REGISTRY.refresh({
    url: `${config.apiBase}/api/plugin-registry`,
    headers: sessionHeaders(config),
    ...(config.registrySigningKeys === undefined
      ? {}
      : { verify: createPluginRegistryVerifier(config.registrySigningKeys) }),
  });
}

/** Test/zero-paradigm gate helper: boots a host with an EMPTY discovery
 *  table. The shell must still construct and edit plain files. */
export async function startZeroPluginHost(): Promise<PluginHost> {
  return startIdePluginHost({ builtins: [] });
}

/** Stops the active host (tests, HMR teardown). */
export async function stopIdePluginHost(): Promise<void> {
  if (!host) return;
  stopPluginRegistryLive();
  const current = host;
  host = null;
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // start() already rolled back partial activation.
    }
  }
  if (current.phaseValue === 'active') {
    await current.stopAll();
  }
}

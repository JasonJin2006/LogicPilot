// Actual Node-side PluginHost wiring (Phase 2B-3). The runtime composes the
// scanner, dynamic ESM/WASM loaders and the existing transactional host; it
// never exposes filesystem paths to browser callers.

import type {
  PermissionGrant,
  PluginCatalogEntry,
  PluginManifest,
  PluginScope,
  TrustLevel,
} from '@logicpilot/contracts';
import {
  defaultCatalogEntryLoader,
  PluginHost,
  projectCatalogEntries,
  type AuditEntry,
  type DiscoverySource,
  type PluginModule,
} from '@logicpilot/plugin-host';
import { createDynamicEsmLoader, createDynamicWasmLoader } from './dynamic-loader.js';
import { scanPluginCatalog } from './catalog.js';
import type { PluginCatalogScanConfig, PluginRootConfig } from './catalog.js';
import type { WasmHostImports } from './wasm-abi.js';

export interface NodePluginRuntimeOptions {
  readonly roots: readonly PluginRootConfig[];
  readonly grants?: ReadonlyMap<string, readonly PermissionGrant[]>;
  readonly defaultTrustLevel?: TrustLevel;
  readonly trustOverrides?: ReadonlyMap<string, TrustLevel>;
  readonly maxModuleBytes?: number;
  readonly maxWasmBytes?: number;
  readonly maxWasmMemoryBytes?: number;
  readonly activationTimeoutMs?: number;
  readonly wasmCapabilities?: ReadonlySet<string>;
  readonly wasmImports?: WasmHostImports;
  readonly onAudit?: (entry: AuditEntry) => void;
  readonly scan?: Omit<PluginCatalogScanConfig, 'roots'>;
}

export interface NodePluginRuntimeChange {
  readonly revision: number;
  readonly host: PluginHost;
  readonly catalog: Awaited<ReturnType<typeof scanPluginCatalog>>;
}

export class NodePluginRuntime {
  private host: PluginHost | null = null;
  private catalogValue: Awaited<ReturnType<typeof scanPluginCatalog>> | null = null;
  private starting: Promise<PluginHost> | null = null;
  private refreshing: Promise<PluginHost> | null = null;
  private revisionValue = 0;
  private watchTimer: unknown = null;
  private readonly listeners = new Set<(change: NodePluginRuntimeChange) => void>();

  constructor(private readonly options: NodePluginRuntimeOptions) {}

  async start(): Promise<PluginHost> {
    if (this.host?.phaseValue === 'active') return this.host;
    if (this.starting) return this.starting;
    this.starting = this.startFresh();
    try {
      this.host = await this.starting;
      return this.host;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    if (this.host && this.host.phaseValue === 'active') await this.host.stopAll();
    this.host = null;
  }

  /** Re-scans and transactionally replaces the active host. If the new
   * catalog fails dependency resolution, the old host is retained. */
  async refresh(): Promise<PluginHost> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshFresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  subscribe(listener: (change: NodePluginRuntimeChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts bounded polling for catalog changes. The callback is invoked only
   * when a new host is successfully activated; callers own the returned stop
   * function. */
  watch(intervalMs = 2_000): () => void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100) {
      throw new Error('registry watch interval must be at least 100ms');
    }
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const previous = this.catalogValue;
        const next = await scanPluginCatalog({ roots: this.options.roots, ...this.options.scan });
        if (previous && catalogFingerprint(previous) !== catalogFingerprint(next)) {
          await this.refresh();
        }
      } catch (error) {
        this.options.onAudit?.({
          seq: 0,
          timestamp: new Date().toISOString(),
          action: 'error',
          detail: `[registry] refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      if (!stopped) this.watchTimer = setTimeout(() => void tick(), intervalMs);
    };
    this.watchTimer = setTimeout(() => void tick(), intervalMs);
    return () => {
      stopped = true;
      if (this.watchTimer !== null) clearTimeout(this.watchTimer);
      this.watchTimer = null;
    };
  }

  private async refreshFresh(): Promise<PluginHost> {
    const previous = this.host;
    const next = await this.createHost();
    try {
      await next.start();
    } catch (error) {
      await next.stopAll().catch(() => undefined);
      throw error;
    }
    if (previous?.phaseValue === 'active') await previous.stopAll();
    this.host = next;
    this.revisionValue += 1;
    const change = { revision: this.revisionValue, host: next, catalog: this.catalogValue! };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // Registry observers must not break a successful host swap.
      }
    }
    return next;
  }

  catalog(): Awaited<ReturnType<typeof scanPluginCatalog>> | null {
    return this.catalogValue;
  }

  private async startFresh(): Promise<PluginHost> {
    const next = await this.createHost();
    await next.start();
    return next;
  }

  private async createHost(): Promise<PluginHost> {
    const catalog = await scanPluginCatalog({ roots: this.options.roots, ...this.options.scan });
    this.catalogValue = catalog;
    const loaders = new Map<string, () => Promise<PluginModule>>();
    const errors = (error: unknown): void => {
      // Keep diagnostics structured and path-free; the catalog scanner already
      // strips raw filesystem details before this callback is invoked.
      if (error instanceof Error) {
        this.options.onAudit?.({
          seq: 0,
          timestamp: new Date().toISOString(),
          action: 'error',
          detail: `[dynamic-loader] ${error.message}`,
        });
      }
    };
    for (const entry of catalog.entries) {
      const esm = createDynamicEsmLoader({
        roots: this.options.roots,
        scope: entry.scope,
        defaultTrustLevel: this.options.defaultTrustLevel,
        trustOverrides: this.options.trustOverrides,
        maxModuleBytes: this.options.maxModuleBytes,
        activationTimeoutMs: this.options.activationTimeoutMs,
        onError: errors,
      })(entry);
      const wasm = createDynamicWasmLoader({
        roots: this.options.roots,
        scope: entry.scope,
        defaultTrustLevel: this.options.defaultTrustLevel,
        trustOverrides: this.options.trustOverrides,
        maxWasmBytes: this.options.maxWasmBytes,
        maxMemoryBytes: this.options.maxWasmMemoryBytes,
        activationTimeoutMs: this.options.activationTimeoutMs,
        capabilities: this.options.wasmCapabilities,
        imports: this.options.wasmImports,
        onError: errors,
      })(entry);
      const thunk = esm ?? wasm;
      if (thunk) {
        loaders.set(entry.id, thunk);
      } else {
        const dataModule = defaultCatalogEntryLoader(entry);
        if (dataModule) loaders.set(entry.id, async () => dataModule);
      }
    }
    const sources = (['system', 'user', 'workspace'] as const).map((scope): DiscoverySource => ({
      scope,
      discover: () => this.discoverScope(catalog.entries, scope, loaders),
    }));
    return new PluginHost({
      sources,
      grants: this.options.grants,
      defaultTrustLevel: this.options.defaultTrustLevel,
      trustOverrides: this.options.trustOverrides,
      onAudit: this.options.onAudit,
    });
  }

  private discoverScope(
    entries: readonly PluginCatalogEntry[],
    scope: PluginScope,
    loaders: ReadonlyMap<string, () => Promise<PluginModule>>,
  ) {
    const projection = projectCatalogEntries(entries, (entry) => loaders.has(entry.id));
    return projection.entries
      .filter((entry) => entry.scope === scope)
      .map((entry) => ({
        manifest: entry.manifest as PluginManifest,
        scope,
        load: () => loaders.get(entry.id)!(),
      }));
  }
}

function catalogFingerprint(catalog: Awaited<ReturnType<typeof scanPluginCatalog>>): string {
  return catalog.entries
    .map((entry) => `${entry.scope}:${entry.id}@${entry.sha256.toLowerCase()}`)
    .sort()
    .join('|');
}

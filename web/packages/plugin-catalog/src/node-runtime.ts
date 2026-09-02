// Actual Node-side PluginHost wiring (Phase 2B-3). The runtime composes the
// scanner, dynamic ESM/WASM loaders and the existing transactional host; it
// never exposes filesystem paths to browser callers.

import type {
  PermissionGrant,
  PluginCatalogEntry,
  PluginLockfile,
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
  /** When true, only entries present in this lockfile with matching digest
   * and source scope are eligible for activation. */
  readonly lockfile?: PluginLockfile | null;
  readonly requireLockfile?: boolean;
  readonly readLockfile?: () => PluginLockfile | null | Promise<PluginLockfile | null>;
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
  private watchStop: (() => void) | null = null;
  private lockfileValue: PluginLockfile | null | undefined;

  constructor(private readonly options: NodePluginRuntimeOptions) {
    this.lockfileValue = options.lockfile;
  }

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
    this.watchStop?.();
    this.watchStop = null;
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
    this.watchStop?.();
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const previous = this.catalogValue;
        const previousLockfile = this.lockfileValue;
        const next = await scanPluginCatalog({ roots: this.options.roots, ...this.options.scan });
        const nextLockfile = this.options.readLockfile
          ? await this.options.readLockfile()
          : this.lockfileValue;
        if (
          previous &&
          (catalogFingerprint(previous) !== catalogFingerprint(next) ||
            lockfileFingerprint(previousLockfile) !== lockfileFingerprint(nextLockfile))
        ) {
          await this.refresh();
        }
      } catch (error) {
        this.host?.auditLog.append(
          'error',
          undefined,
          `[registry] refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!stopped) this.watchTimer = setTimeout(() => void tick(), intervalMs);
    };
    this.watchTimer = setTimeout(() => void tick(), intervalMs);
    const stop = () => {
      stopped = true;
      if (this.watchTimer !== null) clearTimeout(this.watchTimer);
      this.watchTimer = null;
      if (this.watchStop === stop) this.watchStop = null;
    };
    this.watchStop = stop;
    return stop;
  }

  private async refreshFresh(): Promise<PluginHost> {
    const previous = this.host;
    const previousCatalog = this.catalogValue;
    let next: PluginHost;
    try {
      next = await this.createHost();
      await next.start();
    } catch (error) {
      this.catalogValue = previousCatalog;
      throw error;
    }
    if (previous?.phaseValue === 'active') {
      try {
        await previous.stopAll();
      } catch (error) {
        await next.stopAll().catch(() => undefined);
        this.catalogValue = previousCatalog;
        throw error;
      }
    }
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
    if (this.options.readLockfile) this.lockfileValue = await this.options.readLockfile();
    const catalog = await scanPluginCatalog({ roots: this.options.roots, ...this.options.scan });
    const approved = this.approvedEntries(catalog.entries, this.lockfileValue);
    this.catalogValue = { ...catalog, entries: approved };
    const loaders = new Map<string, () => Promise<PluginModule>>();
    const loaderErrors: string[] = [];
    const errors = (error: unknown): void => {
      // Keep diagnostics structured and path-free; the catalog scanner already
      // strips raw filesystem details before this callback is invoked.
      if (error instanceof Error) loaderErrors.push(`[dynamic-loader] ${error.message}`);
    };
    const lockPlugins = this.lockfileValue?.plugins ?? [];
    const lockGrants = new Map(lockPlugins.map((entry) => [entry.id, entry.permissions]));
    const lockTrust = new Map(lockPlugins.map((entry) => [entry.id, entry.trust]));
    const grants = this.options.grants ?? lockGrants;
    const trustOverrides = this.options.trustOverrides ?? lockTrust;
    for (const entry of approved) {
      const esm = createDynamicEsmLoader({
        roots: this.options.roots,
        scope: entry.scope,
        defaultTrustLevel: this.options.defaultTrustLevel,
        trustOverrides,
        maxModuleBytes: this.options.maxModuleBytes,
        activationTimeoutMs: this.options.activationTimeoutMs,
        onError: errors,
      })(entry);
      const wasm = createDynamicWasmLoader({
        roots: this.options.roots,
        scope: entry.scope,
        defaultTrustLevel: this.options.defaultTrustLevel,
        trustOverrides,
        maxWasmBytes: this.options.maxWasmBytes,
        maxMemoryBytes: this.options.maxWasmMemoryBytes,
        activationTimeoutMs: this.options.activationTimeoutMs,
        capabilities: this.wasmCapabilitiesFor(entry, grants),
        imports: this.options.wasmImports,
        isolate: true,
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
      discover: () => this.discoverScope(approved, scope, loaders),
    }));
    const host = new PluginHost({
      sources,
      grants,
      defaultTrustLevel: this.options.defaultTrustLevel,
      trustOverrides,
      onAudit: this.options.onAudit,
    });
    for (const detail of loaderErrors) host.auditLog.append('error', undefined, detail);
    return host;
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

  private approvedEntries(
    entries: readonly PluginCatalogEntry[],
    lockfile: PluginLockfile | null | undefined,
  ): readonly PluginCatalogEntry[] {
    if (lockfile === undefined) return this.options.requireLockfile ? [] : entries;
    if (lockfile === null) return [];
    const approved = new Map(lockfile.plugins.map((entry) => [entry.id, entry]));
    return entries.filter((entry) => {
      const locked = approved.get(entry.id);
      if (!locked || locked.sha256.toLowerCase() !== entry.sha256.toLowerCase()) return false;
      return locked.source === undefined || locked.source === entry.scope;
    });
  }

  private wasmCapabilitiesFor(
    entry: PluginCatalogEntry,
    grants: ReadonlyMap<string, readonly PermissionGrant[]>,
  ): ReadonlySet<string> {
    const allowed = grants
      .get(entry.id)
      ?.some((grant) => grant.permissionId === 'runtime.wasm.build' && grant.granted);
    return allowed ? new Set(['runtime.log', 'runtime.random']) : new Set();
  }
}

function catalogFingerprint(catalog: Awaited<ReturnType<typeof scanPluginCatalog>>): string {
  return catalog.entries
    .map((entry) => `${entry.scope}:${entry.id}@${entry.sha256.toLowerCase()}`)
    .sort()
    .join('|');
}

function lockfileFingerprint(lockfile: PluginLockfile | null | undefined): string {
  if (!lockfile) return '';
  return lockfile.plugins
    .map((entry) => `${entry.id}@${entry.version}:${entry.sha256.toLowerCase()}:${entry.trust}`)
    .sort()
    .join('|');
}

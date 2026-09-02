// Actual Node-side PluginHost wiring (Phase 2B-3). The runtime composes the
// scanner, dynamic ESM/WASM loaders and the existing transactional host; it
// never exposes filesystem paths to browser callers.

import type {
  PermissionGrant,
  PluginCatalogEntry,
  PluginLockfile,
  PluginRuntimeSession,
  PluginManifest,
  PluginScope,
  TrustLevel,
} from '@logicpilot/contracts';
import {
  defaultCatalogEntryLoader,
  PluginHost,
  projectCatalogEntries,
  CapabilityBroker,
  type AuditEntry,
  type DiscoverySource,
  type PluginModule,
} from '@logicpilot/plugin-host';
import { createDynamicEsmLoader, createDynamicWasmLoader } from './dynamic-loader.js';
import { scanPluginCatalog } from './catalog.js';
import type { PluginCatalogScanConfig, PluginRootConfig } from './catalog.js';
import type { WasmHostImports } from './wasm-abi.js';
import { WASM_CAPABILITY_IMPORTS } from './wasm-abi.js';

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
  readonly capabilityBroker?: CapabilityBroker;
  readonly onAudit?: (entry: AuditEntry) => void;
  readonly scan?: Omit<PluginCatalogScanConfig, 'roots'>;
}

export interface NodePluginRuntimeChange {
  readonly revision: number;
  readonly host: PluginHost;
  readonly catalog: Awaited<ReturnType<typeof scanPluginCatalog>>;
}

export interface NodePluginRuntimeSnapshot {
  readonly generation: number;
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
  private readonly broker: CapabilityBroker;
  private readonly sessions = new Map<string, PluginRuntimeSession>();
  private capabilityRequestSequence = 0;
  private activeSnapshot: NodePluginRuntimeSnapshot | null = null;

  constructor(private readonly options: NodePluginRuntimeOptions) {
    this.lockfileValue = options.lockfile;
    this.broker = options.capabilityBroker ?? new CapabilityBroker();
    if (!options.capabilityBroker) {
      this.broker.register('runtime.log', () => undefined);
      this.broker.register('runtime.random', () => Math.floor(Math.random() * 0x100000000));
      this.broker.register('runtime.event.emit', () => undefined);
      this.broker.register('runtime.event.subscribe', () => undefined);
      this.broker.register('runtime.service.provide', () => undefined);
      this.broker.register('runtime.service.call', () => undefined);
    }
  }

  capabilityBroker(): CapabilityBroker {
    return this.broker;
  }

  async start(): Promise<PluginHost> {
    if (this.host?.phaseValue === 'active') return this.host;
    if (this.starting) return this.starting;
    this.starting = this.startFresh();
    try {
      this.host = await this.starting;
      this.revisionValue += 1;
      this.broker.activateGeneration(this.revisionValue);
      this.activeSnapshot = {
        generation: this.revisionValue,
        host: this.host,
        catalog: this.catalogValue!,
      };
      return this.host;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    this.watchStop?.();
    this.watchStop = null;
    if (this.host && this.host.phaseValue === 'active') await this.host.stopAll();
    this.broker.revokeGeneration(this.revisionValue);
    for (const session of this.sessions.values()) this.broker.revokeSession(session.sessionId);
    this.sessions.clear();
    this.host = null;
    this.activeSnapshot = null;
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

  snapshot(): NodePluginRuntimeSnapshot | null {
    return this.activeSnapshot;
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
      this.revokeSessions(this.revisionValue + 1);
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
    const previousGeneration = this.revisionValue;
    this.host = next;
    this.revisionValue += 1;
    this.broker.activateGeneration(this.revisionValue);
    this.broker.revokeGeneration(previousGeneration);
    const snapshot: NodePluginRuntimeSnapshot = {
      generation: this.revisionValue,
      host: next,
      catalog: this.catalogValue!,
    };
    this.activeSnapshot = snapshot;
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
    const generation = this.revisionValue + 1;
    const next = await this.createHost();
    try {
      await next.start();
      return next;
    } catch (error) {
      this.revokeSessions(generation);
      throw error;
    }
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
    const generation = this.revisionValue + 1;
    for (const entry of approved) {
      const session = this.broker.registerSession({
        pluginId: entry.id,
        generation,
        sha256: entry.sha256,
        trust: trustOverrides.get(entry.id) ?? this.options.defaultTrustLevel ?? 't0',
        grants: grants.get(entry.id) ?? [],
        ttlMs: 10 * 60 * 1000,
      });
      this.sessions.set(entry.id, session);
      const esm = createDynamicEsmLoader({
        roots: this.options.roots,
        scope: entry.scope,
        defaultTrustLevel: this.options.defaultTrustLevel,
        trustOverrides,
        maxModuleBytes: this.options.maxModuleBytes,
        activationTimeoutMs: this.options.activationTimeoutMs,
        isolate: true,
        grants: grants.get(entry.id) ?? [],
        onCapability: (capability, payload) =>
          this.dispatchCapability(entry.id, capability, payload, session),
        onCapabilityRequest: (capability, payload) =>
          this.dispatchCapabilityRequest(entry.id, capability, payload, session),
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
        onCapability: (capability, payload) => {
          this.dispatchCapability(entry.id, capability, payload, session);
        },
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
      // `source` may be a registry URL or local provenance string. Only the
      // canonical scope markers carry layering authority; other provenance
      // values must not accidentally exclude an approved package.
      return (
        locked.source === undefined ||
        !['system', 'user', 'workspace'].includes(locked.source) ||
        locked.source === entry.scope
      );
    });
  }

  private wasmCapabilitiesFor(
    entry: PluginCatalogEntry,
    grants: ReadonlyMap<string, readonly PermissionGrant[]>,
  ): ReadonlySet<string> {
    const granted = new Set(
      (grants.get(entry.id) ?? [])
        .filter((grant) => grant.granted)
        .map((grant) => grant.permissionId),
    );
    const capabilities = new Set<string>();
    for (const descriptor of Object.values(WASM_CAPABILITY_IMPORTS)) {
      if (granted.has(descriptor.permissionId)) capabilities.add(descriptor.capability);
    }
    return capabilities;
  }

  private dispatchCapability(
    pluginId: string,
    capability: string,
    payload: unknown,
    session = this.sessions.get(pluginId),
  ): void {
    if (!session) return;
    void this.broker.invoke({
      schema: 'logicpilot.capability-rpc/v1',
      contractVersion: 1,
      generation: session.generation,
      sessionId: session.sessionId,
      pluginId: session.pluginId,
      requestId: `lp-request-${++this.capabilityRequestSequence}`,
      deadlineMs: Date.now() + (this.options.activationTimeoutMs ?? 10_000),
      capability,
      operation: 'invoke',
      payload,
    });
  }

  private async dispatchCapabilityRequest(
    pluginId: string,
    capability: string,
    payload: unknown,
    session = this.sessions.get(pluginId),
  ): Promise<unknown> {
    if (!session) throw new Error('runtime session unavailable');
    const response = await this.broker.invoke({
      schema: 'logicpilot.capability-rpc/v1',
      contractVersion: 1,
      generation: session.generation,
      sessionId: session.sessionId,
      pluginId: session.pluginId,
      requestId: `lp-request-${++this.capabilityRequestSequence}`,
      deadlineMs: Date.now() + (this.options.activationTimeoutMs ?? 10_000),
      capability,
      operation: 'invoke',
      payload,
    });
    if (response.status !== 'ok')
      throw new Error(response.errorCode ?? 'capability request denied');
    return response.payload;
  }

  private revokeSessions(generation: number): void {
    for (const session of [...this.sessions.values()]) {
      if (session.generation === generation) {
        this.broker.revokeSession(session.sessionId);
        this.sessions.delete(session.pluginId);
      }
    }
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
    .map(
      (entry) =>
        `${entry.id}@${entry.version}:${entry.sha256.toLowerCase()}:${entry.trust}:${entry.permissions
          .map((grant) => `${grant.permissionId}=${grant.granted}`)
          .sort()
          .join(',')}`,
    )
    .sort()
    .join('|');
}

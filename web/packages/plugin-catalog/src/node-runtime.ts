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
  CapabilityDeniedError,
  ContributionRegistry,
  ExecutionTargetRegistry,
  KnowledgeRegistry,
  type PreparedContributionGeneration,
  type AuditEntry,
  type DiscoverySource,
  type PluginModule,
  type ExecutionProviderResult,
} from '@logicpilot/plugin-host';
import { createDynamicEsmLoader, createDynamicWasmLoader } from './dynamic-loader.js';
import { scanPluginCatalog } from './catalog.js';
import type { PluginCatalogScanConfig, PluginRootConfig } from './catalog.js';
import type { WasmHostImports } from './wasm-abi.js';
import { WASM_CAPABILITY_IMPORTS } from './wasm-abi.js';
import { loadContributionSets } from './contribution-loader.js';

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
  readonly componentRunner?: string;
  readonly activationTimeoutMs?: number;
  readonly wasmCapabilities?: ReadonlySet<string>;
  readonly wasmImports?: WasmHostImports;
  readonly capabilityBroker?: CapabilityBroker;
  /** Host-owned RPC services exposed to isolated ESM plugins. Services are
   * functions at the wire boundary; object-method exposure must be wrapped by
   * the host so the broker never receives an arbitrary object reference. */
  readonly services?: ReadonlyMap<string, unknown>;
  readonly contributionRegistry?: ContributionRegistry;
  readonly knowledgeRegistry?: KnowledgeRegistry;
  /** Shared host-owned execution registry. Runtime plugins receive this as a
   * service and must register their disposer through the activation effect
   * scope so the host generation can revoke it. */
  readonly executionTargetRegistry?: ExecutionTargetRegistry;
  readonly onAudit?: (entry: AuditEntry) => void;
  readonly scan?: Omit<PluginCatalogScanConfig, 'roots'>;
  /** Session TTL for activated plugins. A successful capability invoke slides
   * the expiry forward by this amount, so an actively-used worker is not
   * evicted by its initial TTL. */
  readonly sessionTtlMs?: number;
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

export const SERVICE_CALL_DEADLINE_MARGIN_MS = 30_000;

/** Broker deadline for runtime service calls. A kernel run is allowed to
 * consume its requested wall budget instead of being cut off by the short
 * activation timeout; the margin covers the supervised teardown after the
 * budget expires. Unbudgeted calls fall back to the activation timeout. */
export function serviceCallDeadlineMs(
  now: number,
  budgetWallMs: unknown,
  fallbackMs: number,
): number {
  if (Number.isSafeInteger(budgetWallMs) && (budgetWallMs as number) >= 1) {
    return now + (budgetWallMs as number) + SERVICE_CALL_DEADLINE_MARGIN_MS;
  }
  return now + fallbackMs;
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
  private sessions = new Map<string, PluginRuntimeSession>();
  /** Services provided by plugins, keyed by service name, with owner,
   * generation, allowed methods and the routing module. */
  private readonly serviceRegistry = new Map<
    string,
    {
      owner: string;
      generation: number;
      methods: Set<string>;
      module?: PluginModule;
    }
  >();
  private capabilityRequestSequence = 0;
  private activeSnapshot: NodePluginRuntimeSnapshot | null = null;
  private readonly contributions: ContributionRegistry;
  private pendingContributions: PreparedContributionGeneration | null = null;
  private readonly knowledge: KnowledgeRegistry;
  private readonly executionTargets: ExecutionTargetRegistry;
  private executionTargetDisposers: Array<() => void> = [];
  private pendingExecutionModules: Map<string, PluginModule> | null = null;
  private pendingKnowledge: ReturnType<KnowledgeRegistry['prepare']> | null = null;
  /** Capability deny/timeout/error events observed before the host exists. */
  private readonly brokerAuditBuffer: Array<{
    action: string;
    pluginId?: string;
    detail?: string;
  }> = [];

  constructor(private readonly options: NodePluginRuntimeOptions) {
    this.lockfileValue = options.lockfile;
    this.broker =
      options.capabilityBroker ??
      new CapabilityBroker({
        onAudit: (event) => this.recordBrokerAudit(event),
        ...(options.sessionTtlMs === undefined ? {} : { renewTtlMs: options.sessionTtlMs }),
      });
    this.contributions = options.contributionRegistry ?? new ContributionRegistry();
    this.knowledge = options.knowledgeRegistry ?? new KnowledgeRegistry();
    this.executionTargets = options.executionTargetRegistry ?? new ExecutionTargetRegistry();
    if (!options.capabilityBroker) {
      this.broker.register('runtime.log', () => undefined);
      this.broker.register('runtime.random', () => Math.floor(Math.random() * 0x100000000));
      this.broker.register('runtime.event.emit', () => undefined);
      this.broker.register('runtime.event.subscribe', () => undefined);
      this.broker.register('runtime.service.provide', ({ envelope, session }) => {
        const payload = envelope.payload as { readonly name?: unknown; readonly methods?: unknown };
        if (typeof payload?.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(payload.name))
          throw new CapabilityDeniedError('invalid-service', 'runtime service name is invalid');
        const methods = Array.isArray(payload.methods)
          ? payload.methods.filter((method): method is string => typeof method === 'string')
          : [];
        if (methods.length > 0) {
          const manifest = this.catalogValue?.entries.find(
            (entry) => entry.id === session.pluginId,
          )?.manifest;
          const declaration = manifest?.services?.find((service) => service.name === payload.name);
          if (
            !declaration ||
            methods.some(
              (method) => !declaration.methods.some((declared) => declared.name === method),
            )
          )
            throw new CapabilityDeniedError(
              'service-not-declared',
              `runtime service '${payload.name}' is not declared by the plugin manifest`,
            );
        }
        if (this.serviceRegistry.has(payload.name))
          throw new CapabilityDeniedError(
            'service-exists',
            `runtime service '${payload.name}' is already provided`,
          );
        this.serviceRegistry.set(payload.name, {
          owner: session.pluginId,
          generation: session.generation,
          methods: new Set(methods),
          module: this.pendingExecutionModules?.get(session.pluginId),
        });
        return { ok: true, methods };
      });
      this.broker.register('runtime.service.call', ({ envelope, session }) => {
        const payload = envelope.payload as {
          readonly name?: unknown;
          readonly method?: unknown;
          readonly args?: unknown;
        };
        if (typeof payload?.name !== 'string' || !Array.isArray(payload.args))
          throw new CapabilityDeniedError('invalid-service', 'invalid runtime service call');
        const name = payload.name;
        const method = typeof payload.method === 'string' ? payload.method : 'call';
        if (name === 'logicpilot.execution.kernel') {
          const kind = (payload.args[0] as { runtimeKind?: unknown } | undefined)?.runtimeKind;
          const owned = this.executionTargets
            .list()
            .some(
              (target) =>
                target.runtime.pluginId === session.pluginId &&
                (target.options as { paradigm?: unknown } | undefined)?.paradigm === kind,
            );
          if (!owned)
            throw new CapabilityDeniedError(
              'runtime-not-owned',
              'plugin does not own the requested runtime',
            );
          const service = options.services?.get(name);
          if (service === undefined)
            throw new CapabilityDeniedError(
              'service-unavailable',
              `runtime service '${name}' unavailable`,
            );
          if (typeof service !== 'function')
            throw new CapabilityDeniedError(
              'not-callable',
              `runtime service '${name}' is not callable over RPC`,
            );
          return service(...payload.args);
        }
        const registered = this.serviceRegistry.get(name);
        if (registered !== undefined) {
          if (!registered.methods.has(method))
            throw new CapabilityDeniedError(
              'method-not-allowed',
              `method '${method}' is not provided by '${name}'`,
            );
          const module = registered.module;
          if (registered.generation !== this.revisionValue || !module?.callService)
            throw new CapabilityDeniedError(
              'not-callable',
              `runtime service '${name}' is not callable over RPC`,
            );
          return module.callService(name, method, payload.args);
        }
        const service = options.services?.get(name);
        if (service === undefined)
          throw new CapabilityDeniedError(
            'service-unavailable',
            `runtime service '${name}' unavailable`,
          );
        if (typeof service !== 'function')
          throw new CapabilityDeniedError(
            'not-callable',
            `runtime service '${name}' is not callable over RPC`,
          );
        return service(...payload.args);
      });
    }
  }

  capabilityBroker(): CapabilityBroker {
    return this.broker;
  }

  contributionRegistry(): ContributionRegistry {
    return this.contributions;
  }

  knowledgeRegistry(): KnowledgeRegistry {
    return this.knowledge;
  }

  executionTargetRegistry(): ExecutionTargetRegistry {
    return this.executionTargets;
  }

  async start(): Promise<PluginHost> {
    if (this.host?.phaseValue === 'active') return this.host;
    if (this.starting) return this.starting;
    this.starting = this.startFresh();
    try {
      this.host = await this.starting;
      this.flushBrokerAudits();
      this.validatePendingExecutionTargets(this.host);
      this.installPendingExecutionTargets();
      this.commitPendingContributions();
      this.revisionValue += 1;
      this.broker.activateGeneration(this.revisionValue);
      this.activeSnapshot = {
        generation: this.revisionValue,
        host: this.host,
        catalog: this.catalogValue!,
      };
      return this.host;
    } catch (error) {
      await this.host?.stopAll().catch(() => undefined);
      this.clearExecutionTargets();
      this.revokeSessions(this.revisionValue + 1);
      this.disposeGenerationServices(this.revisionValue + 1);
      this.pendingExecutionModules = null;
      this.pendingContributions = null;
      this.pendingKnowledge = null;
      this.host = null;
      throw error;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    await this.executionTargets.beginDrain();
    try {
      await this.stopDrained();
    } finally {
      this.executionTargets.resume();
    }
  }

  private async stopDrained(): Promise<void> {
    this.watchStop?.();
    this.watchStop = null;
    if (this.host && this.host.phaseValue === 'active') await this.host.stopAll();
    this.clearExecutionTargets();
    this.broker.revokeGeneration(this.revisionValue);
    for (const session of this.sessions.values()) this.broker.revokeSession(session.sessionId);
    this.sessions.clear();
    this.serviceRegistry.clear();
    const cleared = this.contributions.prepare([]);
    this.contributions.commit(cleared);
    const clearedKnowledge = this.knowledge.prepare([]);
    this.knowledge.commit(clearedKnowledge);
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
    await this.executionTargets.beginDrain();
    try {
      return await this.refreshFreshDrained();
    } finally {
      this.executionTargets.resume();
    }
  }

  private async refreshFreshDrained(): Promise<PluginHost> {
    const previous = this.host;
    const previousCatalog = this.catalogValue;
    // Keep the active generation's sessions so a failed candidate host can be
    // rolled back: createHost() overwrites this.sessions per plugin id, and
    // without this the retained old host can no longer dispatch any
    // capability (it would come back "runtime session unavailable").
    const previousSessions = new Map(this.sessions);
    const previousServices = new Map(this.serviceRegistry);
    let next: PluginHost | null = null;
    try {
      next = await this.createHost();
      // Candidate services are staged independently of the active generation.
      // A name collision must not make the new generation silently lose its
      // provider, while a failed candidate must restore the old table.
      this.serviceRegistry.clear();
      this.broker.beginGeneration(this.revisionValue + 1);
      await next.start();
      this.validatePendingExecutionTargets(next);
    } catch (error) {
      await next?.stopAll().catch(() => undefined);
      this.catalogValue = previousCatalog;
      this.revokeSessions(this.revisionValue + 1);
      this.disposeGenerationServices(this.revisionValue + 1);
      this.sessions = previousSessions;
      this.serviceRegistry.clear();
      for (const [name, service] of previousServices) this.serviceRegistry.set(name, service);
      this.pendingContributions = null;
      this.pendingKnowledge = null;
      this.pendingExecutionModules = null;
      throw error;
    }
    if (previous?.phaseValue === 'active') {
      try {
        await previous.stopAll();
      } catch (error) {
        await next.stopAll().catch(() => undefined);
        this.catalogValue = previousCatalog;
        this.revokeSessions(this.revisionValue + 1);
        this.disposeGenerationServices(this.revisionValue + 1);
        this.sessions = previousSessions;
        this.serviceRegistry.clear();
        for (const [name, service] of previousServices) this.serviceRegistry.set(name, service);
        this.pendingContributions = null;
        this.pendingKnowledge = null;
        throw error;
      }
    }
    this.clearExecutionTargets();
    this.installPendingExecutionTargets();
    this.commitPendingContributions();
    const previousGeneration = this.revisionValue;
    this.host = next;
    this.flushBrokerAudits();
    this.revisionValue += 1;
    this.broker.activateGeneration(this.revisionValue);
    this.broker.revokeGeneration(previousGeneration);
    // Prune sessions of the retired generation (e.g. plugins no longer in the
    // catalog) from the plugin-id map; surviving plugins already carry the new
    // generation's session and are left untouched.
    this.revokeSessions(previousGeneration);
    this.disposeGenerationServices(previousGeneration);
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
    const loadedContributions = loadContributionSets(approved, this.options.roots);
    this.pendingContributions = this.contributions.prepare(loadedContributions.sets);
    this.pendingKnowledge = this.knowledge.prepare(
      loadedContributions.sets.flatMap((set) => set.knowledge),
    );
    const loaders = new Map<string, () => Promise<PluginModule>>();
    const loadedModules = new Map<string, PluginModule>();
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
        ttlMs: this.options.sessionTtlMs ?? 10 * 60 * 1000,
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
        componentRunner: this.options.componentRunner ?? process.env.LOGICPILOT_COMPONENT_RUNNER,
        capabilities: this.wasmCapabilitiesFor(entry, grants),
        imports: this.options.wasmImports,
        isolate: true,
        onCapability: (capability, payload) => {
          this.dispatchCapability(entry.id, capability, payload, session);
        },
        onCapabilityRequest: (capability, payload) =>
          this.dispatchCapabilityRequest(entry.id, capability, payload, session),
        onError: errors,
      })(entry);
      const thunk = esm ?? wasm;
      if (thunk) {
        loaders.set(entry.id, async () => {
          const module = await thunk();
          loadedModules.set(entry.id, module);
          return module;
        });
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
      services: new Map([
        ...(this.options.services ?? []),
        ['logicpilot.execution-targets', this.executionTargets],
      ]),
      defaultTrustLevel: this.options.defaultTrustLevel,
      trustOverrides,
      onAudit: this.options.onAudit,
    });
    for (const detail of loaderErrors) host.auditLog.append('error', undefined, detail);
    for (const detail of loadedContributions.errors)
      host.auditLog.append('error', undefined, detail);
    this.pendingExecutionModules = loadedModules;
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
    const envelopePayload = payload as { readonly args?: unknown } | undefined;
    const serviceArgs =
      capability === 'runtime.service.call'
        ? ((envelopePayload?.args as readonly unknown[] | undefined) ?? [])
        : [];
    const budgetWallMs = (
      serviceArgs[0] as { readonly budget?: { readonly maxWallMs?: unknown } } | undefined
    )?.budget?.maxWallMs;
    const response = await this.broker.invoke({
      schema: 'logicpilot.capability-rpc/v1',
      contractVersion: 1,
      generation: session.generation,
      sessionId: session.sessionId,
      pluginId: session.pluginId,
      requestId: `lp-request-${++this.capabilityRequestSequence}`,
      deadlineMs: serviceCallDeadlineMs(
        Date.now(),
        budgetWallMs,
        this.options.activationTimeoutMs ?? 10_000,
      ),
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

  private commitPendingContributions(): void {
    if (!this.pendingContributions) return;
    this.contributions.commit(this.pendingContributions);
    this.pendingContributions = null;
    if (this.pendingKnowledge) {
      this.knowledge.commit(this.pendingKnowledge);
      this.pendingKnowledge = null;
    }
  }

  private installPendingExecutionTargets(): void {
    const modules = this.pendingExecutionModules;
    this.pendingExecutionModules = null;
    if (!modules || !this.catalogValue) return;
    for (const entry of this.catalogValue.entries) {
      const module = modules.get(entry.id);
      if (!module?.execute) continue;
      for (const target of entry.manifest.executionTargets ?? []) {
        const result = this.executionTargets.register({
          target,
          execute: async (request): Promise<ExecutionProviderResult> => {
            const value = await module.execute!(request);
            if (typeof value !== 'object' || value === null)
              throw new Error(`plugin '${entry.id}' returned an invalid execution result`);
            return value as ExecutionProviderResult;
          },
        });
        this.executionTargetDisposers.push(result);
      }
    }
  }

  private validatePendingExecutionTargets(host: PluginHost): void {
    const prepared = new ExecutionTargetRegistry();
    for (const entry of this.catalogValue?.entries ?? []) {
      if (!host.isActive(entry.id)) continue;
      for (const target of entry.manifest.executionTargets ?? []) {
        if (target.runtime.pluginId !== entry.id)
          throw new Error('execution target owner mismatch');
        const module = this.pendingExecutionModules?.get(entry.id);
        if (!module?.execute) throw new Error('execution target requires an executable provider');
        prepared.register({
          target,
          execute: async () => {
            throw new Error('validation only');
          },
        });
      }
    }
  }

  private clearExecutionTargets(): void {
    for (const dispose of this.executionTargetDisposers.splice(0).reverse()) dispose();
  }

  /** Dispose every service provided by plugins of a retired generation so a
   * stale service can no longer be called after its owner is unloaded. */
  private disposeGenerationServices(generation: number): void {
    for (const [name, entry] of this.serviceRegistry) {
      if (entry.generation !== generation) continue;
      entry.module = undefined;
      this.serviceRegistry.delete(name);
    }
  }

  private recordBrokerAudit(event: {
    readonly action: 'allow' | 'deny' | 'timeout' | 'error';
    readonly pluginId: string;
    readonly capability: string;
    readonly requestId: string;
    readonly detail?: string;
  }): void {
    if (event.action === 'allow') return; // Allowed calls are not host events.
    const detail =
      event.detail === undefined ? event.capability : `${event.capability}:${event.detail}`;
    const host = this.host;
    if (host) {
      host.auditLog.append(event.action === 'deny' ? 'deny' : 'error', event.pluginId, detail);
    } else {
      this.brokerAuditBuffer.push({ action: event.action, pluginId: event.pluginId, detail });
    }
  }

  private flushBrokerAudits(): void {
    const host = this.host;
    if (!host) return;
    for (const entry of this.brokerAuditBuffer.splice(0)) {
      host.auditLog.append(entry.action as 'deny' | 'error', entry.pluginId, entry.detail);
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

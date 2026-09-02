// PluginHost (plan §16 Phase 2, §5.1 fixed core): discovery, dependency
// resolution, deterministic activation, capability grants, lifecycle
// (service/event/effect) and an append-only audit log.
//
// Layering decision (ADR-0070): this is a Cordis-COMPATIBLE implementation,
// not the Cordis dependency. The host mirrors the Cordis shape that the plan
// §7.1 endorses - `apply(ctx)` entrypoints, explicit service injection,
// context-scoped services, an event bus and automatic effect cleanup - while
// keeping manifest/permission/trust semantics on the Phase 1 frozen
// contracts. See docs/adr/0070-plugin-host-and-cordis.md.

import type {
  PluginManifest,
  PluginLockfile,
  PluginLockEntry,
  PermissionGrant,
  TrustLevel,
} from '@logicpilot/contracts';
import {
  isSupportedPluginApiVersion,
  resolveActivationOrder,
  satisfiesRange,
  toResolutionInput,
  validateContract,
} from '@logicpilot/contracts';

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'discover'
  | 'activate'
  | 'deactivate'
  | 'install'
  | 'uninstall'
  | 'upgrade'
  | 'rollback'
  | 'grant'
  | 'deny'
  | 'error';

export interface AuditEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly pluginId?: string;
  readonly detail?: string;
}

/** Append-only audit trail. Entries can never be removed or edited. */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private nextSeq = 1;
  private listeners: ((entry: AuditEntry) => void)[] = [];

  /** Registers a listener notified for every future entry (shells persist this). */
  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  append(action: AuditAction, pluginId?: string, detail?: string): AuditEntry {
    const entry: AuditEntry = {
      seq: this.nextSeq++,
      timestamp: new Date().toISOString(),
      action,
      ...(pluginId !== undefined ? { pluginId } : {}),
      ...(detail !== undefined ? { detail } : {}),
    };
    this.entries.push(entry);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Audit consumers must never break the caller.
      }
    }
    return entry;
  }

  list(): readonly AuditEntry[] {
    return [...this.entries];
  }

  /** Entries mentioning one plugin, oldest first. */
  forPlugin(pluginId: string): readonly AuditEntry[] {
    return this.entries.filter((entry) => entry.pluginId === pluginId);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PluginHostError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'duplicate-id'
      | 'api-version'
      | 'missing-dependency'
      | 'dependency-cycle'
      | 'version-conflict'
      | 'permission-denied'
      | 'trust-denied'
      | 'not-active'
      | 'dependent-active'
      | 'already-active'
      | 'invalid-manifest',
  ) {
    super(message);
    this.name = 'PluginHostError';
  }
}

// ---------------------------------------------------------------------------
// Plugin surface: what a plugin module contributes at activation
// ---------------------------------------------------------------------------

/** One automatic effect cleanup callback returned by an effect function. */
export type EffectCleanup = () => void;

/** Activation context handed to `PluginModule.activate`. Mirrors the Cordis
 *  `apply(ctx)` shape: explicit service lookup, event bus, effect scope. */
export interface ActivationContext {
  /** Stable plugin id (useful for namespacing events/services). */
  readonly pluginId: string;
  /** Resolved plugin manifest. */
  readonly manifest: PluginManifest;
  /** Grants approved for this activation (subset of manifest.permissions). */
  readonly grants: readonly PermissionGrant[];
  /** Fetch a service exported by another plugin. Throws when missing. */
  service<T>(name: string): T;
  /** Publish on the shared event bus. */
  emit(event: string, payload?: unknown): void;
  /** Subscribe on the shared event bus; auto-cleared on deactivation. */
  on(event: string, handler: (payload: unknown) => void): void;
  /** Register an effect; its cleanup runs automatically on deactivation. */
  effect(cleanup: EffectCleanup): void;
  /** Services this plugin exports to other plugins (optional). */
  provide(name: string, service: unknown): void;
}

/** A plugin entrypoint module (web entrypoint). Structured instead of a
 *  bare default export so the host can drive lifecycle without conventions. */
export interface PluginModule {
  readonly activate: (ctx: ActivationContext) => void | Promise<void>;
  /** Optional graceful teardown before effects are cleaned up. */
  readonly deactivate?: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type EventHandler = (payload: unknown) => void;

class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        handler(payload);
      } catch {
        // Event handlers must never break the emitter; host-level errors are
        // surfaced through the audit log by the caller instead.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Discovery: system / user / workspace layers
// ---------------------------------------------------------------------------

export type PluginScope = 'system' | 'user' | 'workspace';

/** One discovered plugin package: its manifest plus where it came from. */
export interface DiscoveredPlugin {
  readonly manifest: PluginManifest;
  readonly scope: PluginScope;
  /** Module resolver: returns the plugin's entrypoint module lazily. The
   *  host never imports plugin code itself - shells decide how (static map,
   *  dynamic import, wasm loader, ...). */
  readonly load: () => Promise<PluginModule> | PluginModule;
}

/** A discovery source yields candidate plugins for one scope layer. Shells
 *  implement this over the filesystem, a bundler import map or memory. */
export interface DiscoverySource {
  readonly scope: PluginScope;
  discover(): readonly DiscoveredPlugin[] | Promise<readonly DiscoveredPlugin[]>;
}

// ---------------------------------------------------------------------------
// Host options and state
// ---------------------------------------------------------------------------

export interface TrustGate {
  /** Returns true when the plugin's trust requirement is acceptable. */
  allow(manifest: PluginManifest, effectiveLevel: TrustLevel): boolean;
}

export interface PluginHostOptions {
  /** Order: system -> user -> workspace; later layers override earlier ones
   *  by plugin id (workspace plugins win). */
  readonly sources: readonly DiscoverySource[];
  /** Approved permission grants per plugin id. Only grants for permissions
   *  the manifest requests are honored; everything else is denied. */
  readonly grants?: ReadonlyMap<string, readonly PermissionGrant[]>;
  /** Optional trust gate; the default allows everything at the manifest's
   *  declared minLevel (Phase 2 keeps policy evaluation with the shell). */
  readonly trustGate?: TrustGate;
  /** Effective trust level for plugins without an override. */
  readonly defaultTrustLevel?: TrustLevel;
  /** Per-plugin trust overrides (e.g. from the lockfile). */
  readonly trustOverrides?: ReadonlyMap<string, TrustLevel>;
  /** Called for every audit entry (shells persist this). */
  readonly onAudit?: (entry: AuditEntry) => void;
}

export type HostPhase = 'idle' | 'starting' | 'active' | 'stopped';

export interface ActivePlugin {
  readonly manifest: PluginManifest;
  readonly scope: PluginScope;
  readonly startedAt: string;
}

const TRUST_ORDER: readonly TrustLevel[] = ['t0', 't1', 't2', 't3', 't4', 't5'];

function trustAtLeast(level: TrustLevel, minimum: TrustLevel): boolean {
  return TRUST_ORDER.indexOf(level) >= TRUST_ORDER.indexOf(minimum);
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

export class PluginHost {
  private readonly audit = new AuditLog();
  private readonly bus = new EventBus();
  private readonly options: PluginHostOptions;
  private phase: HostPhase = 'idle';
  private readonly discovered = new Map<string, DiscoveredPlugin>();
  private readonly active = new Map<string, ActivePluginState>();

  constructor(options: PluginHostOptions) {
    this.options = options;
    if (options.onAudit) {
      this.audit.subscribe(options.onAudit);
    }
  }

  /** Append-only audit trail. */
  get auditLog(): AuditLog {
    return this.audit;
  }

  get phaseValue(): HostPhase {
    return this.phase;
  }

  ids(): readonly string[] {
    return [...this.active.keys()];
  }

  manifestOf(pluginId: string): PluginManifest | undefined {
    return this.discovered.get(pluginId)?.manifest;
  }

  isActive(pluginId: string): boolean {
    return this.active.has(pluginId);
  }

  // -- Discovery ------------------------------------------------------------

  /** Runs all discovery sources in layer order (system, user, workspace).
   *  Later layers override earlier ones by plugin id. Rejects duplicate ids
   *  within the same layer and unsupported apiVersions immediately. */
  async discover(): Promise<readonly DiscoveredPlugin[]> {
    this.discovered.clear();
    const scopes: readonly PluginScope[] = ['system', 'user', 'workspace'];
    const seenInScope = new Set<string>();

    for (const scope of scopes) {
      for (const source of this.options.sources.filter((candidate) => candidate.scope === scope)) {
        for (const plugin of await source.discover()) {
          const validated = validateContract('PluginManifest', plugin.manifest);
          const candidateId =
            typeof (plugin.manifest as { id?: unknown }).id === 'string'
              ? (plugin.manifest as { id: string }).id
              : undefined;
          if (!validated.ok) {
            this.audit.append('error', candidateId, validated.errors.join('; '));
            throw new PluginHostError(
              `invalid plugin manifest${candidateId ? ` '${candidateId}'` : ''}: ${validated.errors.join('; ')}`,
              'invalid-manifest',
            );
          }
          const manifest = validated.value;
          const id = manifest.id;
          const key = `${scope}::${id}`;
          if (seenInScope.has(key)) {
            this.audit.append('error', id, `duplicate plugin id '${id}' within scope '${scope}'`);
            throw new PluginHostError(
              `duplicate plugin id '${id}' within scope '${scope}'`,
              'duplicate-id',
            );
          }
          seenInScope.add(key);
          if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
            this.audit.append('deny', id, `unsupported apiVersion ${manifest.apiVersion}`);
            continue; // Skip incompatible plugins; do not fail the whole scan.
          }
          // The discovery source is authoritative for layering. A package
          // cannot claim a more privileged scope in its returned metadata.
          this.discovered.set(id, { ...plugin, manifest, scope });
          this.audit.append('discover', id, `scope=${scope} version=${manifest.version}`);
        }
      }
    }
    return [...this.discovered.values()];
  }

  // -- Activation -----------------------------------------------------------

  /** Validates manifests, resolves dependencies and activates plugins in
   *  deterministic order (dependencies first, stable by id). */
  async start(): Promise<readonly string[]> {
    if (this.phase !== 'idle' && this.phase !== 'stopped') {
      throw new PluginHostError(`cannot start host in phase '${this.phase}'`, 'already-active');
    }
    this.phase = 'starting';
    try {
      await this.discover();
      const manifests = [...this.discovered.values()].map((plugin) => plugin.manifest);
      const resolution = resolveActivationOrder(manifests.map(toResolutionInput));
      if (!resolution.ok) {
        for (const missing of resolution.missing) {
          this.audit.append('error', undefined, `missing dependency: ${missing}`);
        }
        for (const cycle of resolution.cycles) {
          this.audit.append('error', undefined, `dependency cycle: ${cycle}`);
        }
        throw new PluginHostError(
          `dependency resolution failed: missing=[${resolution.missing.join(', ')}] cycles=[${resolution.cycles.join(', ')}]`,
          resolution.missing.length > 0 ? 'missing-dependency' : 'dependency-cycle',
        );
      }

      // Version ranges must be satisfied by the discovered set.
      for (const manifest of manifests) {
        for (const dep of manifest.requires) {
          const target = this.discovered.get(dep.id)?.manifest;
          if (!target) continue; // Missing non-optional already rejected above.
          if (!satisfiesRange(target.version, dep.range)) {
            this.audit.append(
              'error',
              manifest.id,
              `dependency version conflict: ${dep.id} wants ${dep.range ?? '*'}, found ${target.version}`,
            );
            throw new PluginHostError(
              `dependency version conflict: ${manifest.id} requires ${dep.id}@${dep.range ?? '*'} but ${target.version} is installed`,
              'version-conflict',
            );
          }
        }
      }

      // Capability grants: a plugin may only receive grants for permissions
      // its manifest actually requests (plan §5.1 - permission approval is a
      // fixed-core responsibility).
      const granted = new Map<string, readonly PermissionGrant[]>();
      for (const manifest of manifests) {
        const requested = new Set<string>(manifest.permissions);
        const grants = (this.options.grants?.get(manifest.id) ?? []).filter((grant) => {
          if (!requested.has(grant.permissionId)) {
            this.audit.append(
              'deny',
              manifest.id,
              `grant for unrequested permission '${grant.permissionId}' ignored`,
            );
            return false;
          }
          return grant.granted;
        });
        granted.set(manifest.id, grants);
      }

      // Trust gate.
      const effectiveTrust = (id: string): TrustLevel =>
        this.options.trustOverrides?.get(id) ?? this.options.defaultTrustLevel ?? 't0';
      const gate = this.options.trustGate;
      for (const manifest of manifests) {
        const level = effectiveTrust(manifest.id);
        const allowed = gate
          ? gate.allow(manifest, level)
          : trustAtLeast(level, manifest.trust.minLevel);
        if (!allowed) {
          this.audit.append(
            'deny',
            manifest.id,
            `trust level '${level}' below required '${manifest.trust.minLevel}'`,
          );
          throw new PluginHostError(
            `plugin '${manifest.id}' requires trust >= ${manifest.trust.minLevel} but effective level is ${level}`,
            'trust-denied',
          );
        }
      }

      // Activate strictly in resolved order.
      const activated: string[] = [];
      for (const id of resolution.order) {
        await this.activateOne(id, granted.get(id) ?? []);
        activated.push(id);
      }
      this.phase = 'active';
      this.bus.emit('host:started', { plugins: activated });
      return activated;
    } catch (error) {
      // Startup is transactional. A later plugin may fail after dependencies
      // have already registered services, listeners or UI contributions.
      // Roll the partial activation back before exposing the stopped host.
      for (const id of [...this.active.keys()].reverse()) {
        try {
          await this.stop(id);
        } catch (cleanupError) {
          this.audit.append(
            'error',
            id,
            `startup rollback failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
      this.phase = 'stopped';
      throw error;
    }
  }

  private async activateOne(id: string, grants: readonly PermissionGrant[]): Promise<void> {
    const discovered = this.discovered.get(id);
    if (!discovered) {
      throw new PluginHostError(`plugin '${id}' was not discovered`, 'invalid-manifest');
    }
    if (this.active.has(id)) {
      throw new PluginHostError(`plugin '${id}' is already active`, 'already-active');
    }
    const module = await discovered.load();
    const cleanups: EffectCleanup[] = [];
    const unsubscribe: EffectCleanup[] = [];
    const services = new Map<string, unknown>();

    const ctx: ActivationContext = {
      pluginId: id,
      manifest: discovered.manifest,
      grants,
      service: <T>(name: string): T => {
        const service = services.get(name) ?? this.findForeignService(id, name);
        if (service === undefined) {
          throw new PluginHostError(
            `plugin '${id}' requested missing service '${name}'`,
            'invalid-manifest',
          );
        }
        return service as T;
      },
      emit: (event, payload) => this.bus.emit(event, payload),
      on: (event, handler) => {
        const off = this.bus.on(event, handler);
        unsubscribe.push(off);
      },
      effect: (cleanup) => cleanups.push(cleanup),
      provide: (name, service) => {
        if (services.has(name)) {
          throw new PluginHostError(
            `plugin '${id}' provided duplicate service '${name}'`,
            'invalid-manifest',
          );
        }
        services.set(name, service);
      },
    };

    try {
      await module.activate(ctx);
    } catch (error) {
      // Effects can be registered before activate() rejects. Since the plugin
      // never reaches active state, clean its local scope here.
      for (const off of unsubscribe.reverse()) off();
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (cleanupError) {
          this.audit.append(
            'error',
            id,
            `failed activation cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
      throw error;
    }
    this.active.set(id, {
      manifest: discovered.manifest,
      scope: discovered.scope,
      module,
      cleanups,
      unsubscribe,
      services,
      startedAt: new Date().toISOString(),
    });
    this.audit.append('activate', id, `scope=${discovered.scope}`);
  }

  private findForeignService(requesterId: string, name: string): unknown {
    for (const [id, state] of this.active) {
      if (id === requesterId) continue;
      const service = state.services.get(name);
      if (service !== undefined) return service;
    }
    return undefined;
  }

  // -- Deactivation ---------------------------------------------------------

  /** Deactivates one plugin: module teardown first, then event
   *  subscriptions, then effects (reverse registration order). */
  async stop(pluginId: string): Promise<void> {
    const state = this.active.get(pluginId);
    if (!state) {
      throw new PluginHostError(`plugin '${pluginId}' is not active`, 'not-active');
    }
    const dependent = [...this.active.values()].find(
      (candidate) =>
        candidate.manifest.id !== pluginId &&
        candidate.manifest.requires.some(
          (dependency) => dependency.id === pluginId && !dependency.optional,
        ),
    );
    if (dependent) {
      throw new PluginHostError(
        `cannot stop plugin '${pluginId}': active plugin '${dependent.manifest.id}' depends on it`,
        'dependent-active',
      );
    }
    this.active.delete(pluginId);
    try {
      await state.module.deactivate?.();
    } finally {
      for (const off of state.unsubscribe.reverse()) off();
      for (const cleanup of state.cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          this.audit.append(
            'error',
            pluginId,
            `effect cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    this.audit.append('deactivate', pluginId);
    this.bus.emit('host:plugin-stopped', { pluginId });
  }

  /** Deactivates everything in reverse activation order. */
  async stopAll(): Promise<void> {
    for (const id of [...this.active.keys()].reverse()) {
      await this.stop(id);
    }
    this.phase = 'stopped';
    this.bus.emit('host:stopped');
  }

  /** Lockfile projection of the currently discovered set (contracts shape). */
  toLockfile(): PluginLockfile {
    const plugins: PluginLockEntry[] = [...this.discovered.values()]
      .sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1))
      .map((plugin) => ({
        id: plugin.manifest.id,
        version: plugin.manifest.version,
        apiVersion: plugin.manifest.apiVersion,
        sha256: plugin.manifest.integrity?.sha256 ?? '',
        source: plugin.scope,
        trust:
          this.options.trustOverrides?.get(plugin.manifest.id) ??
          this.options.defaultTrustLevel ??
          't0',
        permissions: (this.options.grants?.get(plugin.manifest.id) ?? []).filter((grant) =>
          plugin.manifest.permissions.includes(grant.permissionId),
        ),
        dependencies: plugin.manifest.requires,
      }));
    return { schema: 'logicpilot.plugin-lock/v1', contractVersion: 1, plugins };
  }
}

interface ActivePluginState {
  readonly manifest: PluginManifest;
  readonly scope: PluginScope;
  readonly module: PluginModule;
  readonly cleanups: EffectCleanup[];
  readonly unsubscribe: EffectCleanup[];
  readonly services: Map<string, unknown>;
  readonly startedAt: string;
}

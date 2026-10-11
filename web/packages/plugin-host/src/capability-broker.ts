import type {
  CapabilityRpcEnvelope,
  CapabilityRpcResponse,
  PermissionGrant,
  PluginRuntimeSession,
  TrustLevel,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface CapabilityBrokerOptions {
  readonly maxInFlightPerSession?: number;
  readonly maxPayloadBytes?: number;
  readonly now?: () => number;
  readonly onAudit?: (event: {
    readonly action: 'allow' | 'deny' | 'timeout' | 'error';
    readonly pluginId: string;
    readonly capability: string;
    readonly requestId: string;
    readonly detail?: string;
  }) => void;
  /** When set, a successful invoke slides the session's expiry forward by
   * this many ms, so an actively-used worker is not evicted by its initial
   * TTL. This only extends the session lifetime; it never affects the
   * deadline of the call already in flight. */
  readonly renewTtlMs?: number;
}

export interface CapabilityInvocationContext {
  readonly session: PluginRuntimeSession;
  readonly envelope: CapabilityRpcEnvelope;
}

export type CapabilityHandler = (
  context: CapabilityInvocationContext,
) => unknown | Promise<unknown>;

/** Throw this from a capability handler to surface an explicit deny through
 * the RPC boundary. The distinction matters: a caller must be able to tell
 * "not allowed" from "the handler crashed", and the audit log must record the
 * deny as such instead of a generic handler failure. */
export class CapabilityDeniedError extends Error {
  constructor(
    readonly denialCode: string,
    message = denialCode,
  ) {
    super(message);
    this.name = 'CapabilityDeniedError';
  }
}

/** Central authorization and quota gate for Worker/PluginHost RPC. It is
 * deliberately transport-agnostic: MessagePort, child-process IPC and a
 * future browser bridge can all validate through the same broker. */
export class CapabilityBroker {
  private readonly sessions = new Map<string, PluginRuntimeSession>();
  private readonly handlers = new Map<string, CapabilityHandler>();
  private readonly inFlight = new Map<string, number>();
  private readonly maxInFlight: number;
  private readonly maxPayloadBytes: number;
  private readonly now: () => number;
  private readonly renewTtlMs: number | null;
  private sequence = 0;
  private readonly activeGenerations = new Set<number>();

  constructor(private readonly options: CapabilityBrokerOptions = {}) {
    this.maxInFlight = options.maxInFlightPerSession ?? 32;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 256 * 1024;
    this.now = options.now ?? (() => Date.now());
    this.renewTtlMs = options.renewTtlMs ?? null;
    if (!Number.isSafeInteger(this.maxInFlight) || this.maxInFlight < 1)
      throw new Error('maxInFlightPerSession must be a positive integer');
    if (!Number.isSafeInteger(this.maxPayloadBytes) || this.maxPayloadBytes < 1)
      throw new Error('maxPayloadBytes must be a positive integer');
  }

  registerSession(input: {
    readonly pluginId: string;
    readonly generation: number;
    readonly sha256: string;
    readonly trust: TrustLevel;
    readonly grants: readonly PermissionGrant[];
    readonly ttlMs: number;
  }): PluginRuntimeSession {
    if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new Error('session ttlMs must be a positive integer');
    }
    const session: PluginRuntimeSession = {
      schema: 'logicpilot.plugin-runtime-session/v1',
      contractVersion: 1,
      sessionId: `lp-session-${++this.sequence}-${this.now().toString(36)}`,
      pluginId: input.pluginId,
      generation: input.generation,
      sha256: input.sha256,
      trust: input.trust,
      grants: input.grants,
      expiresAt: new Date(this.now() + input.ttlMs).toISOString(),
    };
    const validated = validateContract('PluginRuntimeSession', session);
    if (!validated.ok) throw new Error(`invalid runtime session: ${validated.errors.join('; ')}`);
    this.sessions.set(session.sessionId, validated.value);
    this.inFlight.set(session.sessionId, 0);
    return validated.value;
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.inFlight.delete(sessionId);
  }

  /** Extend a session's expiry (sliding TTL). Does not affect the deadline of
   * any call already in flight. Throws when the session is already revoked. */
  renewSession(sessionId: string, ttlMs: number): PluginRuntimeSession {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('session ttlMs must be a positive integer');
    }
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`session '${sessionId}' was not found`);
    const renewed = { ...session, expiresAt: new Date(this.now() + ttlMs).toISOString() };
    const validated = validateContract('PluginRuntimeSession', renewed);
    if (!validated.ok) throw new Error(`invalid runtime session: ${validated.errors.join('; ')}`);
    this.sessions.set(sessionId, validated.value);
    return validated.value;
  }

  /** Read-only view of a session for observability and tests. */
  sessionInfo(sessionId: string): PluginRuntimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  activateGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('generation must be a positive integer');
    }
    this.activeGenerations.clear();
    this.activeGenerations.add(generation);
  }

  /** Admit a candidate generation while the current generation is still
   * serving. NodePluginRuntime uses this only during an atomic refresh. */
  beginGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error('generation must be a positive integer');
    this.activeGenerations.add(generation);
  }

  revokeGeneration(generation: number): void {
    this.activeGenerations.delete(generation);
    for (const [sessionId, session] of this.sessions) {
      if (session.generation === generation) this.revokeSession(sessionId);
    }
  }

  register(capability: string, handler: CapabilityHandler): () => void {
    if (this.handlers.has(capability))
      throw new Error(`capability '${capability}' is already registered`);
    this.handlers.set(capability, handler);
    return () => this.handlers.delete(capability);
  }

  async invoke(input: unknown): Promise<CapabilityRpcResponse> {
    const parsed = validateContract('CapabilityRpcEnvelope', input);
    if (!parsed.ok) {
      return this.failureResponse(input, 'invalid', 'invalid-envelope');
    }
    const envelope = parsed.value;
    const session = this.sessions.get(envelope.sessionId);
    if (
      !session ||
      session.pluginId !== envelope.pluginId ||
      session.generation !== envelope.generation
    ) {
      return this.failureResponse(envelope, 'denied', 'session-mismatch');
    }
    if (this.activeGenerations.size > 0 && !this.activeGenerations.has(envelope.generation)) {
      return this.failureResponse(envelope, 'denied', 'generation-retired');
    }
    if (Date.parse(session.expiresAt) <= this.now()) {
      this.revokeSession(session.sessionId);
      return this.failureResponse(envelope, 'denied', 'session-expired');
    }
    if (envelope.deadlineMs <= this.now()) {
      return this.failureResponse(envelope, 'timeout', 'deadline-expired');
    }
    if (jsonBytes(envelope.payload) > this.maxPayloadBytes) {
      return this.failureResponse(envelope, 'invalid', 'payload-too-large');
    }
    const permission = permissionForCapability(envelope.capability);
    const grant = session.grants.find(
      (candidate) => candidate.permissionId === permission && candidate.granted,
    );
    if (!grant) return this.failureResponse(envelope, 'denied', 'permission-denied');
    const handler = this.handlers.get(envelope.capability);
    if (!handler) return this.failureResponse(envelope, 'invalid', 'unknown-capability');
    const active = this.inFlight.get(session.sessionId) ?? 0;
    if (active >= this.maxInFlight)
      return this.failureResponse(envelope, 'denied', 'quota-in-flight');
    this.inFlight.set(session.sessionId, active + 1);
    try {
      const result = await withDeadline(
        Promise.resolve(handler({ session, envelope })),
        envelope.deadlineMs,
        this.now,
      );
      this.audit({
        action: 'allow',
        pluginId: envelope.pluginId,
        capability: envelope.capability,
        requestId: envelope.requestId,
      });
      this.renewSessionIfConfigured(session);
      return this.successResponse(envelope, result);
    } catch (error) {
      const timeout = error instanceof BrokerTimeoutError;
      const denied = error instanceof CapabilityDeniedError;
      this.audit({
        action: timeout ? 'timeout' : denied ? 'deny' : 'error',
        pluginId: envelope.pluginId,
        capability: envelope.capability,
        requestId: envelope.requestId,
        detail: timeout ? 'deadline-exceeded' : denied ? error.denialCode : 'handler-failed',
      });
      return this.failureResponse(
        envelope,
        timeout ? 'timeout' : denied ? 'denied' : 'failed',
        timeout ? 'deadline-exceeded' : denied ? error.denialCode : 'handler-failed',
      );
    } finally {
      this.inFlight.set(
        session.sessionId,
        Math.max(0, (this.inFlight.get(session.sessionId) ?? 1) - 1),
      );
    }
  }

  private successResponse(
    envelope: CapabilityRpcEnvelope,
    payload: unknown,
  ): CapabilityRpcResponse {
    return {
      schema: 'logicpilot.capability-rpc/v1',
      contractVersion: 1,
      generation: envelope.generation,
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      status: 'ok',
      payload: payload as CapabilityRpcResponse['payload'],
    };
  }

  private failureResponse(
    input: unknown,
    status: CapabilityRpcResponse['status'],
    errorCode: string,
  ): CapabilityRpcResponse {
    const value = (
      typeof input === 'object' && input !== null ? input : {}
    ) as Partial<CapabilityRpcEnvelope>;
    const response: CapabilityRpcResponse = {
      schema: 'logicpilot.capability-rpc/v1',
      contractVersion: 1,
      generation:
        typeof value.generation === 'number' && value.generation >= 1 ? value.generation : 1,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : 'invalid-session',
      requestId: typeof value.requestId === 'string' ? value.requestId : 'invalid-request',
      status,
      errorCode,
      payload: null,
    };
    if (
      typeof value.pluginId === 'string' &&
      typeof value.capability === 'string' &&
      typeof value.requestId === 'string'
    ) {
      this.audit({
        action: status === 'timeout' ? 'timeout' : 'deny',
        pluginId: value.pluginId,
        capability: value.capability,
        requestId: value.requestId,
        detail: errorCode,
      });
    }
    return response;
  }

  private renewSessionIfConfigured(session: PluginRuntimeSession): void {
    if (this.renewTtlMs === null) return;
    // A handler may finish after its session was revoked or replaced. Never
    // resurrect an identity from that stale in-flight invocation.
    if (this.sessions.get(session.sessionId) !== session) return;
    this.sessions.set(session.sessionId, {
      ...session,
      expiresAt: new Date(this.now() + this.renewTtlMs).toISOString(),
    });
  }

  private audit(event: Parameters<NonNullable<CapabilityBrokerOptions['onAudit']>>[0]): void {
    try {
      this.options.onAudit?.(event);
    } catch {
      // Auditors are observers and must not break authorization.
    }
  }
}

function permissionForCapability(capability: string): string {
  const mapping: Record<string, string> = {
    'runtime.log': 'runtime.log.write',
    'runtime.random': 'runtime.random.read',
    'runtime.clock': 'runtime.clock.read',
    'runtime.event.emit': 'runtime.event.emit',
    'runtime.event.subscribe': 'runtime.event.subscribe',
    'runtime.service.provide': 'runtime.service.provide',
    'runtime.service.call': 'runtime.service.call',
    'runtime.storage.read': 'runtime.storage.read',
    'runtime.storage.write': 'runtime.storage.write',
    'runtime.network.fetch': 'runtime.network.fetch',
  };
  return mapping[capability] ?? capability;
}

function jsonBytes(value: unknown): number {
  // UTF-16 code-unit length is a conservative bound for the JSON payload and
  // keeps this browser-safe package independent of DOM/Node typings.
  return (JSON.stringify(value) ?? '').length * 2;
}

class BrokerTimeoutError extends Error {}

function withDeadline<T>(promise: Promise<T>, deadlineMs: number, now: () => number): Promise<T> {
  const remaining = deadlineMs - now();
  if (remaining <= 0) return Promise.reject(new BrokerTimeoutError());
  let timer: unknown;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new BrokerTimeoutError()), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

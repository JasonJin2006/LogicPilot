import { describe, expect, it } from 'vitest';
import { CapabilityBroker } from '../src/index.js';

function envelope(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'logicpilot.capability-rpc/v1',
    contractVersion: 1,
    generation: 1,
    sessionId,
    pluginId: 'logicpilot.broker-test',
    requestId: `request-${Math.random().toString(36).slice(2)}`,
    deadlineMs: Date.now() + 1_000,
    capability: 'runtime.log',
    operation: 'write',
    payload: { value: 1 },
    ...overrides,
  };
}

describe('CapabilityBroker', () => {
  it('binds calls to session, generation and per-capability grants', async () => {
    const broker = new CapabilityBroker();
    const session = broker.registerSession({
      pluginId: 'logicpilot.broker-test',
      generation: 1,
      sha256: 'a'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 10_000,
    });
    broker.register('runtime.log', () => ({ accepted: true }));
    const allowed = await broker.invoke(envelope(session.sessionId));
    expect(allowed.status).toBe('ok');
    const denied = await broker.invoke(
      envelope(session.sessionId, { capability: 'runtime.random', operation: 'read' }),
    );
    expect(denied.status).toBe('denied');
    expect(denied.errorCode).toBe('permission-denied');
    const mismatch = await broker.invoke(envelope(session.sessionId, { generation: 2 }));
    expect(mismatch.errorCode).toBe('session-mismatch');
  });

  it('enforces deadlines and in-flight quotas', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let now = Date.now();
    const broker = new CapabilityBroker({ maxInFlightPerSession: 1, now: () => now });
    const session = broker.registerSession({
      pluginId: 'logicpilot.broker-test',
      generation: 1,
      sha256: 'b'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 10_000,
    });
    broker.register('runtime.log', async () => pending);
    const first = broker.invoke(envelope(session.sessionId, { deadlineMs: now + 5_000 }));
    const quota = await broker.invoke(envelope(session.sessionId, { deadlineMs: now + 5_000 }));
    expect(quota.errorCode).toBe('quota-in-flight');
    release();
    expect((await first).status).toBe('ok');
    now += 6_000;
    const timeout = await broker.invoke(envelope(session.sessionId, { deadlineMs: now - 1 }));
    expect(timeout.status).toBe('timeout');
  });

  it('rejects an expired session and a retired generation', async () => {
    let now = Date.now();
    const broker = new CapabilityBroker({ now: () => now });
    broker.register('runtime.log', () => ({ accepted: true }));
    const expiredSession = broker.registerSession({
      pluginId: 'logicpilot.broker-test',
      generation: 1,
      sha256: 'c'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 1_000,
    });
    const liveSession = broker.registerSession({
      pluginId: 'logicpilot.broker-test-2',
      generation: 1,
      sha256: 'e'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 10_000,
    });
    now += 2_000; // past the 1s session TTL
    expect((await broker.invoke(envelope(expiredSession.sessionId))).errorCode).toBe(
      'session-expired',
    );
    // Generation retirement is independent of (and checked before) expiry.
    broker.activateGeneration(2);
    expect(
      (
        await broker.invoke(
          envelope(liveSession.sessionId, {
            generation: 1,
            pluginId: liveSession.pluginId,
          }),
        )
      ).errorCode,
    ).toBe('generation-retired');
  });

  it('extends a session with renewSession and slides TTL on use', async () => {
    let now = Date.now();
    const broker = new CapabilityBroker({ now: () => now, renewTtlMs: 1_000 });
    const session = broker.registerSession({
      pluginId: 'logicpilot.broker-test',
      generation: 1,
      sha256: 'd'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 100,
    });
    broker.register('runtime.log', () => ({ accepted: true }));
    // Explicit renewal extends the expiry and the call succeeds past the old TTL.
    broker.renewSession(session.sessionId, 1_000);
    now += 500;
    expect((await broker.invoke(envelope(session.sessionId))).status).toBe('ok');
    // The sliding renewal keeps an actively-used session alive well past its
    // initial 100ms TTL.
    now += 400;
    expect((await broker.invoke(envelope(session.sessionId))).status).toBe('ok');
    expect(broker.sessionInfo(session.sessionId)?.expiresAt).toBeDefined();
    now += 2_000; // beyond every renewal window, but no call -> inert expiry
    expect((await broker.invoke(envelope(session.sessionId))).errorCode).toBe('session-expired');
  });

  it('does not resurrect a session revoked while a capability is in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const broker = new CapabilityBroker({ renewTtlMs: 1_000 });
    const session = broker.registerSession({
      pluginId: 'logicpilot.broker-test',
      generation: 1,
      sha256: 'f'.repeat(64),
      trust: 't2',
      grants: [{ permissionId: 'runtime.log.write', granted: true }],
      ttlMs: 10_000,
    });
    broker.register('runtime.log', async () => pending);
    const invocation = broker.invoke(envelope(session.sessionId));
    broker.revokeSession(session.sessionId);
    release();
    expect((await invocation).status).toBe('ok');
    expect(broker.sessionInfo(session.sessionId)).toBeUndefined();
  });
});

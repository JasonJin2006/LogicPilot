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
});

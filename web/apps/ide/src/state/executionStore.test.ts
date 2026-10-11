import { describe, expect, it } from 'vitest';
import type { ExecutionEvent, ExecutionSession } from '@logicpilot/contracts';
import { useExecutionStore } from './executionStore';

const session: ExecutionSession = {
  schema: 'logicpilot.execution-session/v1',
  contractVersion: 1,
  runId: 'run-1',
  requestId: 'request-1',
  targetId: 'logicpilot.native.session',
  status: 'running',
  stateVersion: 0,
  capabilities: { cancel: true, telemetry: true, snapshot: true },
  createdAt: '2026-09-06T00:00:00.000Z',
};

function event(
  seq: number,
  payload: unknown,
  kind: ExecutionEvent['kind'] = 'state',
): ExecutionEvent {
  return {
    schema: 'logicpilot.execution-event/v1',
    contractVersion: 1,
    runId: 'run-1',
    seq,
    kind,
    payload: payload as ExecutionEvent['payload'],
  };
}

describe('executionStore', () => {
  it('applies a query and ignores duplicate or out-of-order events', () => {
    const store = useExecutionStore.getState();
    store.reset();
    store.applyQuery({
      schema: 'logicpilot.execution-session-query/v1',
      contractVersion: 1,
      session,
      events: [event(0, session)],
      nextSeq: 0,
      gap: false,
    });
    store.applyEvent(event(0, session));
    store.applyEvent(event(2, { value: 3 }, 'telemetry'));
    const state = useExecutionStore.getState();
    expect(state.events.map((item) => item.seq)).toEqual([0, 2]);
    expect(state.lastSeq).toBe(2);
    expect(state.gap).toBe(true);
  });

  it('drops events belonging to another run and updates terminal sessions', () => {
    const store = useExecutionStore.getState();
    store.reset();
    store.begin(session);
    store.applyEvent({
      ...event(0, { value: 1 }, 'telemetry'),
      runId: 'other-run',
    });
    const completed = { ...session, status: 'completed' as const, stateVersion: 1 };
    store.applyEvent(event(0, completed, 'terminal'));
    expect(useExecutionStore.getState().session?.status).toBe('completed');
    expect(useExecutionStore.getState().events).toHaveLength(1);
  });
});

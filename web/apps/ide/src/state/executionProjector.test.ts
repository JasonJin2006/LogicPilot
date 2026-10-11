import { describe, expect, it } from 'vitest';
import { projectExecutionEvent } from './executionProjector';
import { resetVizState, vizState } from './vizState';

describe('executionProjector', () => {
  it('projects transport time without naming a modeling paradigm', () => {
    resetVizState(vizState);
    const before = vizState.tickVersion;
    expect(
      projectExecutionEvent({
        schema: 'logicpilot.execution-event/v1',
        contractVersion: 1,
        runId: 'run-1',
        seq: 0,
        kind: 'telemetry',
        payload: { simTimeNs: 1_500_000_000, dispatched: 3, pending: true },
      }),
    ).toBe(true);
    expect(vizState.simTime).toBe(1.5);
    expect(vizState.tickVersion).toBe(before + 1);
  });

  it('ignores state events and malformed telemetry payloads', () => {
    resetVizState(vizState);
    const before = vizState.tickVersion;
    expect(
      projectExecutionEvent({
        schema: 'logicpilot.execution-event/v1',
        contractVersion: 1,
        runId: 'run-1',
        seq: 0,
        kind: 'state',
        payload: {},
      }),
    ).toBe(false);
    expect(
      projectExecutionEvent({
        schema: 'logicpilot.execution-event/v1',
        contractVersion: 1,
        runId: 'run-1',
        seq: 1,
        kind: 'telemetry',
        payload: 'invalid',
      }),
    ).toBe(false);
    expect(vizState.tickVersion).toBe(before);
  });
});

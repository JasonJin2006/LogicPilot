import type { ExecutionEvent } from '@logicpilot/contracts';
import { vizState } from './vizState';

export type ExecutionTelemetryProjector = (
  values: Readonly<Record<string, number>>,
  state: typeof vizState,
) => void;

const telemetryProjectors = new Set<ExecutionTelemetryProjector>();

export function registerExecutionTelemetryProjector(
  projector: ExecutionTelemetryProjector,
): () => void {
  telemetryProjectors.add(projector);
  return () => telemetryProjectors.delete(projector);
}

/** Project transport-level execution progress into the renderer-neutral state.
 * Method-specific counters stay in paradigm telemetry projectors. */
export function projectExecutionEvent(event: ExecutionEvent): boolean {
  if (event.kind !== 'telemetry' || typeof event.payload !== 'object' || event.payload === null)
    return false;
  const payload = event.payload as Record<string, unknown>;
  const simTimeNs = payload.simTimeNs;
  if (typeof simTimeNs === 'number' && Number.isFinite(simTimeNs)) {
    vizState.simTime = Math.max(0, simTimeNs / 1e9);
  }
  if (typeof payload.telemetry === 'object' && payload.telemetry !== null) {
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(payload.telemetry)) {
      if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
    }
    for (const projector of telemetryProjectors) projector(values, vizState);
  }
  vizState.tickVersion += 1;
  return true;
}

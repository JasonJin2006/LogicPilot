import type { AgentStepRequest, AgentStepResult } from '@logicpilot/contracts';

/** Provider-neutral, metadata-only trace emitted around an AgentEngine step.
 * Arguments, prompts and model output are intentionally excluded by default;
 * callers that need sensitive capture must add an explicit, separately
 * governed recorder. */
export interface AgentEngineTraceEvent {
  readonly phase: 'started' | 'completed' | 'failed';
  readonly turnId: string;
  readonly engineId: string;
  readonly stepIndex: number;
  readonly at: string;
  readonly latencyMs?: number;
  readonly status?: AgentStepResult['status'];
  readonly toolNames?: ReadonlyArray<string>;
  readonly error?: string;
}

export type AgentEngineTraceSink = (event: AgentEngineTraceEvent) => void;

/** Keep provider text out of the metadata-only channel. Detailed failures
 * belong in a separately governed diagnostic store. */
export function traceErrorCategory(error: unknown): string {
  if (error instanceof Error && error.name.trim() !== '') return error.name.slice(0, 96);
  return 'unknown-error';
}

export function traceRequestEvent(
  request: AgentStepRequest,
  at = new Date().toISOString(),
): AgentEngineTraceEvent {
  return {
    phase: 'started',
    turnId: request.turnId,
    engineId: request.engineId,
    stepIndex: request.stepIndex,
    at,
    toolNames: request.tools.map((tool) => tool.name),
  };
}

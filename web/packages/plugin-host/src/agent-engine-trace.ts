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

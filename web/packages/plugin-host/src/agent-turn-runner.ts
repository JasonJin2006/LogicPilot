import type {
  AgentStepRequest,
  AgentStepResult,
  JsonValue,
  ToolCall,
  ToolResult,
} from '@logicpilot/contracts';
import type { AgentEngine } from './agent-engine-registry.js';

export interface AgentTurnRunnerOptions {
  readonly engine: AgentEngine;
  readonly request: AgentStepRequest;
  /** Approval is deliberately explicit. Omitting it denies every call. */
  readonly approveTool?: (call: ToolCall, request: AgentStepRequest) => Promise<boolean> | boolean;
  /** The host owns the actual tool execution, capability checks and transactions. */
  readonly executeTool: (
    call: ToolCall,
    request: AgentStepRequest,
  ) => Promise<JsonValue> | JsonValue;
  readonly maxSteps?: number;
}

export interface AgentTurnRun {
  readonly result: AgentStepResult;
  readonly steps: ReadonlyArray<AgentStepResult>;
  readonly toolResults: ReadonlyArray<ToolResult>;
}

/** Provider-neutral host loop. Engines only propose calls; this runner applies
 * approval and executes them outside the model, then resumes from the exact
 * checkpoint returned by the engine. */
export async function runAgentTurn(options: AgentTurnRunnerOptions): Promise<AgentTurnRun> {
  const maxSteps = options.maxSteps ?? 16;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new Error('agent turn maxSteps must be a positive integer');
  const steps: AgentStepResult[] = [];
  let request = options.request;
  let allToolResults: ToolResult[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const result = await options.engine.runStep(request);
    steps.push(result);
    if (result.status !== 'continue') return { result, steps, toolResults: allToolResults };
    if (result.toolCalls.length === 0)
      throw new Error('agent engine returned continue without tool calls');
    if (result.checkpoint === undefined)
      throw new Error('agent engine returned continue without a checkpoint');
    const toolResults = await executeApprovedCalls(result.toolCalls, request, options);
    allToolResults = [...allToolResults, ...toolResults];
    request = {
      ...options.request,
      stepIndex: request.stepIndex + 1,
      checkpoint: result.checkpoint,
      toolResults,
    };
  }
  throw new Error(`agent turn exceeded the ${maxSteps}-step limit`);
}

async function executeApprovedCalls(
  calls: ReadonlyArray<ToolCall>,
  request: AgentStepRequest,
  options: AgentTurnRunnerOptions,
): Promise<ToolResult[]> {
  const seen = new Set<string>();
  const results: ToolResult[] = [];
  for (const call of calls) {
    if (seen.has(call.callId)) throw new Error(`duplicate agent tool call '${call.callId}'`);
    seen.add(call.callId);
    const approved = (await options.approveTool?.(call, request)) ?? false;
    if (!approved) {
      results.push({
        callId: call.callId,
        ok: false,
        content: null,
        error: 'tool call was denied by the host',
      });
      continue;
    }
    try {
      results.push({
        callId: call.callId,
        ok: true,
        content: await options.executeTool(call, request),
      });
    } catch (error) {
      results.push({
        callId: call.callId,
        ok: false,
        content: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

import type { AgentStepRequest, AgentStepResult, JsonValue, ToolCall } from '@logicpilot/contracts';
import type { AgentEngine } from './agent-engine-registry.js';

export interface SdkRunnerInput {
  readonly input: JsonValue;
  readonly tools: AgentStepRequest['tools'];
  readonly compiledContext?: JsonValue;
  readonly maxTokens?: number;
}

export interface SdkRunnerOutput {
  readonly status?: 'continue' | 'done' | 'cancelled' | 'failed';
  readonly message?: JsonValue;
  readonly plan?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly toolCalls?: ReadonlyArray<{
    readonly callId?: string;
    readonly id?: string;
    readonly name: string;
    readonly arguments: JsonValue;
  }>;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly latencyMs?: number;
  };
  readonly error?: string;
}

export interface SdkRunner {
  run(input: SdkRunnerInput): Promise<SdkRunnerOutput>;
  cancel?(turnId: string): Promise<void> | void;
}

/** Provider-neutral bridge for an external Agent SDK (OpenAI Agents, Cordis
 * adapter, or another runner). The SDK receives only the already compiled
 * tool set; any tool call outside that set is rejected before it reaches the
 * host executor. */
export class SdkAgentEngineAdapter implements AgentEngine {
  readonly descriptor = {
    schema: 'logicpilot.agent-engine-descriptor/v1' as const,
    contractVersion: 1 as const,
    id: 'sdk.openai-agents' as const,
    implementation: 'openai-agents' as const,
  };

  constructor(private readonly runner: SdkRunner) {}

  async runStep(request: AgentStepRequest): Promise<AgentStepResult> {
    const allowed = new Set(request.tools.map((tool) => tool.name));
    const result = await this.runner.run({
      input: request.input,
      tools: request.tools,
      ...(request.compiledContext === undefined
        ? {}
        : { compiledContext: request.compiledContext }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    });
    const calls: ToolCall[] = [];
    for (const call of result.toolCalls ?? []) {
      if (!allowed.has(call.name)) {
        throw new Error(`SDK proposed tool '${call.name}' outside the compiled tool set`);
      }
      calls.push({
        callId: call.callId ?? call.id ?? `sdk-call-${calls.length + 1}`,
        name: call.name,
        arguments: call.arguments,
      });
    }
    return {
      schema: 'logicpilot.agent-step-result/v1',
      contractVersion: 1,
      turnId: request.turnId,
      engineId: request.engineId,
      stepIndex: request.stepIndex,
      status: result.status ?? (calls.length > 0 ? 'continue' : 'done'),
      ...(result.message === undefined ? {} : { message: result.message }),
      ...(result.plan === undefined ? {} : { plan: result.plan }),
      toolCalls: calls,
      toolResults: [],
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  }

  cancel(turnId: string): Promise<void> | void {
    return this.runner.cancel?.(turnId);
  }
}

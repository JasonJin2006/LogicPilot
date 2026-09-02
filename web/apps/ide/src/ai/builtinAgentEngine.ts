import type {
  AgentStepRequest,
  AgentStepResult,
  JsonValue,
  ToolDescriptor,
} from '@logicpilot/contracts';
import type { AgentEngine } from '@logicpilot/plugin-host';
import type { AssistantStepResponse, AssistantTurnMessage } from './assistantTypes';

export interface BuiltinAgentInput {
  readonly messages: readonly AssistantTurnMessage[];
  readonly context: unknown;
}

export type BuiltinAgentTransport = (input: BuiltinAgentInput) => Promise<AssistantStepResponse>;

/** Adapter for the current LogicPilot loop behind the frozen AgentEngine
 * contract. It deliberately only translates one model step; tool execution,
 * approval and artifact transactions remain in assistantRuntime. */
export class BuiltinAgentEngine implements AgentEngine {
  readonly descriptor = {
    schema: 'logicpilot.agent-engine-descriptor/v1' as const,
    contractVersion: 1 as const,
    id: 'builtin',
    implementation: 'builtin' as const,
  };

  constructor(private readonly transport: BuiltinAgentTransport) {}

  async runStep(request: AgentStepRequest): Promise<AgentStepResult> {
    const input = request.input;
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      !Array.isArray((input as unknown as { messages?: unknown }).messages)
    ) {
      throw new Error('builtin agent input must contain a messages array');
    }
    const response = await this.transport({
      messages: (input as unknown as { messages: AssistantTurnMessage[] }).messages,
      context: (input as unknown as { context?: unknown }).context,
    });
    return {
      schema: 'logicpilot.agent-step-result/v1',
      contractVersion: 1,
      turnId: request.turnId,
      engineId: request.engineId,
      stepIndex: request.stepIndex,
      status: response.done ? 'done' : 'continue',
      ...(response.message === undefined ? {} : { message: response.message }),
      ...(response.plan.length === 0
        ? {}
        : {
            plan: response.plan.map((step) => ({ id: step.id, label: step.label })),
          }),
      toolCalls: response.toolCalls.map((call) => ({
        callId: call.id,
        name: call.name,
        arguments: call.arguments as JsonValue,
      })),
      toolResults: [],
      ...(response.usage === undefined ? {} : { usage: response.usage }),
    };
  }
}

export function decodeBuiltinAgentResult(result: AgentStepResult): AssistantStepResponse {
  return {
    message: typeof result.message === 'string' ? result.message : '',
    plan: result.plan?.map((step) => ({ id: step.id, label: step.label })) ?? [],
    toolCalls: result.toolCalls.map((call) => ({
      id: call.callId,
      name: call.name,
      arguments:
        call.arguments !== null &&
        typeof call.arguments === 'object' &&
        !Array.isArray(call.arguments)
          ? (call.arguments as Record<string, unknown>)
          : {},
    })),
    done: result.status === 'done',
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.checkpoint === undefined ? {} : { checkpoint: result.checkpoint }),
  };
}

export function toolDescriptors(
  tools: readonly { name: string; description: string; parameters: Record<string, unknown> }[],
): ToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as ToolDescriptor['parameters'],
  }));
}

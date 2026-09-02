import { Agent, run } from '@openai/agents';
import type { Model } from '@openai/agents';
import type {
  AgentStepRequest,
  AgentStepResult,
  JsonValue,
  ToolDescriptor,
} from '@logicpilot/contracts';
import type { AgentEngine } from '@logicpilot/plugin-host';

export interface OpenAiAgentsEngineOptions {
  readonly model?: string | Model;
  readonly name?: string;
  readonly instructions?: string;
  readonly timeoutMs?: number;
}

/** Real OpenAI Agents SDK adapter. Tools are approval-gated SDK function
 * descriptors: the SDK reports an interruption, while LogicPilot remains the
 * authority that executes the tool after its own approval/capability checks. */
export class OpenAiAgentsEngine implements AgentEngine {
  readonly descriptor = {
    schema: 'logicpilot.agent-engine-descriptor/v1' as const,
    contractVersion: 1 as const,
    id: 'sdk.openai-agents' as const,
    implementation: 'openai-agents' as const,
  };
  private readonly options: Required<
    Pick<OpenAiAgentsEngineOptions, 'model' | 'name' | 'instructions'>
  >;
  private readonly timeoutMs: number;
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(options: OpenAiAgentsEngineOptions = {}) {
    this.options = {
      model: options.model ?? 'gpt-5.6-sol',
      name: options.name ?? 'LogicPilot SDK Agent',
      instructions:
        options.instructions ??
        'Return concise, grounded responses. Use only the tools explicitly provided by the host.',
    };
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1)
      throw new Error('OpenAI Agents engine timeoutMs must be a positive integer');
  }

  async runStep(request: AgentStepRequest): Promise<AgentStepResult> {
    const tools = request.tools.map((descriptor) => sdkApprovalTool(descriptor));
    const agent = new Agent({
      name: this.options.name,
      model: this.options.model,
      instructions: this.options.instructions,
      tools: tools as never,
      // Stop after the first approved tool interruption; LogicPilot executes
      // it in the outer host loop and never gives the SDK hidden authority.
      toolUseBehavior: 'stop_on_first_tool',
    });
    const controller = new AbortController();
    this.activeControllers.set(request.turnId, controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let result;
    try {
      result = await run(agent, JSON.stringify(request.input), {
        maxTurns: 1,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          schema: 'logicpilot.agent-step-result/v1',
          contractVersion: 1,
          turnId: request.turnId,
          engineId: request.engineId,
          stepIndex: request.stepIndex,
          status: timedOut ? 'failed' : 'cancelled',
          toolCalls: [],
          toolResults: [],
          error: timedOut ? 'agent engine step timed out' : 'agent engine step cancelled',
          plan: [],
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(request.turnId);
    }
    const interruptions = result.interruptions ?? [];
    const toolCalls = interruptions.map((item, index) => ({
      callId: (item.rawItem as unknown as { callId?: string }).callId ?? `sdk-call-${index + 1}`,
      name: item.name ?? '',
      arguments: parseArguments(item.arguments),
    }));
    const allowed = new Set(request.tools.map((tool) => tool.name));
    for (const call of toolCalls) {
      if (!allowed.has(call.name))
        throw new Error(`SDK proposed tool '${call.name}' outside the compiled tool set`);
    }
    return {
      schema: 'logicpilot.agent-step-result/v1',
      contractVersion: 1,
      turnId: request.turnId,
      engineId: request.engineId,
      stepIndex: request.stepIndex,
      status: toolCalls.length > 0 ? 'continue' : 'done',
      ...(interruptions.length === 0 && typeof result.finalOutput === 'string'
        ? { message: result.finalOutput }
        : {}),
      toolCalls,
      plan: [],
      toolResults: [],
    };
  }

  cancel(turnId: string): void {
    this.activeControllers.get(turnId)?.abort();
  }
}

function parseArguments(value: string | undefined): JsonValue {
  if (value === undefined || value.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      ? {}
      : (parsed as JsonValue);
  } catch {
    return {};
  }
}

function sdkApprovalTool(descriptor: ToolDescriptor): unknown {
  return {
    type: 'function',
    name: descriptor.name,
    description: descriptor.description ?? descriptor.name,
    parameters: normalizeParameters(descriptor.parameters),
    strict: false,
    needsApproval: async () => true,
    invoke: async () => {
      throw new Error('LogicPilot host must execute this tool after approval');
    },
  };
}

function normalizeParameters(parameters: ToolDescriptor['parameters']): Record<string, unknown> {
  if (
    typeof parameters === 'object' &&
    parameters !== null &&
    !Array.isArray(parameters) &&
    (parameters as { type?: unknown }).type === 'object' &&
    'properties' in parameters
  ) {
    return parameters as Record<string, unknown>;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters)) {
    for (const [name, value] of Object.entries(parameters)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const schema = { ...value } as Record<string, unknown>;
      if (schema.required === true) {
        required.push(name);
        delete schema.required;
      }
      properties[name] = schema;
    }
  }
  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  };
}

export { normalizeParameters, parseArguments };

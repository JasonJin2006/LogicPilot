import { describe, expect, it } from 'vitest';
import { AgentEngineRegistry, SdkAgentEngineAdapter } from '../src/index.js';

function request() {
  return {
    schema: 'logicpilot.agent-step-request/v1',
    contractVersion: 1,
    turnId: 'turn-sdk-1',
    engineId: 'sdk.openai-agents',
    stepIndex: 2,
    input: { prompt: 'inspect' },
    compiledContext: { generation: 4 },
    tools: [{ name: 'inspect_model', description: 'inspect', parameters: { type: 'object' } }],
  } as const;
}

describe('SdkAgentEngineAdapter', () => {
  it('forwards compiled tools/context and normalizes SDK output', async () => {
    const seen: unknown[] = [];
    const engine = new SdkAgentEngineAdapter({
      run: async (input) => {
        seen.push(input);
        return {
          status: 'continue',
          message: 'checking',
          plan: [{ id: 'p1', label: 'Inspect' }],
          toolCalls: [{ id: 'sdk-call-1', name: 'inspect_model', arguments: {} }],
          checkpoint: {
            schema: 'logicpilot.agent-checkpoint/v1',
            contractVersion: 1,
            turnId: 'turn-sdk-1',
            engineId: 'sdk.openai-agents',
            revision: 1,
            state: 'serialized-state',
          },
        };
      },
    });
    const registry = new AgentEngineRegistry();
    registry.register(engine);
    const result = await registry.runStep('sdk.openai-agents', request());
    expect(result.status).toBe('continue');
    expect(result.plan?.[0]?.id).toBe('p1');
    expect(result.toolCalls[0]?.callId).toBe('sdk-call-1');
    expect(result.checkpoint?.state).toBe('serialized-state');
    expect((seen[0] as { compiledContext?: unknown }).compiledContext).toEqual({ generation: 4 });
  });

  it('rejects a tool call outside the exact compiled set', async () => {
    const engine = new SdkAgentEngineAdapter({
      run: async () => ({
        toolCalls: [{ name: 'delete_everything', arguments: {} }],
      }),
    });
    await expect(engine.runStep(request())).rejects.toThrow(/outside the compiled tool set/);
  });
});

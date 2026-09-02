import { describe, expect, it } from 'vitest';
import { AgentEngineRegistry } from '../src/index.js';

const descriptor = {
  schema: 'logicpilot.agent-engine-descriptor/v1',
  contractVersion: 1,
  id: 'builtin-test',
  implementation: 'builtin',
};

function request(engineId = 'builtin-test') {
  return {
    schema: 'logicpilot.agent-step-request/v1',
    contractVersion: 1,
    turnId: 'turn-1',
    engineId,
    stepIndex: 0,
    input: { message: 'hello' },
    tools: [],
  };
}

describe('AgentEngineRegistry', () => {
  it('validates engine descriptors and step request/results at the boundary', async () => {
    const registry = new AgentEngineRegistry();
    registry.register({
      descriptor,
      runStep: async () => ({
        schema: 'logicpilot.agent-step-result/v1',
        contractVersion: 1,
        turnId: 'turn-1',
        engineId: 'builtin-test',
        stepIndex: 0,
        status: 'done',
        toolCalls: [],
        toolResults: [],
      }),
    });
    const result = await registry.runStep('builtin-test', request());
    expect(result.status).toBe('done');
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects engine mismatches and stale disposers cannot remove replacements', async () => {
    const registry = new AgentEngineRegistry();
    const engine = {
      descriptor,
      runStep: async () => ({
        schema: 'logicpilot.agent-step-result/v1',
        contractVersion: 1,
        turnId: 'turn-1',
        engineId: 'builtin-test',
        stepIndex: 0,
        status: 'done',
        toolCalls: [],
        toolResults: [],
      }),
    };
    const dispose = registry.register(engine);
    dispose();
    registry.register(engine);
    await expect(registry.runStep('builtin-test', request('other'))).rejects.toThrow(/mismatch/);
    expect(registry.list()).toHaveLength(1);
  });

  it('preserves prototype methods when registering class-based engines', async () => {
    class TestEngine {
      readonly descriptor = {
        schema: 'logicpilot.agent-engine-descriptor/v1' as const,
        contractVersion: 1 as const,
        id: 'class-engine',
        implementation: 'builtin' as const,
      };

      async runStep(step: ReturnType<typeof request>) {
        return {
          schema: 'logicpilot.agent-step-result/v1' as const,
          contractVersion: 1 as const,
          turnId: step.turnId,
          engineId: step.engineId,
          stepIndex: step.stepIndex,
          status: 'done' as const,
          toolCalls: [],
          toolResults: [],
        };
      }
    }
    const registry = new AgentEngineRegistry();
    registry.register(new TestEngine());
    const result = await registry.runStep('class-engine', request('class-engine'));
    expect(result.status).toBe('done');
  });
});

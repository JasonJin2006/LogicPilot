import { describe, expect, it } from 'vitest';
import { AgentEngineRegistry, benchmarkAgentEngines, parityRequest } from '../src/index.js';

function engine(id: string) {
  return {
    descriptor: {
      schema: 'logicpilot.agent-engine-descriptor/v1' as const,
      contractVersion: 1 as const,
      id,
      implementation: 'builtin' as const,
    },
    runStep: async (request: ReturnType<typeof parityRequest>) => ({
      schema: 'logicpilot.agent-step-result/v1' as const,
      contractVersion: 1 as const,
      turnId: request.turnId,
      engineId: request.engineId,
      stepIndex: request.stepIndex,
      status: 'done' as const,
      message: 'same',
      plan: [{ id: 'p1', label: 'same' }],
      toolCalls: [],
      toolResults: [],
    }),
  };
}

describe('AgentEngine parity harness', () => {
  it('reports equivalent provider-neutral output', async () => {
    const primary = engine('builtin');
    const candidate = engine('candidate');
    const report = await benchmarkAgentEngines(primary, candidate, [
      { id: 'basic', request: parityRequest({ prompt: 'hello' }) },
    ]);
    expect(report.passed).toBe(true);
    expect(report.cases[0]?.differences).toEqual([]);
  });

  it('normalizes the candidate engine id before running', async () => {
    const registry = new AgentEngineRegistry();
    const candidate = engine('candidate');
    registry.register(candidate);
    await expect(
      registry.runStep('candidate', parityRequest({}, 'candidate')),
    ).resolves.toMatchObject({
      engineId: 'candidate',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { ScriptedModel, functionCall, modelResponse } from '@openai/agents/testing';
import type { AgentEngine, AgentStepResult } from '@logicpilot/plugin-host';
import { benchmarkAgentEngines, parityRequest } from '@logicpilot/plugin-host';
import { OpenAiAgentsEngine } from '../src/index.js';

function builtinResult(request: Parameters<AgentEngine['runStep']>[0]): AgentStepResult {
  return {
    schema: 'logicpilot.agent-step-result/v1',
    contractVersion: 1,
    turnId: request.turnId,
    engineId: request.engineId,
    stepIndex: request.stepIndex,
    status: 'continue',
    plan: [],
    toolCalls: [{ callId: 'parity-call-1', name: 'inspect_model', arguments: {} }],
    toolResults: [],
  };
}

describe('Builtin/OpenAI AgentEngine parity', () => {
  it('matches the provider-neutral tool interruption contract', async () => {
    const model = new ScriptedModel([
      modelResponse([functionCall('inspect_model', {}, { callId: 'parity-call-1' })]),
    ]);
    const primary: AgentEngine = {
      descriptor: {
        schema: 'logicpilot.agent-engine-descriptor/v1',
        contractVersion: 1,
        id: 'builtin',
        implementation: 'builtin',
      },
      runStep: async (request) => builtinResult(request),
    };
    const candidate = new OpenAiAgentsEngine({ model });
    const report = await benchmarkAgentEngines(primary, candidate, [
      {
        id: 'tool-interruption',
        request: {
          ...parityRequest({ prompt: 'inspect' }, 'builtin'),
          tools: [
            { name: 'inspect_model', description: 'inspect', parameters: { type: 'object' } },
          ],
        },
      },
    ]);
    expect(report.passed).toBe(true);
    expect(report.cases[0]).toMatchObject({ caseId: 'tool-interruption', equivalent: true });
    expect(model.calls).toHaveLength(1);
  });
});

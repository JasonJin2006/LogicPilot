import { describe, expect, it } from 'vitest';
import type { AgentStepRequest, AgentStepResult } from '@logicpilot/contracts';
import type { AgentEngine } from '../src/agent-engine-registry.js';
import { runAgentTurn } from '../src/index.js';

const request: AgentStepRequest = {
  schema: 'logicpilot.agent-step-request/v1',
  contractVersion: 1,
  turnId: 'turn-runner',
  engineId: 'test-engine',
  stepIndex: 0,
  input: { prompt: 'inspect' },
  tools: [{ name: 'inspect_model', parameters: { type: 'object' } }],
};

function result(request: AgentStepRequest, overrides: Partial<AgentStepResult>): AgentStepResult {
  return {
    schema: 'logicpilot.agent-step-result/v1',
    contractVersion: 1,
    turnId: request.turnId,
    engineId: request.engineId,
    stepIndex: request.stepIndex,
    status: 'done',
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

describe('runAgentTurn', () => {
  it('keeps approval and execution outside the engine and resumes in order', async () => {
    const seen: AgentStepRequest[] = [];
    const engine: AgentEngine = {
      descriptor: {
        schema: 'logicpilot.agent-engine-descriptor/v1',
        contractVersion: 1,
        id: 'test-engine',
        implementation: 'builtin',
      },
      runStep: async (step) => {
        seen.push(step);
        return step.checkpoint === undefined
          ? result(step, {
              status: 'continue',
              toolCalls: [{ callId: 'call-1', name: 'inspect_model', arguments: {} }],
              checkpoint: {
                schema: 'logicpilot.agent-checkpoint/v1',
                contractVersion: 1,
                turnId: step.turnId,
                engineId: step.engineId,
                revision: 1,
                state: 'checkpoint',
              },
            })
          : result(step, { message: 'done' });
      },
    };
    const executed: string[] = [];
    const run = await runAgentTurn({
      engine,
      request,
      approveTool: async (call) => call.name === 'inspect_model',
      executeTool: async (call) => {
        executed.push(call.name);
        return { nodes: 0 };
      },
    });
    expect(run.result.message).toBe('done');
    expect(executed).toEqual(['inspect_model']);
    expect(run.toolResults).toEqual([{ callId: 'call-1', ok: true, content: { nodes: 0 } }]);
    expect(seen[1]?.toolResults).toEqual(run.toolResults);
    expect(seen[1]?.checkpoint?.state).toBe('checkpoint');
  });

  it('denies calls by default and bounds engines that omit checkpoints', async () => {
    const engine: AgentEngine = {
      descriptor: {
        schema: 'logicpilot.agent-engine-descriptor/v1',
        contractVersion: 1,
        id: 'test-engine',
        implementation: 'builtin',
      },
      runStep: async (step) =>
        result(step, {
          status: 'continue',
          toolCalls: [{ callId: 'call-1', name: 'inspect_model', arguments: {} }],
        }),
    };
    await expect(runAgentTurn({ engine, request, executeTool: () => ({}) })).rejects.toThrow(
      /without a checkpoint/,
    );
  });

  it('turns an explicit approval denial into a model-visible tool result', async () => {
    const requests: AgentStepRequest[] = [];
    const engine: AgentEngine = {
      descriptor: {
        schema: 'logicpilot.agent-engine-descriptor/v1',
        contractVersion: 1,
        id: 'test-engine',
        implementation: 'builtin',
      },
      runStep: async (step) => {
        requests.push(step);
        return requests.length === 1
          ? result(step, {
              status: 'continue',
              toolCalls: [{ callId: 'call-denied', name: 'inspect_model', arguments: {} }],
              checkpoint: {
                schema: 'logicpilot.agent-checkpoint/v1',
                contractVersion: 1,
                turnId: step.turnId,
                engineId: step.engineId,
                revision: 1,
                state: 'checkpoint',
              },
            })
          : result(step, { message: 'denied handled' });
      },
    };
    const run = await runAgentTurn({
      engine,
      request,
      approveTool: () => false,
      executeTool: () => {
        throw new Error('must not execute');
      },
    });
    expect(run.result.message).toBe('denied handled');
    expect(requests[1]?.toolResults[0]).toMatchObject({
      callId: 'call-denied',
      ok: false,
    });
  });
});

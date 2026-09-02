import { describe, expect, it, vi } from 'vitest';
import { ScriptedModel, functionCall, modelResponse } from '@openai/agents/testing';
import type { AgentStepRequest } from '@logicpilot/contracts';
import { OpenAiAgentsEngine, normalizeParameters, parseArguments } from '../src/index.js';

describe('OpenAI Agents SDK adapter helpers', () => {
  it('parses only JSON object arguments', () => {
    expect(parseArguments('{"query":"model"}')).toEqual({ query: 'model' });
    expect(parseArguments('[]')).toEqual({});
    expect(parseArguments('bad')).toEqual({});
  });

  it('converts LogicPilot parameter entries to standard JSON Schema', () => {
    expect(
      normalizeParameters({
        query: { type: 'string', required: true },
        limit: { type: 'number' },
      } as never),
    ).toEqual({
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('runs a real SDK Runner and returns approval interruptions without executing tools', async () => {
    const model = new ScriptedModel([
      modelResponse([functionCall('inspect_model', {}, { callId: 'sdk-call-1' })]),
    ]);
    const engine = new OpenAiAgentsEngine({ model });
    const request: AgentStepRequest = {
      schema: 'logicpilot.agent-step-request/v1',
      contractVersion: 1,
      turnId: 'sdk-test-turn',
      engineId: 'sdk.openai-agents',
      stepIndex: 0,
      input: { prompt: 'inspect' },
      tools: [{ name: 'inspect_model', description: 'inspect', parameters: { type: 'object' } }],
    };
    const result = await engine.runStep(request);
    expect(result.status).toBe('continue');
    expect(result.toolCalls[0]).toMatchObject({ callId: 'sdk-call-1', name: 'inspect_model' });
    expect(model.calls).toHaveLength(1);
  });

  it('cancels an in-flight SDK model request and reports a cancelled step', async () => {
    let requestSignal: AbortSignal | undefined;
    const model = {
      getResponse: async (request: { signal?: AbortSignal }) =>
        await new Promise<never>((_resolve, reject) => {
          requestSignal = request.signal;
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    } as never;
    const engine = new OpenAiAgentsEngine({ model, timeoutMs: 5_000 });
    const request: AgentStepRequest = {
      schema: 'logicpilot.agent-step-request/v1',
      contractVersion: 1,
      turnId: 'sdk-cancel-turn',
      engineId: 'sdk.openai-agents',
      stepIndex: 0,
      input: { prompt: 'wait' },
      tools: [],
    };
    const pending = engine.runStep(request);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    engine.cancel(request.turnId);
    await expect(pending).resolves.toMatchObject({
      status: 'cancelled',
      error: expect.stringMatching(/cancelled/),
    });
  });

  it('returns a failed step when the configured timeout expires', async () => {
    const model = {
      getResponse: async (request: { signal?: AbortSignal }) =>
        await new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    } as never;
    const engine = new OpenAiAgentsEngine({ model, timeoutMs: 10 });
    await expect(
      engine.runStep({
        schema: 'logicpilot.agent-step-request/v1',
        contractVersion: 1,
        turnId: 'sdk-timeout-turn',
        engineId: 'sdk.openai-agents',
        stepIndex: 0,
        input: { prompt: 'wait' },
        tools: [],
      }),
    ).resolves.toMatchObject({ status: 'failed', error: expect.stringMatching(/timed out/) });
  });
});

import { describe, expect, it } from 'vitest';
import {
  AssistantKernel,
  compactAssistantMessages,
  createAssistantKernel,
} from './assistantKernel';
import type { AssistantStepResponse, AssistantToolCall } from './assistantTypes';

const call: AssistantToolCall = {
  id: 'call-1',
  name: 'inspect_model',
  arguments: {},
};

const response: AssistantStepResponse = {
  message: 'I will inspect the model.',
  plan: [{ id: 'step-1', label: 'Inspect model' }],
  toolCalls: [call],
  done: false,
};

describe('assistant kernel', () => {
  it('projects history from ordered turn, assistant and tool events', () => {
    const kernel = createAssistantKernel([{ role: 'user', content: 'previous question' }]);
    kernel.beginTurn({ role: 'user', content: 'inspect this model' });
    kernel.beginStep();
    kernel.recordAssistant(response);
    kernel.recordToolCall(call);
    kernel.recordToolResult({
      toolCallId: call.id,
      ok: true,
      result: { nodes: 3 },
    });

    expect(kernel.deriveMessages()).toEqual([
      { role: 'user', content: 'previous question' },
      { role: 'user', content: 'inspect this model' },
      {
        role: 'assistant',
        content: 'I will inspect the model.',
        toolCalls: [call],
        toolResults: [{ toolCallId: 'call-1', ok: true, result: { nodes: 3 } }],
      },
    ]);
  });

  it('keeps event sequence monotonic and claims inbox messages in harness order', () => {
    const kernel = createAssistantKernel();
    kernel.enqueue('next-turn', { role: 'user', content: 'follow up' });
    kernel.enqueue('next-step', { role: 'user', content: 'steer now' });
    expect(kernel.claim('next-turn')).toEqual([
      { role: 'user', content: 'steer now' },
      { role: 'user', content: 'follow up' },
    ]);
    kernel.beginTurn({ role: 'user', content: 'main' });
    kernel.beginStep();
    kernel.recordAssistant({ message: 'done', plan: [], toolCalls: [], done: true });
    kernel.endStep('completed');
    kernel.endTurn('completed');
    const seqs = kernel.snapshot().events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('records synthetic results for calls skipped by cancellation', () => {
    const second: AssistantToolCall = { id: 'call-2', name: 'inspect_selection', arguments: {} };
    const kernel = createAssistantKernel();
    kernel.beginTurn({ role: 'user', content: 'inspect' });
    kernel.beginStep();
    kernel.recordAssistant({ ...response, toolCalls: [call, second] });
    kernel.recordToolCall(call);
    kernel.recordToolResult({ toolCallId: call.id, ok: true, result: {} });
    kernel.recordSkippedToolCall(second);
    kernel.endStep('aborted');
    const messages = kernel.deriveMessages();
    expect(messages.at(-1)?.toolResults).toEqual([
      { toolCallId: 'call-1', ok: true, result: {} },
      { toolCallId: 'call-2', ok: false, result: {}, error: 'tool call aborted before dispatch' },
    ]);
  });

  it('rejects duplicate and unmatched tool results', () => {
    const kernel = createAssistantKernel();
    kernel.beginTurn({ role: 'user', content: 'inspect' });
    kernel.beginStep();
    kernel.recordAssistant(response);
    kernel.recordToolCall(call);
    expect(() => kernel.recordToolCall(call)).toThrow(/duplicate tool call/);
    kernel.recordToolResult({ toolCallId: call.id, ok: true, result: {} });
    expect(() => kernel.recordToolResult({ toolCallId: call.id, ok: true, result: {} })).toThrow(
      /duplicate/,
    );
    expect(() => kernel.recordToolResult({ toolCallId: 'missing', ok: false, result: {} })).toThrow(
      /matching/,
    );
  });

  it('compacts long history behind a deterministic checkpoint', () => {
    const history = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));
    const compacted = compactAssistantMessages(history, 8);
    expect(compacted).toHaveLength(8);
    expect(compacted[0]?.content).toContain('context checkpoint');
    expect(compacted.at(-1)?.content).toBe('message-39');
  });

  it('rehydrates persisted turn events into the same model projection', () => {
    const source = createAssistantKernel();
    source.beginTurn({ role: 'user', content: 'persist me' });
    source.beginStep();
    source.recordAssistant(response);
    source.recordToolCall(call);
    source.recordToolResult({ toolCallId: call.id, ok: true, result: { nodes: 1 } });
    source.endStep('tool-calls');
    source.endTurn('completed');

    const restored = createAssistantKernel([], source.currentTurnEvents());
    expect(restored.deriveMessages()).toEqual(source.deriveMessages());
    expect(restored.snapshot().events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('creates a versioned checkpoint that can resume an open step', () => {
    const source = createAssistantKernel();
    source.beginTurn({ role: 'user', content: 'resume me' });
    source.beginStep();
    source.recordAssistant(response);
    source.recordToolCall(call);
    const checkpoint = source.checkpoint();
    expect(checkpoint.version).toBe(1);

    const restored = AssistantKernel.fromCheckpoint(checkpoint);
    restored.recordToolResult({ toolCallId: call.id, ok: true, result: { nodes: 2 } });
    restored.endStep('tool-calls');
    restored.endTurn('completed');
    expect(restored.deriveMessages().at(-1)?.toolResults).toEqual([
      { toolCallId: call.id, ok: true, result: { nodes: 2 } },
    ]);
  });
});

describe('assistant kernel error recovery', () => {
  it('abandonOpenCalls resolves a recorded call so the failed step can close', () => {
    const kernel = createAssistantKernel();
    kernel.beginTurn({ role: 'user', content: 'run the build' });
    kernel.beginStep();
    kernel.recordAssistant(response);
    kernel.recordToolCall(call);
    expect(() => kernel.endStep('error')).toThrow(/unresolved tool call/);
    kernel.abandonOpenCalls('tool dispatch failed');
    kernel.endStep('error');
    kernel.endTurn('error');
    const results = kernel.snapshot().events.filter((event) => event.type === 'tool/result');
    expect(results).toHaveLength(1);
  });

  it('abandonOpenCalls also records calls that were never dispatched', () => {
    const kernel = createAssistantKernel();
    kernel.beginTurn({ role: 'user', content: 'build' });
    kernel.beginStep();
    kernel.recordAssistant(response);
    kernel.abandonOpenCalls();
    kernel.endStep('error');
    kernel.endTurn('error');
    const results = kernel.snapshot().events.filter((event) => event.type === 'tool/result');
    expect(results).toHaveLength(1);
  });
});

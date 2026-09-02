// Assistant Runtime + tool system tests. The /api/assistant endpoint is
// mocked at the fetch boundary; every other dependency (model store, run
// store, validate/run endpoints) is the real implementation, so tool order,
// validation, version conflicts and undo behavior are tested for real.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocument, type ModelDocument } from '@logicpilot/editor';
import { createProject } from '../project/project';
import { runAssistantTurn } from './assistantRuntime';
import { createAssistantKernel } from './assistantKernel';
import { createAssistantSession, type AssistantContext } from './assistantTypes';
import { findProcessTool } from './capabilities/logicpilot-process/registry';
import { undoAssistantChange } from './capabilities/logicpilot-modeling/runtime';
import { buildAssistantContext } from './contextBuilder';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useAiConversationStore } from './conversationStore';
import { startIdePluginHost, stopIdePluginHost } from '../plugins/host';

beforeAll(() => startIdePluginHost());
afterAll(() => stopIdePluginHost());

interface MockCall {
  url: string;
  body: Record<string, unknown>;
}

type FetchHandler = (call: MockCall, calls: MockCall[]) => Promise<unknown>;

function installFetch(handler: FetchHandler) {
  const calls: MockCall[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });
      const data = await handler({ url, body }, calls);
      return {
        ok: true,
        status: 200,
        json: async () => data,
      } as Response;
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** Queue assistant responses; /api/ai-validate and /api/ai-run pass through
 *  with defaults unless overridden. */
function queueAssistant(responses: unknown[], options: { validate?: unknown; run?: unknown } = {}) {
  let index = 0;
  return installFetch(async ({ url }) => {
    if (url.endsWith('/api/assistant')) {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    }
    if (url.endsWith('/api/ai-validate')) {
      return options.validate ?? { ok: true, diagnostics: [] };
    }
    if (url.endsWith('/api/ai-run')) {
      return (
        options.run ?? {
          ok: true,
          iterations: 0,
          dsl: '',
          diagnostics: [],
          runSummary: 'summary: 3 replications',
          metrics: {
            summary: {
              Wq: { mean: 1.25, stddev: 0.1, ci_low: 1.0, ci_high: 1.5 },
              utilization: { mean: 0.8, stddev: 0, ci_low: 0.8, ci_high: 0.8 },
            },
            blocks: [
              {
                name: 'Queue',
                kind: 'queue',
                capacity: 20,
                arrived_mean: 100,
                departed_mean: 100,
                timed_out_mean: 0,
                preempted_mean: 0,
                mean_occupancy: 4,
                mean_wait: 1.25,
                wait_count_mean: 100,
                utilization: 0.8,
                availability: 1,
              },
            ],
          },
        }
      );
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

function baseContext(overrides: Partial<AssistantContext> = {}): AssistantContext {
  return {
    project: 'Test',
    modelSummary: "model 'M' nodes (0):",
    selection: 'nothing selected',
    dsl: '',
    diagnostics: 'no diagnostics (last compile passed)',
    runStatus: 'none',
    runMetrics: 'no run metrics yet',
    ...overrides,
  };
}

function blankDocument() {
  return createDocument('M');
}

function documentWithQueue(): ModelDocument {
  const document = blankDocument();
  return {
    ...document,
    nodes: [
      {
        id: 'queue-1',
        kind: 'queue',
        name: 'Q',
        x: 0,
        y: 0,
        params: { capacity: 10 },
        library: 'process' as const,
      },
      {
        id: 'resource-1',
        kind: 'resource',
        name: 'Workers',
        x: -200,
        y: -100,
        params: { capacity: 1 },
        library: 'process' as const,
      },
      {
        id: 'source-1',
        kind: 'source',
        name: 'Arrivals',
        x: -200,
        y: 0,
        params: {},
        library: 'process' as const,
      },
      {
        id: 'service-1',
        kind: 'service',
        name: 'Handle',
        x: 200,
        y: 0,
        params: { resource: 'Workers', time: 'exponential(1)' },
        library: 'process' as const,
      },
      {
        id: 'sink-1',
        kind: 'sink',
        name: 'Done',
        x: 400,
        y: 0,
        params: {},
        library: 'process' as const,
      },
    ],
    edges: [
      { id: 'edge-1', from: 'source-1', to: 'queue-1' },
      { id: 'edge-2', from: 'queue-1', to: 'service-1' },
      { id: 'edge-3', from: 'service-1', to: 'sink-1' },
    ],
  };
}

beforeEach(() => {
  useModelStore.setState({
    document: blankDocument(),
    selectedId: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    lastCommitAt: 0,
  });
  useProjectStore.setState({
    bundle: createProject('Test'),
    path: null,
    diskFiles: null,
    diskHashes: null,
    dirty: false,
  });
  useWorkspaceStore.getState().openVirtual('Test');
  useAiConversationStore.setState({ histories: {} });
});

afterEach(() => {
  useProjectStore.getState().clearProject();
  useWorkspaceStore.getState().closeWorkspace();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assistant runtime: control flow', () => {
  it('keeps a stable SDK turn and resumes through a provider checkpoint', async () => {
    useModelStore.setState({ document: blankDocument() });
    let sdkCalls = 0;
    const { calls } = installFetch(async ({ url, body }, recordedCalls) => {
      if (!url.endsWith('/api/agent-step')) throw new Error(`unexpected fetch to ${url}`);
      sdkCalls += 1;
      if (sdkCalls === 1) {
        return {
          schema: 'logicpilot.agent-step-result/v1',
          contractVersion: 1,
          turnId: body.turnId,
          engineId: 'sdk.openai-agents',
          stepIndex: 0,
          status: 'continue',
          toolCalls: [{ callId: 'sdk-inspect-1', name: 'inspect_model', arguments: {} }],
          toolResults: [],
          checkpoint: {
            schema: 'logicpilot.agent-checkpoint/v1',
            contractVersion: 1,
            turnId: body.turnId,
            engineId: 'sdk.openai-agents',
            revision: 1,
            state: 'serialized-sdk-state',
          },
        };
      }
      expect(body.stepIndex).toBe(1);
      expect(body.turnId).toBe(recordedCalls[0]!.body.turnId);
      expect(body.checkpoint).toMatchObject({ state: 'serialized-sdk-state' });
      expect(body.toolResults).toEqual([
        expect.objectContaining({ callId: 'sdk-inspect-1', ok: true }),
      ]);
      return {
        schema: 'logicpilot.agent-step-result/v1',
        contractVersion: 1,
        turnId: body.turnId,
        engineId: 'sdk.openai-agents',
        stepIndex: 1,
        status: 'done',
        message: 'SDK finished',
        toolCalls: [],
        toolResults: body.toolResults,
      };
    });
    const run = await runAssistantTurn({
      message: 'inspect the model',
      context: baseContext(),
      session: createAssistantSession(),
      engineId: 'sdk.openai-agents',
    });
    expect(run.ok).toBe(true);
    expect(run.message).toBe('SDK finished');
    expect(sdkCalls).toBe(2);
    expect(calls.filter((call) => call.url.endsWith('/api/agent-step'))).toHaveLength(2);
  });

  it('runs one step and finishes when the model is done', async () => {
    const { calls } = queueAssistant([
      { message: 'ok', plan: [{ id: 's1', label: 'check' }], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'hello',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/assistant');
    expect(calls[0]!.body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('sends the document-scoped tool names to the provider', async () => {
    const { calls } = queueAssistant([{ message: 'ok', plan: [], toolCalls: [], done: true }]);
    await runAssistantTurn({
      message: 'inspect SysML',
      context: baseContext(),
      session: createAssistantSession(),
      capabilities: ['logicpilot-sysml'],
      toolScope: { documentType: 'sysml' },
    });
    const names = calls[0]!.body.toolNames as string[];
    expect(names).toContain('inspect_sysml_projection');
    expect(names).toContain('add_sysml_element');
    expect(names).not.toContain('apply_model_patch');
  });

  it('uses the desktop API base and sends bounded conversation history', async () => {
    const { calls } = queueAssistant([
      { message: 'continued', plan: [], toolCalls: [], done: true },
    ]);
    await runAssistantTurn({
      message: 'make it two',
      context: baseContext(),
      session: createAssistantSession(),
      apiBase: 'http://127.0.0.1:43123',
      history: [
        { role: 'user', content: 'add a service' },
        { role: 'assistant', content: 'service added' },
      ],
    });
    expect(calls[0]!.url).toBe('http://127.0.0.1:43123/api/assistant');
    expect(calls[0]!.body.messages).toEqual([
      { role: 'user', content: 'add a service' },
      { role: 'assistant', content: 'service added' },
      { role: 'user', content: 'make it two' },
    ]);
  });

  it('publishes plan and tool progress before the turn finishes', async () => {
    queueAssistant([
      {
        message: 'checking',
        plan: [{ id: 'p1', label: 'inspect' }],
        toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: {} }],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const updates: string[][] = [];
    await runAssistantTurn({
      message: 'inspect it',
      context: baseContext(),
      session: createAssistantSession(),
      onProgress: (steps) => updates.push(steps.map((step) => step.kind)),
    });
    expect(updates.some((kinds) => kinds.includes('plan'))).toBe(true);
    expect(updates.some((kinds) => kinds.at(-1) === 'tool')).toBe(true);
    expect(updates.some((kinds) => kinds.at(-1) === 'tool-result')).toBe(true);
  });

  it('pauses a model patch for approval and reports a declined change to the model', async () => {
    const { calls } = queueAssistant([
      {
        message: 'I prepared a queue.',
        plan: [],
        toolCalls: [
          {
            id: 'patch-1',
            name: 'apply_model_patch',
            arguments: {
              summary: 'Add waiting queue',
              patch: {
                version: 1,
                operations: [{ op: 'add_block', kind: 'queue', name: 'Waiting' }],
              },
            },
          },
        ],
        done: false,
      },
      // Providers occasionally acknowledge the decline but omit done=true.
      // The runtime still treats the user's decision as a clean terminal state.
      {
        message: 'I kept the current model unchanged.',
        plan: [],
        toolCalls: [{ id: 'retry-1', name: 'inspect_diagnostics', arguments: {} }],
        done: false,
      },
    ]);
    const approvals: string[] = [];
    const result = await runAssistantTurn({
      message: 'add a queue',
      context: baseContext(),
      session: createAssistantSession(),
      confirmModelPatch: async (request) => {
        approvals.push(request.summary);
        return false;
      },
    });
    expect(result.ok).toBe(true);
    expect(approvals).toEqual(['Add waiting queue']);
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
    expect(calls.filter((call) => !call.url.endsWith('/api/assistant'))).toHaveLength(0);
    expect(result.steps).toContainEqual(
      expect.objectContaining({ kind: 'approval', status: 'rejected', ok: false }),
    );
    const assistantCalls = calls.filter((call) => call.url.endsWith('/api/assistant'));
    const feedback = assistantCalls[1]!.body.messages as Array<{
      toolResults?: Array<{ ok: boolean; result?: { declined?: boolean; reason?: string } }>;
    }>;
    expect(feedback[1]!.toolResults?.[0]).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          declined: true,
          reason: expect.stringContaining('declined'),
        }),
      }),
    );
  });

  it('applies an approved patch and marks its running step completed', async () => {
    queueAssistant([
      {
        message: 'I prepared a queue.',
        plan: [],
        toolCalls: [
          {
            id: 'patch-1',
            name: 'apply_model_patch',
            arguments: {
              summary: 'Add waiting queue',
              patch: {
                version: 1,
                operations: [{ op: 'add_block', kind: 'queue', name: 'Waiting' }],
              },
            },
          },
        ],
        done: false,
      },
      { message: 'Done.', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'add a queue',
      context: baseContext(),
      session: createAssistantSession(),
      confirmModelPatch: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(useModelStore.getState().document.nodes).toHaveLength(1);
    expect(result.steps).toContainEqual(
      expect.objectContaining({ kind: 'approval', status: 'completed', ok: true }),
    );
    expect(result.steps).toContainEqual(
      expect.objectContaining({ kind: 'tool', status: 'completed', ok: true }),
    );
  });

  it('executes proposed tools in order and feeds results back', async () => {
    const { calls } = queueAssistant([
      {
        message: 'checking',
        plan: [],
        toolCalls: [
          { id: 'c1', name: 'inspect_model', arguments: {} },
          { id: 'c2', name: 'compile_model', arguments: {} },
        ],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const session = createAssistantSession();
    session.dsl = 'model M { use process }';
    const result = await runAssistantTurn({
      message: 'compile',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3); // assistant x2 + ai-validate x1
    const assistantCalls = calls.filter((call) => call.url.endsWith('/api/assistant'));
    const second = assistantCalls[1]!.body as { messages: unknown[] };
    const assistantMessage = second.messages[1] as { toolResults: unknown[] };
    // Tool results are fed back in execution order with matching ids.
    const results = assistantMessage.toolResults as Array<{ toolCallId: string; ok: boolean }>;
    expect(results.map((entry) => entry.toolCallId)).toEqual(['c1', 'c2']);
    expect(results.every((entry) => entry.ok)).toBe(true);
    expect(
      result.modelMessages?.find((message) => message.toolResults !== undefined)?.toolResults,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: 'c1', ok: true }),
        expect.objectContaining({ toolCallId: 'c2', ok: true }),
      ]),
    );
  });

  it('runs read-only inspection calls in a parallel group while committing results in model order', async () => {
    queueAssistant([
      {
        message: 'inspect both',
        plan: [],
        toolCalls: [
          { id: 'inspect-1', name: 'inspect_model', arguments: {} },
          { id: 'inspect-2', name: 'inspect_selection', arguments: {} },
        ],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'inspect the model and selection',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    const toolMessage = result.modelMessages?.find((message) => message.toolResults !== undefined);
    expect(toolMessage?.toolResults?.map((entry) => entry.toolCallId)).toEqual([
      'inspect-1',
      'inspect-2',
    ]);
  });

  it('stops after the maximum number of iterations', async () => {
    const { fetchMock } = queueAssistant([
      {
        message: 'keep going',
        plan: [],
        toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: {} }],
        done: false,
      },
      {
        message: 'keep checking diagnostics',
        plan: [],
        toolCalls: [{ id: 'c2', name: 'inspect_diagnostics', arguments: {} }],
        done: false,
      },
      {
        message: 'keep checking metrics',
        plan: [],
        toolCalls: [{ id: 'c3', name: 'inspect_run_metrics', arguments: {} }],
        done: false,
      },
    ]);
    const result = await runAssistantTurn({
      message: 'loop',
      context: baseContext(),
      session: createAssistantSession(),
      maxIterations: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('loop limit');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('suppresses an identical tool call when no state changed', async () => {
    const { fetchMock } = queueAssistant([
      {
        message: '你好！请告诉我你需要什么帮助。',
        plan: [{ id: 's1', label: 'checking model' }],
        toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: {} }],
        done: false,
      },
      {
        message: '你好！请告诉我你需要什么帮助。',
        plan: [],
        toolCalls: [{ id: 'c2', name: 'inspect_model', arguments: {} }],
        done: false,
      },
      {
        message: '你好！请告诉我你需要什么帮助。',
        plan: [],
        toolCalls: [],
        done: true,
      },
    ]);
    const result = await runAssistantTurn({
      message: '你好',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('你好');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.steps.some((step) => step.kind === 'error')).toBe(false);
  });

  it('resumes an unfinished turn from a versioned checkpoint', async () => {
    const checkpointKernel = createAssistantKernel();
    checkpointKernel.beginTurn({ role: 'user', content: 'resume this task' });
    const checkpoints: unknown[] = [];
    const { fetchMock } = queueAssistant([
      { message: 'resumed and complete', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'ignored while resuming',
      context: baseContext(),
      session: createAssistantSession(),
      checkpoint: checkpointKernel.checkpoint(),
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('resumed and complete');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(checkpoints.length).toBeGreaterThan(0);
  });

  it('retries transient assistant endpoint failures before surfacing an error', async () => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        if (!String(input).endsWith('/api/assistant'))
          throw new Error(`unexpected fetch to ${input}`);
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'temporary provider outage' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: 'recovered', plan: [], toolCalls: [], done: true }),
        } as Response;
      }),
    );
    const result = await runAssistantTurn({
      message: 'retry this',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    expect(result.message).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('consumes assistant SSE text deltas before the final structured response', async () => {
    const chunks: string[] = [];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text","delta":"streamed "}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"text","delta":"reply"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"done","response":{"message":"streamed reply","plan":[],"toolCalls":[],"done":true}}\n\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        expect(String(input)).toContain('/api/assistant/stream');
        return { ok: true, status: 200, body } as Response;
      }),
    );
    const result = await runAssistantTurn({
      message: 'stream it',
      context: baseContext(),
      session: createAssistantSession(),
      onToken: (chunk) => {
        if (chunk.type === 'text') chunks.push(chunk.delta);
      },
    });
    expect(result.ok).toBe(true);
    expect(chunks.join('')).toBe('streamed reply');
  });

  it('cancels cleanly when the signal aborts', async () => {
    const controller = new AbortController();
    installFetch(async ({ url }) => {
      if (url.endsWith('/api/assistant')) {
        controller.abort();
        return {
          message: 'late',
          plan: [],
          toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: {} }],
          done: false,
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    const result = await runAssistantTurn({
      message: 'cancel me',
      context: baseContext(),
      session: createAssistantSession(),
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('cancelled');
  });

  it('propagates cancellation into a running compile tool', async () => {
    const controller = new AbortController();
    let assistantCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/assistant')) {
          assistantCalls += 1;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              message: 'compile',
              plan: [],
              toolCalls: [{ id: 'c1', name: 'compile_model', arguments: {} }],
              done: false,
            }),
          } as Response);
        }
        if (url.endsWith('/api/ai-validate')) {
          expect(init?.signal).toBe(controller.signal);
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const pending = runAssistantTurn({
      message: 'compile it',
      context: baseContext(),
      session: createAssistantSession(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(assistantCalls).toBe(1));
    controller.abort();
    const result = await pending;
    expect(result.cancelled).toBe(true);
  });

  it('rolls back AI edits when the turn is cancelled after applying them', async () => {
    const controller = new AbortController();
    let assistantCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/ai-validate')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, diagnostics: [] }),
          } as Response);
        }
        if (url.endsWith('/api/assistant')) {
          assistantCalls += 1;
          if (assistantCalls === 1) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                message: 'apply',
                plan: [],
                done: false,
                toolCalls: [
                  {
                    id: 'c1',
                    name: 'apply_model_patch',
                    arguments: {
                      summary: 'add queue',
                      patch: {
                        version: 1,
                        operations: [{ op: 'add_block', kind: 'queue', name: 'Q' }],
                      },
                    },
                  },
                ],
              }),
            } as Response);
          }
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const session = createAssistantSession();
    const pending = runAssistantTurn({
      message: 'build then stop',
      context: baseContext(),
      session,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(useModelStore.getState().document.nodes).toHaveLength(1));
    controller.abort();
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(result.undoTokenId).toBeUndefined();
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
    expect(session.activeUndo).toBeNull();
  });

  it('does not crash on malformed JSON from the endpoint', async () => {
    queueAssistant([{ nope: true }]);
    const result = await runAssistantTurn({
      message: 'bad',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('malformed JSON');
    expect(result.steps.some((step) => step.kind === 'error')).toBe(true);
  });

  it('reports an assistant that finishes without a final answer', async () => {
    queueAssistant([{ message: 'hmm', plan: [], toolCalls: [], done: false }]);
    const result = await runAssistantTurn({
      message: 'hmm',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('without a final answer');
  });

  it('rejects a final answer that misreports completed run metrics', async () => {
    queueAssistant([
      { message: 'Wq=2.827, utilization=79.3%', plan: [], toolCalls: [], done: true },
    ]);
    const session = createAssistantSession();
    session.runStatus = 'finished';
    session.runMetrics = {
      summary: {
        Wq: { mean: 3.615 },
        utilization: { mean: 0.793 },
      },
    } as never;
    const result = await runAssistantTurn({
      message: 'Explain the latest results and report Wq',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('grounded metric validation');
  });
});

describe('assistant tools: validation', () => {
  it('rejects unknown tool names without executing anything', async () => {
    const { calls } = queueAssistant([
      {
        message: 'x',
        plan: [],
        toolCalls: [{ id: 'c1', name: 'eval', arguments: {} }],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'x',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true); // loop recovered
    expect(
      result.steps.some(
        (step) => step.kind === 'error' && step.label.includes("unknown tool 'eval'"),
      ),
    ).toBe(true);
    expect(calls.every((call) => call.url.endsWith('/api/assistant'))).toBe(true);
  });

  it('rejects invalid arguments (unknown block kind)', async () => {
    const { calls } = queueAssistant([
      {
        message: 'x',
        plan: [],
        toolCalls: [
          {
            id: 'c1',
            name: 'apply_model_patch',
            arguments: {
              patch: {
                version: 1,
                operations: [{ op: 'add_block', kind: 'no_such_kind', name: 'X' }],
              },
              summary: 'add X',
            },
          },
        ],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'x',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(
      result.steps.some(
        (step) => step.kind === 'error' && step.label.includes('not a known block type'),
      ),
    ).toBe(true);
    expect(calls.every((call) => call.url.endsWith('/api/assistant'))).toBe(true);
  });

  it('rejects non-finite numeric params', () => {
    const tool = findProcessTool('apply_model_patch')!;
    const problem = tool.validate({
      patch: {
        version: 1,
        operations: [
          { op: 'add_block', kind: 'queue', name: 'Q', params: { capacity: Number.NaN } },
        ],
      },
      summary: 'x',
    });
    expect(problem).toContain('finite');
  });

  it('rejects a missing summary for apply_model_patch', () => {
    const tool = findProcessTool('apply_model_patch')!;
    expect(tool.validate({ patch: { version: 1, operations: [] }, summary: 42 })).toContain(
      'summary must be a string',
    );
  });
});

describe('assistant tools: model editing', () => {
  it('refuses model mutations when no project is open', async () => {
    useProjectStore.getState().clearProject();
    useWorkspaceStore.getState().closeWorkspace();
    const tool = findProcessTool('apply_model_patch')!;
    const result = await tool.execute(
      {
        patch: {
          version: 1,
          operations: [{ op: 'add_block', kind: 'queue', name: 'ScratchOnly' }],
        },
        summary: 'add a queue',
      },
      { session: createAssistantSession(), experiment: { seed: 1 } as never },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No workspace is open');
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
  });

  it('applies a structured patch and auto-compiles', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document, canUndo: false, past: [] });
    const { calls } = queueAssistant([
      {
        message: 'edit',
        plan: [],
        toolCalls: [
          {
            id: 'c1',
            name: 'apply_model_patch',
            arguments: {
              patch: {
                version: 1,
                operations: [
                  { op: 'update_block', target: 'Q', params: { capacity: 20 } },
                  { op: 'add_block', kind: 'source', name: 'In' },
                ],
              },
              summary: 'raise queue capacity to 20 and add a source',
            },
          },
        ],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const session = createAssistantSession();
    const result = await runAssistantTurn({
      message: 'edit',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(true);
    // Auto-compile happened: the apply tool called /api/ai-validate.
    expect(calls.some((call) => call.url.endsWith('/api/ai-validate'))).toBe(true);
    const after = useModelStore.getState().document;
    expect(after.nodes).toHaveLength(6);
    const queue = after.nodes.find((node) => node.name === 'Q')!;
    expect(queue.params.capacity).toBe(20);
    // The change is one atomic undo step and recorded for undo.
    expect(useModelStore.getState().canUndo).toBe(true);
    expect(session.lastPatch).not.toBeNull();
    expect(session.lastChangeSummary).toBe('raise queue capacity to 20 and add a source');
    const syncedBundle = useProjectStore.getState().bundle;
    expect(syncedBundle?.files['model/main.lp']).toContain('queue Q');
    expect(syncedBundle?.files['model/main.lp']).toContain('source In');
  });

  it('resolves references by unique name', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    queueAssistant([{ message: 'done', plan: [], toolCalls: [], done: true }]);
    const tool = findProcessTool('apply_model_patch')!;
    const result = await tool.execute(
      {
        patch: {
          version: 1,
          operations: [{ op: 'update_block', target: 'Q', params: { capacity: 5 } }],
        },
        summary: 'shrink queue',
      },
      { session: createAssistantSession(), experiment: { seed: 1 } as never },
    );
    expect(result.ok).toBe(true);
    expect(useModelStore.getState().document.nodes[0]!.params.capacity).toBe(5);
  });

  it('rejects ambiguous names via the patch preview', async () => {
    const document = {
      ...blankDocument(),
      nodes: [
        {
          id: 'q1',
          kind: 'queue',
          name: 'Q',
          x: 0,
          y: 0,
          params: { capacity: 1 },
          library: 'process' as const,
        },
        {
          id: 'q2',
          kind: 'queue',
          name: 'Q',
          x: 1,
          y: 1,
          params: { capacity: 1 },
          library: 'process' as const,
        },
      ],
    } as ModelDocument;
    useModelStore.setState({ document });
    const tool = findProcessTool('apply_model_patch')!;
    const problem = tool.validate({
      patch: {
        version: 1,
        operations: [{ op: 'update_block', target: 'Q', params: { capacity: 5 } }],
      },
      summary: 'x',
    });
    expect(problem).toContain('ambiguous');
  });

  it('feeds compile failures back into the loop for repair', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    let assistantCalls = 0;
    installFetch(async ({ url }, calls) => {
      if (url.endsWith('/api/assistant')) {
        assistantCalls += 1;
        if (assistantCalls === 1) {
          return {
            message: 'editing',
            plan: [],
            toolCalls: [
              {
                id: 'c1',
                name: 'apply_model_patch',
                arguments: {
                  patch: {
                    version: 1,
                    operations: [{ op: 'update_block', target: 'Q', params: { capacity: 11 } }],
                  },
                  summary: 'change queue capacity',
                },
              },
            ],
            done: false,
          };
        }
        // Second step: the diagnostics must be visible in the fed-back tool
        // result, which is what lets the model repair the model.
        const messages = calls.filter((call) => call.url.endsWith('/api/assistant'));
        const second = messages[1]!.body as { messages: unknown[] };
        const assistantMessage = second.messages[1] as { toolResults: unknown[] };
        const results = assistantMessage.toolResults as Array<{
          result: { compiled?: { ok: boolean; diagnostics: unknown[] } };
        }>;
        expect(results[0]!.result.compiled?.ok).toBe(false);
        expect(results[0]!.result.compiled?.diagnostics).toEqual([
          { code: 'LP1001', message: 'queue capacity missing' },
        ]);
        return { message: 'fixed', plan: [], toolCalls: [], done: true };
      }
      if (url.endsWith('/api/ai-validate')) {
        return { ok: false, diagnostics: [{ code: 'LP1001', message: 'queue capacity missing' }] };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    const result = await runAssistantTurn({
      message: 'change queue capacity',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    // The failure was surfaced as an error state, then the model recovered.
    expect(result.steps.some((step) => step.label.includes('compile failed'))).toBe(true);
  });

  it('repairs local preflight failures before calling the backend compiler', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    let assistantCalls = 0;
    const { calls } = installFetch(async ({ url }, recordedCalls) => {
      if (url.endsWith('/api/assistant')) {
        assistantCalls += 1;
        if (assistantCalls === 1) {
          return {
            message: 'removing the source',
            plan: [],
            toolCalls: [
              {
                id: 'c1',
                name: 'apply_model_patch',
                arguments: {
                  patch: {
                    version: 1,
                    operations: [{ op: 'remove_block', target: 'Arrivals' }],
                  },
                  summary: 'remove source',
                },
              },
            ],
            done: false,
          };
        }
        if (assistantCalls === 2) {
          const messages = recordedCalls.filter((call) => call.url.endsWith('/api/assistant'));
          const second = messages[1]!.body as { messages: unknown[] };
          const assistantMessage = second.messages[1] as { toolResults: unknown[] };
          const results = assistantMessage.toolResults as Array<{
            result: {
              compiled?: {
                ok: boolean;
                phase: string;
                diagnostics: Array<{ code: string; source?: string }>;
              };
            };
          }>;
          const compiled = results[0]!.result.compiled!;
          expect(compiled.ok).toBe(false);
          expect(compiled.phase).toBe('preflight');
          expect(compiled.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: 'LP2002', source: 'preflight' }),
            ]),
          );
          expect(recordedCalls.some((call) => call.url.endsWith('/api/ai-validate'))).toBe(false);
          return {
            message: 'repairing the source flow',
            plan: [],
            toolCalls: [
              {
                id: 'c2',
                name: 'apply_model_patch',
                arguments: {
                  patch: {
                    version: 1,
                    operations: [
                      { op: 'add_block', kind: 'source', name: 'RepairedArrivals' },
                      { op: 'connect', from: 'RepairedArrivals', to: 'Q' },
                    ],
                  },
                  summary: 'restore source and reconnect the flow',
                },
              },
            ],
            done: false,
          };
        }
        return { message: 'model repaired', plan: [], toolCalls: [], done: true };
      }
      if (url.endsWith('/api/ai-validate')) {
        return { ok: true, diagnostics: [] };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const session = createAssistantSession();
    const result = await runAssistantTurn({
      message: 'remove the source, then make the model valid again',
      context: baseContext(),
      session,
    });

    expect(result.ok).toBe(true);
    expect(calls.filter((call) => call.url.endsWith('/api/ai-validate'))).toHaveLength(1);
    expect(
      useModelStore.getState().document.nodes.some((node) => node.name === 'RepairedArrivals'),
    ).toBe(true);
    expect(session.compiled).toBe(true);
    expect(result.steps.some((step) => step.label.includes('compile failed'))).toBe(true);
  });

  it('stops writing when the project changed during the request (version conflict)', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    const { calls } = installFetch(async ({ url }) => {
      if (url.endsWith('/api/assistant')) {
        // Simulate a manual edit landing between AI steps: the document
        // identity changes while the request is in flight.
        const current = useModelStore.getState().document;
        useModelStore.setState({ document: { ...current, name: 'UserEdited' } });
        return {
          message: 'applying',
          plan: [],
          toolCalls: [
            {
              id: 'c1',
              name: 'apply_model_patch',
              arguments: {
                patch: {
                  version: 1,
                  operations: [{ op: 'update_block', target: 'Q', params: { capacity: 99 } }],
                },
                summary: 'set capacity',
              },
            },
          ],
          done: false,
        };
      }
      if (url.endsWith('/api/ai-validate')) {
        return { ok: true, diagnostics: [] };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    const session = createAssistantSession();
    const result = await runAssistantTurn({
      message: 'edit',
      context: baseContext(),
      session,
    });
    const finalDocument = useModelStore.getState().document;
    // The manual edit survived; the AI write was rejected.
    expect(finalDocument.name).toBe('UserEdited');
    expect(finalDocument.nodes[0]!.params.capacity).toBe(10);
    expect(
      result.steps.some(
        (step) => step.kind === 'error' && step.label.includes('changed during the AI request'),
      ),
    ).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/ai-validate'))).toBe(false);
  });

  it('undoes the last AI change and reports the restored model', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document, past: [], canUndo: false });
    const { calls } = queueAssistant([
      {
        message: 'edit',
        plan: [],
        toolCalls: [
          {
            id: 'c1',
            name: 'apply_model_patch',
            arguments: {
              patch: {
                version: 1,
                operations: [{ op: 'add_block', kind: 'sink', name: 'ExtraDone' }],
              },
              summary: 'add sink',
            },
          },
        ],
        done: false,
      },
      {
        message: 'undoing',
        plan: [],
        toolCalls: [{ id: 'c2', name: 'undo_last_ai_change', arguments: {} }],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'edit and undo',
      context: baseContext(),
      session: createAssistantSession(),
    });
    expect(result.ok).toBe(true);
    const finalDocument = useModelStore.getState().document;
    expect(finalDocument.nodes.some((node) => node.name === 'ExtraDone')).toBe(false);
    expect(finalDocument.nodes).toHaveLength(document.nodes.length);
    // Undo recompiled the restored model.
    expect(calls.some((call) => call.url.endsWith('/api/ai-validate'))).toBe(true);
  });
});

describe('assistant tools: runs and metrics', () => {
  it('builds, validates, runs and explains an M/M/1 model from a blank canvas', async () => {
    const { calls } = queueAssistant([
      {
        message: '正在一次性建立完整的 M/M/1 流程。',
        plan: [
          { id: 'build', label: '建立 M/M/1 模型' },
          { id: 'run', label: '运行仿真' },
          { id: 'explain', label: '解释真实指标' },
        ],
        toolCalls: [
          {
            id: 'build-mm1',
            name: 'apply_model_patch',
            arguments: {
              summary: '建立稳定的单服务台 M/M/1 队列',
              patch: {
                version: 1,
                operations: [
                  {
                    op: 'add_block',
                    kind: 'resource',
                    name: 'Server',
                    x: 240,
                    y: 40,
                    params: { capacity: 1 },
                  },
                  {
                    op: 'add_block',
                    kind: 'source',
                    name: 'Arrivals',
                    x: 80,
                    y: 160,
                    params: { arrival: 'rate(0.8)' },
                  },
                  {
                    op: 'add_block',
                    kind: 'queue',
                    name: 'WaitLine',
                    x: 240,
                    y: 160,
                    params: { capacity: 1000000 },
                  },
                  {
                    op: 'add_block',
                    kind: 'service',
                    name: 'Handle',
                    x: 400,
                    y: 160,
                    params: { resource: 'Server', time: 'exponential(1.0)' },
                  },
                  { op: 'add_block', kind: 'sink', name: 'Done', x: 560, y: 160 },
                  { op: 'connect', from: 'Arrivals', to: 'WaitLine' },
                  { op: 'connect', from: 'WaitLine', to: 'Handle' },
                  { op: 'connect', from: 'Handle', to: 'Done' },
                ],
              },
            },
          },
        ],
        done: false,
      },
      {
        message: '模型已通过检查，开始运行。',
        plan: [],
        toolCalls: [{ id: 'run-mm1', name: 'run_simulation', arguments: {} }],
        done: false,
      },
      {
        message: '运行完成，读取本次运行的指标。',
        plan: [],
        toolCalls: [{ id: 'metrics-mm1', name: 'inspect_run_metrics', arguments: {} }],
        done: false,
      },
      {
        message: 'M/M/1 已运行完成：平均排队时间 Wq=1.25，服务台利用率=0.8。',
        plan: [],
        toolCalls: [],
        done: true,
      },
    ]);
    const session = createAssistantSession();

    const result = await runAssistantTurn({
      message: '从空白画布建立一个到达率 0.8、服务率 1.0 的 M/M/1，运行并解释结果',
      context: baseContext(),
      session,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Wq=1.25');
    expect(result.message).toContain('利用率=0.8');
    const document = useModelStore.getState().document;
    expect(document.nodes.map((node) => `${node.kind}:${node.name}`).sort()).toEqual([
      'queue:WaitLine',
      'resource:Server',
      'service:Handle',
      'sink:Done',
      'source:Arrivals',
    ]);
    expect(document.edges).toHaveLength(3);
    expect(document.nodes.find((node) => node.name === 'Arrivals')?.params.arrival).toBe(
      'rate(0.8)',
    );
    expect(document.nodes.find((node) => node.name === 'Handle')?.params).toMatchObject({
      resource: 'Server',
      time: 'exponential(1.0)',
    });

    const validateCalls = calls.filter((call) => call.url.endsWith('/api/ai-validate'));
    const runIndex = calls.findIndex((call) => call.url.endsWith('/api/ai-run'));
    expect(validateCalls).toHaveLength(2); // auto-compile after patch, then compile before run
    expect(runIndex).toBeGreaterThan(calls.indexOf(validateCalls[1]!));
    expect(session.compiled).toBe(true);
    expect(session.runStatus).toBe('finished');
    expect(session.runMetrics?.summary?.Wq?.mean).toBe(1.25);
    expect(
      result.steps.filter(
        (step) => step.kind === 'tool-result' && step.toolName === 'apply_model_patch',
      ),
    ).toEqual([expect.objectContaining({ ok: true })]);
    expect(
      result.steps.filter(
        (step) => step.kind === 'tool-result' && step.toolName === 'run_simulation',
      ),
    ).toEqual([expect.objectContaining({ ok: true })]);
    expect(
      result.steps.filter(
        (step) => step.kind === 'tool-result' && step.toolName === 'inspect_run_metrics',
      ),
    ).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('explain-without-metrics fails cleanly instead of inventing numbers', async () => {
    const tool = findProcessTool('inspect_run_metrics')!;
    const result = await tool.execute(
      {},
      { session: createAssistantSession(), experiment: { seed: 1 } as never },
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('no run metrics available');
  });

  it('explain-with-metrics reads the real recorded metrics', async () => {
    const session = createAssistantSession();
    session.runMetrics = {
      summary: {
        Wq: { mean: 1.25, stddev: 0.1, ci_low: 1.0, ci_high: 1.5 },
      },
      blocks: [],
    };
    const tool = findProcessTool('inspect_run_metrics')!;
    const result = await tool.execute({}, { session, experiment: { seed: 1 } as never });
    expect(result.ok).toBe(true);
    const metrics = result.metrics as { summary: Record<string, { mean: number }> };
    expect(metrics.summary.Wq!.mean).toBe(1.25);
  });

  it('runs parameter studies and grounded explanations as first-class assistant tools', async () => {
    const session = createAssistantSession();
    session.dsl = 'model M { use process }';
    session.runMetrics = {
      summary: { Wq: { mean: 1.25, stddev: 0, ci_low: 1.25, ci_high: 1.25 } },
      blocks: [],
    };
    session.previousRunMetrics = session.runMetrics;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.endsWith('/api/parameter-variation')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ kind: 'parameter_variation', pointCount: 2, iterations: [] }),
          } as Response;
        }
        if (url.endsWith('/api/ai-query-metrics')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              kind: 'metric-query',
              findings: ['Wq is grounded'],
              evidence: {},
            }),
          } as Response;
        }
        if (url.endsWith('/api/ai-optimize')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              kind: 'optimize',
              evaluations: [{ value: 1 }],
              best: { value: 1, score: 0.5 },
            }),
          } as Response;
        }
        if (url.endsWith('/api/ai-compare-metrics')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              kind: 'metric-comparison',
              findings: ['improved'],
              summary: {},
              blocks: [],
              statistical: [],
            }),
          } as Response;
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );
    const study = await findProcessTool('run_parameter_study')!.execute(
      {},
      {
        session,
        experiment: { arrivals: 100, warmup: 10 } as never,
      },
    );
    expect(study.pointCount).toBe(2);
    const explanation = await findProcessTool('explain_results')!.execute(
      { question: 'why?' },
      {
        session,
        experiment: { arrivals: 100, warmup: 10 } as never,
      },
    );
    expect(explanation.findings).toEqual(['Wq is grounded']);
    const optimized = await findProcessTool('optimize_model')!.execute(
      { prompt: 'minimize Wq' },
      { session, experiment: { arrivals: 100, warmup: 10 } as never },
    );
    expect(optimized.evaluations).toHaveLength(1);
    const comparison = await findProcessTool('compare_runs')!.execute(
      {},
      { session, experiment: { arrivals: 100, warmup: 10 } as never },
    );
    expect(comparison.findings).toEqual(['improved']);
  });

  it('run_simulation compiles first and returns real metrics', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    const session = createAssistantSession();
    session.documentSnapshot = document;
    const { calls } = queueAssistant([
      {
        message: 'run',
        plan: [],
        toolCalls: [{ id: 'c1', name: 'run_simulation', arguments: {} }],
        done: false,
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const result = await runAssistantTurn({
      message: 'run it',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(true);
    // Compile then run, in that order.
    const validateIndex = calls.findIndex((call) => call.url.endsWith('/api/ai-validate'));
    const runIndex = calls.findIndex((call) => call.url.endsWith('/api/ai-run'));
    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(runIndex).toBeGreaterThan(validateIndex);
    expect(session.runStatus).toBe('finished');
    expect(session.runMetrics?.summary?.Wq!.mean).toBe(1.25);
  });

  it('run_simulation stops at local preflight without compile or run requests', async () => {
    const valid = documentWithQueue();
    const document: ModelDocument = {
      ...valid,
      nodes: valid.nodes.filter((node) => node.name !== 'Arrivals'),
      edges: valid.edges.filter((edge) => edge.from !== 'source-1'),
    };
    useModelStore.setState({ document });
    const { calls } = installFetch(async ({ url }) => {
      throw new Error(`unexpected fetch to ${url}`);
    });
    const session = createAssistantSession();
    const tool = findProcessTool('run_simulation')!;

    const result = await tool.execute({}, { session, experiment: { seed: 1 } as never });

    expect(result.ok).toBe(false);
    expect(result.phase).toBe('preflight');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LP2002', source: 'preflight' })]),
    );
    expect(session.runStatus).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('run_simulation reports a failed compile instead of running', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    const session = createAssistantSession();
    session.documentSnapshot = document;
    const { calls } = queueAssistant(
      [
        {
          message: 'run',
          plan: [],
          toolCalls: [{ id: 'c1', name: 'run_simulation', arguments: {} }],
          done: false,
        },
        { message: 'done', plan: [], toolCalls: [], done: true },
      ],
      { validate: { ok: false, diagnostics: [{ code: 'LP2001', message: 'no source' }] } },
    );
    const result = await runAssistantTurn({
      message: 'run it',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/api/ai-run'))).toBe(false);
    expect(session.runStatus).toBe('failed');
  });

  it('surfaces tool execution failures as error steps', async () => {
    const document = documentWithQueue();
    useModelStore.setState({ document });
    const session = createAssistantSession();
    session.documentSnapshot = document;
    queueAssistant(
      [
        {
          message: 'run',
          plan: [],
          toolCalls: [{ id: 'c1', name: 'run_simulation', arguments: {} }],
          done: false,
        },
        { message: 'done', plan: [], toolCalls: [], done: true },
      ],
      {
        validate: { ok: true, diagnostics: [] },
        run: {
          ok: false,
          diagnostics: [{ code: 'LP3001', message: 'run crashed' }],
          runSummary: '',
        },
      },
    );
    const result = await runAssistantTurn({
      message: 'run it',
      context: baseContext(),
      session,
    });
    expect(result.ok).toBe(true);
    expect(
      result.steps.some((step) => step.kind === 'error' && step.label.includes('run failed')),
    ).toBe(true);
  });
});

describe('assistant context', () => {
  it('includes ids and names so follow-up references resolve', () => {
    const document: ModelDocument = {
      ...blankDocument(),
      nodes: [
        {
          id: 'q1',
          kind: 'queue',
          name: 'Waiting',
          x: 0,
          y: 0,
          params: { capacity: 20 },
          library: 'process' as const,
        },
        {
          id: 's1',
          kind: 'service',
          name: 'Server',
          x: 1,
          y: 1,
          params: { units: 1 },
          library: 'process' as const,
        },
      ],
      edges: [{ id: 'e1', from: 'q1', to: 's1' }],
    };
    const context = buildAssistantContext({
      projectName: 'Demo',
      document,
      selectedId: 's1',
      session: createAssistantSession(),
    });
    expect(context.project).toBe('Demo');
    expect(context.modelSummary).toContain('id=q1');
    expect(context.modelSummary).toContain("name='Waiting'");
    expect(context.modelSummary).toContain('capacity=20');
    expect(context.selection).toContain("name='Server'");
    expect(context.modelSummary).toContain('q1.out -> s1.in');
  });
});

describe('assistant undo transactions', () => {
  it('undoes every AI patch from one reasoning turn as a unit', async () => {
    queueAssistant([
      {
        message: 'add queue',
        plan: [],
        done: false,
        toolCalls: [
          {
            id: 'c1',
            name: 'apply_model_patch',
            arguments: {
              summary: 'add queue',
              patch: { version: 1, operations: [{ op: 'add_block', kind: 'queue', name: 'Q' }] },
            },
          },
        ],
      },
      {
        message: 'add sink',
        plan: [],
        done: false,
        toolCalls: [
          {
            id: 'c2',
            name: 'apply_model_patch',
            arguments: {
              summary: 'add sink',
              patch: { version: 1, operations: [{ op: 'add_block', kind: 'sink', name: 'Out' }] },
            },
          },
        ],
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const session = createAssistantSession();
    const result = await runAssistantTurn({
      message: 'build it',
      context: baseContext(),
      session,
    });
    expect(useModelStore.getState().document.nodes).toHaveLength(2);
    expect(result.undoTokenId).toBeTruthy();
    expect(undoAssistantChange(session, result.undoTokenId!)).toEqual({ ok: true, undone: true });
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
  });

  it('rejects AI undo after a manual model edit', async () => {
    queueAssistant([
      {
        message: 'add queue',
        plan: [],
        done: false,
        toolCalls: [
          {
            id: 'c1',
            name: 'apply_model_patch',
            arguments: {
              summary: 'add queue',
              patch: { version: 1, operations: [{ op: 'add_block', kind: 'queue', name: 'Q' }] },
            },
          },
        ],
      },
      { message: 'done', plan: [], toolCalls: [], done: true },
    ]);
    const session = createAssistantSession();
    const result = await runAssistantTurn({
      message: 'add it',
      context: baseContext(),
      session,
    });
    useModelStore.getState().addBlock({ kind: 'sink', name: 'Manual', x: 0, y: 0 });
    const undone = undoAssistantChange(session, result.undoTokenId!);
    expect(undone.ok).toBe(false);
    expect(useModelStore.getState().document.nodes.map((node) => node.name)).toEqual([
      'Q',
      'Manual',
    ]);
  });
});

describe('conversation isolation with assistant records', () => {
  it('keeps assistant turns isolated per project/model scope', () => {
    const { append } = useAiConversationStore.getState();
    append('project:a', {
      user: 'add a queue',
      assistant: 'done',
      patch: { version: 1, operations: [] },
      outcome: 'applied',
      assistantRecord: {
        steps: [{ kind: 'tool-result', label: 'applied 1 change(s)' }],
        undoable: true,
      },
    });
    append('project:b', {
      user: 'run it',
      assistant: 'ran',
      patch: { version: 1, operations: [] },
      outcome: 'applied',
    });
    const histories = useAiConversationStore.getState().histories;
    const a = histories['project:a']!;
    const b = histories['project:b']!;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.assistantRecord?.undoable).toBe(true);
    expect(b[0]!.assistantRecord).toBeUndefined();
    expect(a[0]!.assistant).toBe('done');
  });

  it('clears one scope without touching another (assistant turns)', () => {
    const store = useAiConversationStore.getState();
    store.append('project:x', {
      user: 'u',
      assistant: 'a',
      patch: { version: 1, operations: [] },
      outcome: 'applied',
      assistantRecord: { steps: [] },
    });
    store.append('project:y', {
      user: 'u',
      assistant: 'a',
      patch: { version: 1, operations: [] },
      outcome: 'applied',
      assistantRecord: { steps: [] },
    });
    useAiConversationStore.getState().clear('project:x');
    const after = useAiConversationStore.getState().histories;
    expect(after['project:x']).toBeUndefined();
    expect(after['project:y']).toHaveLength(1);
  });
});

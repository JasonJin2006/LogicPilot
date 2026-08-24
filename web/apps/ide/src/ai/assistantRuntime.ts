// Assistant Runtime: the client-side agent loop. One turn = repeated
//   build context -> ask /api/assistant -> validate response ->
//   execute tools -> feed results back -> ... -> done
// The runtime is deterministic in its control flow; the only external input
// is the (server-side) model response and the tool executions. Cancellation
// aborts the in-flight request and stops the loop.

import {
  currentExperiment,
  summarizeMetrics,
  undoAssistantChange,
} from './capabilities/logicpilot-modeling/runtime';
import type {
  AssistantContext,
  AssistantSessionState,
  AssistantStepResponse,
  AssistantToolResult,
  AssistantTurnMessage,
  AssistantUsage,
} from './assistantTypes';
import { createAssistantSession } from './assistantTypes';
import {
  AssistantKernel,
  createAssistantKernel,
  type AssistantKernelCheckpoint,
  type AssistantKernelEvent,
} from './assistantKernel';
import { resolveAgentTools } from './agentCapabilities';
import type { AgentToolScope } from './agentContracts';
import { findAssistantTool, type AssistantTool } from './capabilities/logicpilot-modeling/tools';
import { useModelStore } from '../state/modelStore';
import type { ModelPatch } from '@logicpilot/editor';

export const DEFAULT_MAX_ITERATIONS = 8;

export type AssistantStepKind = 'message' | 'plan' | 'approval' | 'tool' | 'tool-result' | 'error';
export type AssistantStepStatus = 'pending' | 'running' | 'completed' | 'rejected' | 'failed';

export interface AssistantStepRecord {
  kind: AssistantStepKind;
  /** Short human label (plan step, tool name, or the model's message). */
  label: string;
  /** Optional detail: tool result summary, diagnostics, error text. */
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  ok?: boolean;
  status?: AssistantStepStatus;
  usage?: AssistantUsage;
}

export interface AssistantPatchApprovalRequest {
  patch: ModelPatch;
  summary: string;
  toolCallId: string;
}

export interface AssistantToolApprovalRequest {
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  summary: string;
}

export interface AssistantRunResult {
  ok: boolean;
  /** Final assistant message (the last one the model produced). */
  message: string;
  steps: AssistantStepRecord[];
  cancelled: boolean;
  /** True when the user explicitly declined a proposed mutation. */
  declined?: boolean;
  error?: string;
  /** Model-visible transcript emitted by this turn, including tool pairs. */
  modelMessages?: AssistantTurnMessage[];
  /** Normalized kernel events for replay and session restoration. */
  kernelEvents?: AssistantKernelEvent[];
  checkpoint?: AssistantKernelCheckpoint;
  /** Present only when this turn produced a new, safely undoable AI transaction. */
  undoTokenId?: string;
}

export interface RunAssistantOptions {
  message: string;
  context: AssistantContext;
  session: AssistantSessionState;
  maxIterations?: number;
  /** Base URL prefix for the assistant endpoint ('' in the desktop app). */
  apiBase?: string;
  sessionToken?: string;
  /** Capability packages mounted by the host (for example modeling tools). */
  capabilities?: string[];
  /** Where this turn runs (the active document's contribution type). When
   *  given, capabilities discover their tools for that scope; when omitted,
   *  the full mounted tool set applies. */
  toolScope?: AgentToolScope;
  /** Runtime-discovered tools, such as MCP tools, mounted for this turn. */
  additionalTools?: readonly AssistantTool[];
  /** Skill ids selected by the host or user for this turn. */
  skills?: string[];
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Cancellation signal (aborts the in-flight request and stops the loop). */
  signal?: AbortSignal;
  /** Bounded prior conversation supplied by the active project/model scope. */
  history?: AssistantTurnMessage[];
  /** Resume an open turn from a persisted checkpoint. */
  checkpoint?: AssistantKernelCheckpoint;
  /** Persist the open turn while it is running. */
  onCheckpoint?: (checkpoint: AssistantKernelCheckpoint) => void;
  /** Receives a fresh snapshot whenever a visible execution step is added. */
  onProgress?: (steps: AssistantStepRecord[]) => void;
  /** Receives provider text/reasoning deltas when the streaming endpoint is available. */
  onToken?: (chunk: { type: 'text' | 'reasoning'; delta: string }) => void;
  /** Optional product boundary: pause before a model mutation until the user
   * explicitly accepts or rejects the validated patch preview. */
  confirmModelPatch?: (request: AssistantPatchApprovalRequest) => Promise<boolean>;
  /** Generic approval hook for host-mounted tools such as MCP. */
  confirmToolCall?: (request: AssistantToolApprovalRequest) => Promise<boolean>;
}

let undoSequence = 0;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string })?.name === 'AbortError';
}

class AssistantRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AssistantRequestError';
  }
}

function isRetryableRequest(error: unknown): error is AssistantRequestError {
  if (!(error instanceof AssistantRequestError)) return false;
  return error.status === undefined || [408, 425, 429, 500, 502, 503, 504].includes(error.status);
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestStep(
  messages: AssistantTurnMessage[],
  context: AssistantContext,
  options: RunAssistantOptions,
): Promise<AssistantStepResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.onToken != null) {
    return requestStepStream(messages, context, options);
  }
  const retryDelays = [250, 750];
  for (let attempt = 0; ; ++attempt) {
    let response: Response;
    try {
      response = await fetchImpl(`${options.apiBase ?? ''}/api/assistant`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.sessionToken ? { 'x-logicpilot-session': options.sessionToken } : {}),
        },
        body: JSON.stringify({
          messages,
          context,
          capabilities: options.capabilities,
          skills: options.skills,
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (attempt >= retryDelays.length) throw error;
      const delay = retryDelays[attempt]!;
      await waitForRetry(Math.min(Math.max(delay, 50), 10_000), options.signal);
      continue;
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`;
      const retryAfter = response.headers?.get('retry-after');
      const retryAfterMs =
        retryAfter === null || retryAfter === undefined
          ? undefined
          : Number.parseFloat(retryAfter) * 1000;
      const requestError = new AssistantRequestError(
        message,
        response.status,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
      if (!isRetryableRequest(requestError) || attempt >= retryDelays.length) throw requestError;
      const delay = requestError.retryAfterMs ?? retryDelays[attempt]!;
      await waitForRetry(Math.min(Math.max(delay, 50), 10_000), options.signal);
      continue;
    }

    // Runtime schema validation: malformed model output becomes a readable
    // error instead of crashing the UI. It is deliberately not retried.
    if (
      data === null ||
      typeof data !== 'object' ||
      typeof (data as { message?: unknown }).message !== 'string' ||
      typeof (data as { done?: unknown }).done !== 'boolean'
    ) {
      throw new Error('assistant returned malformed JSON (schema validation failed)');
    }
    const responseValue = data as AssistantStepResponse;
    if (!Array.isArray(responseValue.plan) || !Array.isArray(responseValue.toolCalls)) {
      throw new Error('assistant returned malformed JSON (schema validation failed)');
    }
    for (const call of responseValue.toolCalls) {
      if (
        typeof call.id !== 'string' ||
        typeof call.name !== 'string' ||
        call.arguments === null ||
        typeof call.arguments !== 'object'
      ) {
        throw new Error('assistant returned malformed JSON (schema validation failed)');
      }
    }
    if (responseValue.reasoning !== undefined && typeof responseValue.reasoning !== 'string') {
      throw new Error('assistant returned malformed reasoning metadata');
    }
    if (
      responseValue.usage !== undefined &&
      (responseValue.usage === null || typeof responseValue.usage !== 'object')
    ) {
      throw new Error('assistant returned malformed usage metadata');
    }
    return responseValue;
  }
}

async function requestStepStream(
  messages: AssistantTurnMessage[],
  context: AssistantContext,
  options: RunAssistantOptions,
): Promise<AssistantStepResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiBase ?? ''}/api/assistant/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.sessionToken ? { 'x-logicpilot-session': options.sessionToken } : {}),
    },
    body: JSON.stringify({
      messages,
      context,
      capabilities: options.capabilities,
      skills: options.skills,
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    throw new AssistantRequestError(
      (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`,
      response.status,
    );
  }
  if (!response.body) throw new Error('STREAM_UNSUPPORTED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: AssistantStepResponse | null = null;
  const consume = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    const event = JSON.parse(payload) as {
      type?: string;
      delta?: string;
      response?: AssistantStepResponse;
      error?: string;
    };
    if (event.type === 'text' || event.type === 'reasoning') {
      if (typeof event.delta === 'string')
        options.onToken?.({ type: event.type, delta: event.delta });
      return;
    }
    if (event.type === 'error') throw new Error(event.error ?? 'assistant stream failed');
    if (event.type === 'done') finalResponse = event.response ?? null;
  };
  let streamDone = false;
  while (!streamDone) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data:')) consume(line.slice(5).trim());
    }
    if (next.done) streamDone = true;
  }
  if (buffer.startsWith('data:')) consume(buffer.slice(5).trim());
  const parsedResponse = finalResponse as unknown as AssistantStepResponse | null;
  if (parsedResponse === null) throw new Error('assistant stream ended without a final response');
  if (
    typeof parsedResponse.message !== 'string' ||
    typeof parsedResponse.done !== 'boolean' ||
    !Array.isArray(parsedResponse.plan) ||
    !Array.isArray(parsedResponse.toolCalls)
  ) {
    throw new Error('assistant returned malformed JSON (schema validation failed)');
  }
  return parsedResponse;
}

const TOOL_LABELS: Record<string, string> = {
  inspect_model: 'checking model',
  inspect_selection: 'checking selection',
  inspect_diagnostics: 'checking compile diagnostics',
  inspect_run_metrics: 'reading run metrics',
  apply_model_patch: 'applying model change',
  compile_model: 'compiling',
  run_simulation: 'running simulation',
  run_parameter_study: 'running parameter study',
  explain_results: 'explaining measured results',
  optimize_model: 'optimizing current model',
  compare_runs: 'comparing completed runs',
  wait_for_run: 'waiting for run',
  undo_last_ai_change: 'undoing last change',
  inspect_sysml_projection: 'inspecting SysML projection',
  auto_layout_sysml_projection: 'arranging SysML projection',
  set_sysml_projection_view: 'focusing SysML projection',
  focus_sysml_element: 'focusing SysML element',
  move_sysml_element: 'moving SysML element',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `tool ${name}`;
}

function stableToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableToolValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableToolValue(entry)]),
    );
  }
  return value;
}

function toolCallFingerprint(call: { name: string; arguments: Record<string, unknown> }): string {
  return `${call.name}:${JSON.stringify(stableToolValue(call.arguments))}`;
}

function describeToolResult(name: string, result: Record<string, unknown>, ok: boolean): string {
  if (!ok) {
    return `failed: ${String(result.error ?? 'unknown error')}`;
  }
  switch (name) {
    case 'apply_model_patch': {
      const compiled = result.compiled as { ok?: boolean; diagnostics?: unknown[] } | undefined;
      const applied = typeof result.applied === 'number' ? result.applied : 0;
      const summary = typeof result.summary === 'string' ? result.summary : '';
      const compileState =
        compiled === undefined
          ? ''
          : compiled.ok
            ? '; compiled OK'
            : `; compile failed (${(compiled.diagnostics ?? []).length} diagnostics)`;
      return `${applied} change(s) applied${summary ? `: ${summary}` : ''}${compileState}`;
    }
    case 'compile_model': {
      const diagnostics = (result.diagnostics as unknown[]) ?? [];
      return diagnostics.length === 0
        ? 'compiled OK'
        : `compile failed (${diagnostics.length} diagnostics)`;
    }
    case 'run_simulation': {
      const summary = typeof result.summary === 'string' ? result.summary : '';
      return summary !== '' ? summary : 'run finished';
    }
    case 'run_parameter_study': {
      const points = typeof result.pointCount === 'number' ? result.pointCount : 0;
      return points > 0
        ? `parameter study finished (${points} points)`
        : 'parameter study finished';
    }
    case 'explain_results': {
      const findings = Array.isArray(result.findings) ? result.findings.length : 0;
      return findings > 0 ? `${findings} grounded finding(s)` : 'results explained';
    }
    case 'optimize_model': {
      const evaluations = Array.isArray(result.evaluations) ? result.evaluations.length : 0;
      return evaluations > 0
        ? `optimization finished (${evaluations} evaluations)`
        : 'optimization finished';
    }
    case 'compare_runs': {
      const findings = Array.isArray(result.findings) ? result.findings.length : 0;
      return findings > 0 ? `${findings} run comparison finding(s)` : 'runs compared';
    }
    case 'inspect_run_metrics':
    case 'wait_for_run': {
      const metrics = result.metrics as { summary?: Record<string, { mean?: number }> } | null;
      const wq = metrics?.summary?.Wq?.mean;
      return wq === undefined ? 'no metrics yet' : `Wq=${wq.toFixed(4)}`;
    }
    case 'undo_last_ai_change':
      return result.undone === true ? 'undone' : String(result.error ?? 'nothing to undo');
    default:
      return '';
  }
}

function formatUsage(usage: AssistantUsage): string {
  const parts = [];
  if (usage.inputTokens !== undefined) parts.push(`in ${usage.inputTokens}`);
  if (usage.outputTokens !== undefined) parts.push(`out ${usage.outputTokens}`);
  if (usage.reasoningTokens !== undefined) parts.push(`reasoning ${usage.reasoningTokens}`);
  return parts.length > 0 ? `tokens: ${parts.join(' · ')}` : '';
}

function groundedFinalIssue(
  message: string,
  request: string,
  session: AssistantSessionState,
): string | null {
  const metrics = session.runMetrics;
  if (metrics === null || session.runStatus !== 'finished') return null;
  if (!/(result|metric|Wq|Lq|utilization|confidence|CI|指标|结果|等待|利用率|置信)/i.test(request))
    return null;
  const text = message.replace(/,/g, '');
  const summary = metrics.summary ?? {};
  const aliases: Array<[string, string[]]> = [
    ['Wq', ['Wq', 'waiting time', '等待时间']],
    ['Lq', ['Lq', 'queue length', '队列长度']],
    ['utilization', ['utilization', '利用率']],
  ];
  let mentioned = false;
  for (const [metric, names] of aliases) {
    const expected = summary[metric]?.mean;
    if (typeof expected !== 'number' || !Number.isFinite(expected)) continue;
    const pattern = new RegExp(
      `(?:${names.join('|')})\\s*(?:is|=|:|为)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(%|百分之)?`,
      'i',
    );
    const match = pattern.exec(text);
    if (!match) continue;
    mentioned = true;
    const actual =
      match[2] === '%' || match[2] === '百分之' ? Number(match[1]) / 100 : Number(match[1]);
    const tolerance = Math.max(0.01, Math.abs(expected) * 0.02);
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      return `final answer failed grounded metric validation: ${metric} should be ${expected}, but the response reported ${match[1]}${match[2] ?? ''}`;
    }
  }
  return mentioned
    ? null
    : 'final answer failed grounded metric validation: report at least one measured metric from the completed run';
}

/** Run one assistant turn. Never throws: failures are recorded as steps and
 *  returned in the result. */
export async function runAssistantTurn(options: RunAssistantOptions): Promise<AssistantRunResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const availableTools = [
    ...resolveAgentTools(options.capabilities, options.toolScope),
    ...(options.additionalTools ?? []),
  ];
  const steps: AssistantStepRecord[] = [];
  const session = options.session;
  const turnStartDocument = useModelStore.getState().document;
  let appliedTransactionSteps = 0;
  const activateCurrentUndo = (): string | null => {
    if (appliedTransactionSteps <= 0) return null;
    const store = useModelStore.getState();
    const startIndex = store.past.length - appliedTransactionSteps;
    if (
      store.document === turnStartDocument ||
      startIndex < 0 ||
      store.past[startIndex] !== turnStartDocument
    ) {
      return null;
    }
    const id = `ai-undo-${++undoSequence}`;
    session.activeUndo = {
      id,
      before: turnStartDocument,
      after: store.document,
      undoSteps: appliedTransactionSteps,
    };
    return id;
  };
  const publish = () => options.onProgress?.([...steps]);
  const record = (step: AssistantStepRecord): number => {
    steps.push(step);
    publish();
    return steps.length - 1;
  };
  const updateStep = (index: number, update: Partial<AssistantStepRecord>) => {
    steps[index] = { ...steps[index]!, ...update };
    publish();
  };
  // Version guard baseline: the document as of the user's request.
  session.documentSnapshot = useModelStore.getState().document;
  session.lastPatch = null;
  session.lastChangeSummary = '';
  const kernel = options.checkpoint
    ? AssistantKernel.fromCheckpoint(options.checkpoint)
    : createAssistantKernel(options.history);
  if (options.checkpoint === undefined)
    kernel.beginTurn({ role: 'user', content: options.message });
  const publishCheckpoint = () => options.onCheckpoint?.(kernel.checkpoint());
  const recordToolResult = (result: AssistantToolResult) => {
    kernel.recordToolResult(result);
  };
  publishCheckpoint();
  let stepOpen = false;
  let turnOpen = true;
  const closeStep = (reason: 'completed' | 'tool-calls' | 'error' | 'aborted') => {
    if (!stepOpen) return;
    kernel.endStep(reason);
    stepOpen = false;
    publishCheckpoint();
  };
  const closeTurn = (reason: 'completed' | 'error' | 'aborted') => {
    if (!turnOpen) return;
    kernel.endTurn(reason);
    turnOpen = false;
    publishCheckpoint();
  };
  let lastMessage = '';
  let cancelled = false;
  let userDeclinedChange = false;
  const executedToolFingerprints = new Set<string>();
  let toolStateRevision = 0;

  const executeLoop = async (): Promise<AssistantRunResult> => {
    try {
      for (let iteration = 0; iteration < maxIterations; ++iteration) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        kernel.beginStep();
        stepOpen = true;
        const response = await requestStep(kernel.deriveMessages(), options.context, options);
        kernel.recordAssistant(response);
        lastMessage = response.message;
        record({
          kind: 'message',
          label: response.message,
          usage: response.usage,
          ...(response.usage === undefined ? {} : { detail: formatUsage(response.usage) }),
        });
        for (const step of response.plan) {
          record({ kind: 'plan', label: step.label });
        }
        // The first response after a declined patch is an acknowledgement,
        // never an authorization to try another mutation in the same turn.
        if (userDeclinedChange) {
          for (const call of response.toolCalls) {
            kernel.recordSkippedToolCall(call, 'turn ended after the user declined a model change');
          }
          closeStep('aborted');
          closeTurn('completed');
          return { ok: true, message: response.message, steps, cancelled: false, declined: true };
        }
        if (response.done) {
          const groundingIssue = groundedFinalIssue(response.message, options.message, session);
          if (groundingIssue !== null) {
            record({ kind: 'error', label: groundingIssue });
            closeStep('error');
            closeTurn('error');
            return {
              ok: false,
              message: response.message,
              steps,
              cancelled: false,
              error: groundingIssue,
            };
          }
          closeStep('completed');
          closeTurn('completed');
          return { ok: true, message: response.message, steps, cancelled: false };
        }
        if (response.toolCalls.length === 0) {
          const error = 'assistant finished without a final answer or tool call';
          record({ kind: 'error', label: error });
          closeStep('error');
          closeTurn('error');
          return { ok: false, message: response.message, steps, cancelled: false, error };
        }

        const executeKnownTool = async (
          call: (typeof response.toolCalls)[number],
          tool: NonNullable<ReturnType<typeof findAssistantTool>>,
          toolStepIndex: number,
          allowApproval: boolean,
          recordResult: boolean,
        ): Promise<{ stop: boolean; cancelled: boolean; result?: AssistantToolResult }> => {
          if (
            allowApproval &&
            tool.name === 'apply_model_patch' &&
            options.confirmModelPatch != null
          ) {
            const approvalIndex = record({
              kind: 'approval',
              label:
                typeof call.arguments.summary === 'string' && call.arguments.summary.trim() !== ''
                  ? call.arguments.summary
                  : 'Review proposed model change',
              toolName: tool.name,
              toolCallId: call.id,
              status: 'pending',
            });
            const approved = await options.confirmModelPatch({
              patch: call.arguments.patch as ModelPatch,
              summary:
                typeof call.arguments.summary === 'string'
                  ? call.arguments.summary
                  : 'Model change',
              toolCallId: call.id,
            });
            if (!approved) {
              updateStep(approvalIndex, {
                status: 'rejected',
                label: options.signal?.aborted ? 'Model change cancelled' : 'Model change declined',
                ok: false,
              });
              if (options.signal?.aborted) return { stop: true, cancelled: true };
              userDeclinedChange = true;
              const declinedResult: AssistantToolResult = {
                toolCallId: call.id,
                ok: true,
                result: {
                  applied: 0,
                  declined: true,
                  reason: 'user declined the proposed model change',
                },
              };
              if (recordResult) recordToolResult(declinedResult);
              return { stop: true, cancelled: false, result: declinedResult };
            }
            updateStep(approvalIndex, {
              status: 'completed',
              label: 'Model change approved',
              ok: true,
            });
          }
          if (tool.requiresApproval === true && tool.name !== 'apply_model_patch') {
            const approved =
              options.confirmToolCall == null
                ? false
                : await options.confirmToolCall({
                    toolName: tool.name,
                    toolCallId: call.id,
                    arguments: call.arguments,
                    summary: `Allow tool '${tool.name}' to run?`,
                  });
            if (!approved) {
              const declinedResult: AssistantToolResult = {
                toolCallId: call.id,
                ok: false,
                result: { declined: true },
                error: 'tool call was not approved',
              };
              if (recordResult) recordToolResult(declinedResult);
              updateStep(toolStepIndex, { status: 'rejected', ok: false });
              record({
                kind: 'tool-result',
                label: 'tool call not approved',
                toolName: tool.name,
                toolCallId: call.id,
                ok: false,
              });
              return { stop: true, cancelled: false, result: declinedResult };
            }
          }
          let result: AssistantToolResult | undefined;
          try {
            if (tool.name === 'undo_last_ai_change' && appliedTransactionSteps > 0) {
              activateCurrentUndo();
            }
            const executed = await tool.execute(call.arguments, {
              session,
              experiment: currentExperiment(),
              signal: options.signal,
            });
            const toolOk = executed.ok !== false;
            const toolResult: AssistantToolResult = {
              toolCallId: call.id,
              ok: toolOk,
              result: executed,
              ...(toolOk ? {} : { error: String(executed.error ?? 'tool failed') }),
            };
            result = toolResult;
            if (recordResult) recordToolResult(toolResult);
            if (toolOk) {
              if (tool.executionMode !== 'parallel') toolStateRevision += 1;
              updateStep(toolStepIndex, { status: 'completed', ok: true });
              if (tool.name === 'apply_model_patch' && Number(executed.applied ?? 0) > 0) {
                appliedTransactionSteps += 1;
              } else if (tool.name === 'undo_last_ai_change' && executed.undone === true) {
                appliedTransactionSteps = 0;
              }
              record({
                kind: 'tool-result',
                label: describeToolResult(tool.name, executed, true),
                toolName: tool.name,
                toolCallId: call.id,
                ok: true,
              });
            } else {
              updateStep(toolStepIndex, { status: 'failed', ok: false });
              record({
                kind: 'error',
                label: `failed: ${String(executed.error ?? 'tool failed')}`,
                toolName: tool.name,
                toolCallId: call.id,
                ok: false,
              });
            }
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            updateStep(toolStepIndex, { status: 'failed', ok: false });
            const toolResult: AssistantToolResult = {
              toolCallId: call.id,
              ok: false,
              result: {},
              error: text,
            };
            result = toolResult;
            if (recordResult) recordToolResult(toolResult);
            record({
              kind: 'error',
              label: `${toolLabel(tool.name)} failed: ${text}`,
              toolName: tool.name,
              toolCallId: call.id,
              ok: false,
            });
          }
          return { stop: false, cancelled: false, ...(result === undefined ? {} : { result }) };
        };

        const skipRemaining = (start: number, error?: string) => {
          for (const skipped of response.toolCalls.slice(start)) {
            kernel.recordSkippedToolCall(skipped, error);
          }
        };

        let callIndex = 0;
        while (callIndex < response.toolCalls.length) {
          if (options.signal?.aborted) {
            cancelled = true;
            skipRemaining(callIndex);
            break;
          }
          const call = response.toolCalls[callIndex]!;
          const tool = findAssistantTool(call.name, availableTools);
          const fingerprint = `${toolStateRevision}:${toolCallFingerprint(call)}`;
          if (executedToolFingerprints.has(fingerprint)) {
            kernel.recordToolCall(call);
            const error = 'duplicate tool call suppressed; the same result is already available';
            recordToolResult({ toolCallId: call.id, ok: false, result: {}, error });
            record({
              kind: 'tool-result',
              label: 'already checked — skipped duplicate call',
              toolName: call.name,
              toolCallId: call.id,
              ok: true,
            });
            callIndex += 1;
            continue;
          }
          executedToolFingerprints.add(fingerprint);
          kernel.recordToolCall(call);
          if (tool === null) {
            const error = `unknown tool '${call.name}' rejected`;
            recordToolResult({ toolCallId: call.id, ok: false, result: {}, error });
            record({ kind: 'error', label: error });
            callIndex += 1;
            continue;
          }
          const problem = tool.validate(call.arguments);
          if (problem !== null) {
            const error = `invalid arguments for ${call.name}: ${problem}`;
            recordToolResult({ toolCallId: call.id, ok: false, result: {}, error });
            record({ kind: 'error', label: error });
            callIndex += 1;
            continue;
          }

          if (tool.executionMode === 'parallel') {
            const group: Array<{
              call: (typeof response.toolCalls)[number];
              tool: NonNullable<ReturnType<typeof findAssistantTool>>;
            }> = [{ call, tool }];
            let scan = callIndex + 1;
            while (scan < response.toolCalls.length) {
              const candidate = response.toolCalls[scan]!;
              const candidateTool = findAssistantTool(candidate.name, availableTools);
              const candidateFingerprint = `${toolStateRevision}:${toolCallFingerprint(candidate)}`;
              if (
                candidateTool?.executionMode !== 'parallel' ||
                candidateTool.validate(candidate.arguments) !== null ||
                executedToolFingerprints.has(candidateFingerprint)
              )
                break;
              executedToolFingerprints.add(candidateFingerprint);
              kernel.recordToolCall(candidate);
              group.push({ call: candidate, tool: candidateTool });
              scan += 1;
            }
            const toolSteps = group.map(({ call: groupCall, tool: groupTool }) =>
              record({
                kind: 'tool',
                label: toolLabel(groupTool.name),
                toolName: groupTool.name,
                toolCallId: groupCall.id,
                status: 'running',
              }),
            );
            const outcomes = await Promise.all(
              group.map(({ call: groupCall, tool: groupTool }, index) =>
                executeKnownTool(groupCall, groupTool, toolSteps[index]!, false, false),
              ),
            );
            for (const outcome of outcomes) {
              if (outcome.result !== undefined) recordToolResult(outcome.result);
            }
            callIndex = scan;
            if (outcomes.some((outcome) => outcome.cancelled) || options.signal?.aborted) {
              cancelled = true;
              skipRemaining(callIndex);
              break;
            }
            continue;
          }

          const toolStepIndex = record({
            kind: 'tool',
            label: toolLabel(tool.name),
            toolName: tool.name,
            toolCallId: call.id,
            status: 'running',
          });
          const outcome = await executeKnownTool(call, tool, toolStepIndex, true, true);
          callIndex += 1;
          if (outcome.cancelled || options.signal?.aborted) {
            cancelled = true;
            if (outcome.result === undefined) {
              recordToolResult({
                toolCallId: call.id,
                ok: false,
                result: {},
                error: 'tool call aborted before dispatch',
              });
            }
            skipRemaining(callIndex);
            break;
          }
          if (outcome.stop) {
            skipRemaining(callIndex, 'tool call not dispatched after approval was declined');
            break;
          }
        }
        if (cancelled) {
          closeStep('aborted');
          closeTurn('aborted');
          break;
        }
        closeStep('tool-calls');
      }
      if (cancelled) {
        record({ kind: 'error', label: 'cancelled' });
        closeTurn('aborted');
        return { ok: false, message: lastMessage, steps, cancelled: true, error: 'cancelled' };
      }
      const error = `stopped after ${maxIterations} reasoning steps (loop limit)`;
      record({ kind: 'error', label: error });
      closeTurn('error');
      return { ok: false, message: lastMessage, steps, cancelled: false, error };
    } catch (error) {
      const aborted = options.signal?.aborted || isAbortError(error);
      try {
        // An 'error' close is only legal when every proposed tool call has
        // a result; otherwise endStep throws and the checkpoint keeps an
        // open step that no resume can close.
        if (!aborted) {
          kernel.abandonOpenCalls('assistant step failed before the tool call completed');
        }
        closeStep(aborted ? 'aborted' : 'error');
        closeTurn(aborted ? 'aborted' : 'error');
      } catch {
        // Preserve the original model/tool failure; event closure is a
        // best-effort diagnostic record and must not mask it.
      }
      if (aborted) {
        record({ kind: 'error', label: 'cancelled' });
        return { ok: false, message: lastMessage, steps, cancelled: true, error: 'cancelled' };
      }
      const text = error instanceof Error ? error.message : String(error);
      record({ kind: 'error', label: `assistant step failed: ${text}` });
      return { ok: false, message: lastMessage, steps, cancelled: false, error: text };
    }
  };

  const result = await executeLoop();
  const modelMessages = kernel.deriveCurrentTurnMessages();
  const transcriptResult = {
    ...result,
    modelMessages,
    kernelEvents: kernel.currentTurnEvents(),
    checkpoint: kernel.checkpoint(),
  };
  const undoTokenId = activateCurrentUndo();
  if (undoTokenId !== null) {
    if (transcriptResult.cancelled) {
      undoAssistantChange(session, undoTokenId);
      session.lastPatch = null;
      session.lastChangeSummary = '';
      return transcriptResult;
    }
    return { ...transcriptResult, undoTokenId };
  }
  return transcriptResult;
}

export { createAssistantSession, summarizeMetrics };

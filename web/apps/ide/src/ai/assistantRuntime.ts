// Assistant Runtime: the client-side agent loop. One turn = repeated
//   build context -> ask /api/assistant -> validate response ->
//   execute tools -> feed results back -> ... -> done
// The runtime is deterministic in its control flow; the only external input
// is the (server-side) model response and the tool executions. Cancellation
// aborts the in-flight request and stops the loop.

import {
  findAssistantTool,
  currentExperiment,
  summarizeMetrics,
  undoAssistantChange,
} from './assistantTools';
import type {
  AssistantContext,
  AssistantSessionState,
  AssistantStepResponse,
  AssistantToolResult,
  AssistantTurnMessage,
} from './assistantTypes';
import { createAssistantSession } from './assistantTypes';
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
}

export interface AssistantPatchApprovalRequest {
  patch: ModelPatch;
  summary: string;
  toolCallId: string;
}

export interface AssistantRunResult {
  ok: boolean;
  /** Final assistant message (the last one the model produced). */
  message: string;
  steps: AssistantStepRecord[];
  cancelled: boolean;
  error?: string;
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
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Cancellation signal (aborts the in-flight request and stops the loop). */
  signal?: AbortSignal;
  /** Bounded prior conversation supplied by the active project/model scope. */
  history?: AssistantTurnMessage[];
  /** Receives a fresh snapshot whenever a visible execution step is added. */
  onProgress?: (steps: AssistantStepRecord[]) => void;
  /** Optional product boundary: pause before a model mutation until the user
   * explicitly accepts or rejects the validated patch preview. */
  confirmModelPatch?: (request: AssistantPatchApprovalRequest) => Promise<boolean>;
}

let undoSequence = 0;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : (error as { name?: string })?.name === 'AbortError';
}

async function requestStep(
  messages: AssistantTurnMessage[],
  context: AssistantContext,
  options: RunAssistantOptions,
): Promise<AssistantStepResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiBase ?? ''}/api/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, context }),
    signal: options.signal,
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  // Runtime schema validation: malformed model output becomes a readable
  // error instead of crashing the UI.
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
  return responseValue;
}

const TOOL_LABELS: Record<string, string> = {
  inspect_model: 'checking model',
  inspect_selection: 'checking selection',
  inspect_diagnostics: 'checking compile diagnostics',
  inspect_run_metrics: 'reading run metrics',
  apply_model_patch: 'applying model change',
  compile_model: 'compiling',
  run_simulation: 'running simulation',
  wait_for_run: 'waiting for run',
  undo_last_ai_change: 'undoing last change',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `tool ${name}`;
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

/** Run one assistant turn. Never throws: failures are recorded as steps and
 *  returned in the result. */
export async function runAssistantTurn(options: RunAssistantOptions): Promise<AssistantRunResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
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
  const messages: AssistantTurnMessage[] = [
    ...(options.history ?? []).slice(-12),
    { role: 'user', content: options.message },
  ];
  let lastMessage = '';
  let cancelled = false;
  let userDeclinedChange = false;

  const executeLoop = async (): Promise<AssistantRunResult> => {
    try {
      for (let iteration = 0; iteration < maxIterations; ++iteration) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        const response = await requestStep(messages, options.context, options);
        lastMessage = response.message;
        record({ kind: 'message', label: response.message });
        for (const step of response.plan) {
          record({ kind: 'plan', label: step.label });
        }
        // The first response after a declined patch is an acknowledgement,
        // never an authorization to try another mutation in the same turn.
        if (userDeclinedChange) {
          return { ok: true, message: response.message, steps, cancelled: false };
        }
        if (response.done) {
          return { ok: true, message: response.message, steps, cancelled: false };
        }
        if (response.toolCalls.length === 0) {
          const error = 'assistant finished without a final answer or tool call';
          record({ kind: 'error', label: error });
          return { ok: false, message: response.message, steps, cancelled: false, error };
        }

        const toolResults: AssistantToolResult[] = [];
        for (const call of response.toolCalls) {
          if (options.signal?.aborted) {
            cancelled = true;
            break;
          }
          const tool = findAssistantTool(call.name);
          if (tool === null) {
            const error = `unknown tool '${call.name}' rejected`;
            toolResults.push({ toolCallId: call.id, ok: false, result: {}, error });
            record({ kind: 'error', label: error });
            continue;
          }
          const problem = tool.validate(call.arguments);
          if (problem !== null) {
            const error = `invalid arguments for ${call.name}: ${problem}`;
            toolResults.push({ toolCallId: call.id, ok: false, result: {}, error });
            record({ kind: 'error', label: error });
            continue;
          }
          if (tool.name === 'apply_model_patch' && options.confirmModelPatch != null) {
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
              userDeclinedChange = true;
              updateStep(approvalIndex, {
                status: 'rejected',
                label: options.signal?.aborted ? 'Model change cancelled' : 'Model change declined',
                ok: false,
              });
              if (options.signal?.aborted) {
                cancelled = true;
                break;
              }
              toolResults.push({
                toolCallId: call.id,
                ok: true,
                result: {
                  applied: 0,
                  declined: true,
                  reason: 'user declined the proposed model change',
                },
              });
              break;
            }
            updateStep(approvalIndex, {
              status: 'completed',
              label: 'Model change approved',
              ok: true,
            });
          }
          const toolStepIndex = record({
            kind: 'tool',
            label: toolLabel(tool.name),
            toolName: tool.name,
            toolCallId: call.id,
            status: 'running',
          });
          try {
            if (tool.name === 'undo_last_ai_change' && appliedTransactionSteps > 0) {
              activateCurrentUndo();
            }
            const executed = await tool.execute(call.arguments, {
              session,
              experiment: currentExperiment(),
              signal: options.signal,
            });
            // Tools report clean failures via result.ok === false; those must
            // surface as visible error steps (and still feed back to the
            // model so the loop can recover).
            const toolOk = executed.ok !== false;
            toolResults.push({
              toolCallId: call.id,
              ok: toolOk,
              result: executed,
            });
            if (toolOk) {
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
            toolResults.push({ toolCallId: call.id, ok: false, result: {}, error: text });
            record({
              kind: 'error',
              label: `${toolLabel(tool.name)} failed: ${text}`,
              toolName: tool.name,
              toolCallId: call.id,
              ok: false,
            });
          }
        }
        if (cancelled) break;
        messages.push({
          role: 'assistant',
          content: response.message,
          toolCalls: response.toolCalls,
          toolResults,
        });
      }
      if (cancelled) {
        record({ kind: 'error', label: 'cancelled' });
        return { ok: false, message: lastMessage, steps, cancelled: true, error: 'cancelled' };
      }
      const error = `stopped after ${maxIterations} reasoning steps (loop limit)`;
      record({ kind: 'error', label: error });
      return { ok: false, message: lastMessage, steps, cancelled: false, error };
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        record({ kind: 'error', label: 'cancelled' });
        return { ok: false, message: lastMessage, steps, cancelled: true, error: 'cancelled' };
      }
      const text = error instanceof Error ? error.message : String(error);
      record({ kind: 'error', label: `assistant step failed: ${text}` });
      return { ok: false, message: lastMessage, steps, cancelled: false, error: text };
    }
  };

  const result = await executeLoop();
  const undoTokenId = activateCurrentUndo();
  if (undoTokenId !== null) {
    if (result.cancelled) {
      undoAssistantChange(session, undoTokenId);
      session.lastPatch = null;
      session.lastChangeSummary = '';
      return result;
    }
    return { ...result, undoTokenId };
  }
  return result;
}

export { createAssistantSession, summarizeMetrics };

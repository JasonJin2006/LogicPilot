// Assistant Runtime types: the shared vocabulary between the client-side
// agent loop, the tools it executes, and the stateless /api/assistant
// endpoint. Everything here is JSON-serializable (no store objects, no
// functions) so context and tool results can round-trip to the model safely.

import type { ModelDocument, ModelPatch } from '@logicpilot/editor';
import type { AiMetrics } from './api';

/** One tool call proposed by the model (validated before execution). */
export interface AssistantToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The structured result of one executed tool call, fed back to the model. */
export interface AssistantToolResult {
  toolCallId: string;
  ok: boolean;
  result: Record<string, unknown>;
  error?: string;
}

/** One plan step the model announced for the current turn. */
export interface AssistantPlanStep {
  id: string;
  label: string;
}

/** Provider-neutral token accounting for one assistant step. */
export interface AssistantUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

/** One reasoning step returned by /api/assistant (schema-validated). */
export interface AssistantStepResponse {
  message: string;
  plan: AssistantPlanStep[];
  toolCalls: AssistantToolCall[];
  done: boolean;
  /** Optional provider reasoning metadata; not required for tool execution. */
  reasoning?: string;
  usage?: AssistantUsage;
  /** Provider-native reasoning items needed by Responses-style follow-ups. */
  providerItems?: Array<Record<string, unknown>>;
}

/** Persistent AI session state the runtime keeps between turns. */
export interface AssistantSessionState {
  /** DSL of the last compile/run target (kept in sync with edits). */
  dsl: string;
  /** Diagnostics of the most recent compile attempt. */
  diagnostics: Array<{
    code: string;
    message: string;
    severity?: 'error' | 'warning';
    source?: 'preflight' | 'compiler';
  }>;
  /** True when the last compile attempt passed. */
  compiled: boolean;
  /** Status of the most recent run. */
  runStatus: 'idle' | 'running' | 'finished' | 'failed' | 'none';
  /** Metrics of the most recent finished run (real, from the run tool). */
  runMetrics: AiMetrics | null;
  /** Metrics immediately before the most recent finished run. */
  previousRunMetrics: AiMetrics | null;
  /** Human-readable summary of the last finished run. */
  runSummary: string;
  /** Document identity snapshot for the version-conflict guard. */
  documentSnapshot: unknown;
  /** Patch of the last AI-applied change (for "view changes" + undo). */
  lastPatch: ModelPatch | null;
  /** One-line description of the last AI-applied change. */
  lastChangeSummary: string;
  /** Persistent Artifact Graph revision produced by the last AI change. */
  lastArtifactRevisionId?: string;
  /** The only AI transaction that may currently be undone. Kept in memory;
   * persisted conversation records only retain its opaque id. */
  activeUndo: {
    id: string;
    before: ModelDocument;
    after: ModelDocument;
    undoSteps: number;
  } | null;
}

export function createAssistantSession(): AssistantSessionState {
  return {
    dsl: '',
    diagnostics: [],
    compiled: false,
    runStatus: 'none',
    runMetrics: null,
    previousRunMetrics: null,
    runSummary: '',
    documentSnapshot: null,
    lastPatch: null,
    lastChangeSummary: '',
    activeUndo: null,
  };
}

/** Bounded context snapshot sent with every reasoning step. */
export interface AssistantContext {
  project: string;
  /** Absolute workspace root used for project skill discovery. */
  workspaceRoot?: string;
  modelSummary: string;
  selection: string;
  dsl: string;
  diagnostics: string;
  /** Bounded structured knowledge selected from trusted plugin blocks. */
  knowledge?: string;
  /** Bounded structured skill and instruction contributions selected for the turn. */
  skills?: string;
  instructions?: string;
  /** Definitions that explain diagnostic codes and available fixes. */
  diagnosticDefinitions?: string;
  runStatus: string;
  runMetrics: string;
}

/** Wire format for one assistant turn exchange with /api/assistant. */
export interface AssistantTurnMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AssistantToolCall[];
  toolResults?: AssistantToolResult[];
  providerItems?: Array<Record<string, unknown>>;
}

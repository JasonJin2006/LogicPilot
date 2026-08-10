// The controlled tool system of the Assistant Runtime. The model may only
// PROPOSE tool calls; the IDE validates every name/argument and executes
// them here. No tool ever runs arbitrary code: model edits go through
// structured ModelPatch operations applied atomically into the editor's undo
// stack.

import {
  applyModelPatch,
  generateDsl,
  MODEL_PATCH_VERSION,
  type ModelDocument,
  type ModelPatch,
  type ModelPatchOperation,
} from '@logicpilot/editor';
import { aiRunDsl, aiValidateDsl, type ExperimentSettings } from './api';
import type { AssistantSessionState } from './assistantTypes';
import { summarizeModel } from './contextBuilder';
import { BLOCK_DEFS, blockPorts, isExecutableProcessKind } from '../model/blockDefs';
import { validateDesModel } from '../model/modelValidation';
import { useModelStore } from '../state/modelStore';
import { useRunStore } from '../state/runStore';

export type AssistantToolName =
  | 'inspect_model'
  | 'inspect_selection'
  | 'inspect_diagnostics'
  | 'inspect_run_metrics'
  | 'apply_model_patch'
  | 'compile_model'
  | 'run_simulation'
  | 'wait_for_run'
  | 'undo_last_ai_change';

export interface ToolExecutionContext {
  /** Mutable persistent session state (dsl/diagnostics/run metrics/undo). */
  session: AssistantSessionState;
  /** Current experiment settings from the Run panel. */
  experiment: ExperimentSettings;
  /** Cancels network-backed compile/run tools. */
  signal?: AbortSignal;
}

export interface AssistantTool {
  name: AssistantToolName;
  description: string;
  /** JSON-schema-ish parameter shape, surfaced in the tool prompt. */
  parameters: Record<string, unknown>;
  /** Return null when the arguments are acceptable, else a message. */
  validate: (args: Record<string, unknown>) => string | null;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean | null {
  const value = args[key];
  return typeof value === 'boolean' ? value : null;
}

function resolveTarget(document: ModelDocument, target: string): string | null {
  if (document.nodes.some((node) => node.id === target)) {
    return target;
  }
  const byName = document.nodes.filter((node) => node.name === target);
  return byName.length === 1 ? byName[0]!.id : null;
}

const KNOWN_KINDS = new Set(BLOCK_DEFS.map((block) => block.kind));

function validateOperation(operation: ModelPatchOperation): string | null {
  switch (operation.op) {
    case 'rename_model':
      return typeof operation.name === 'string' && operation.name.trim() !== ''
        ? null
        : 'rename_model.name must be a non-empty string';
    case 'add_block': {
      if (typeof operation.kind !== 'string' || !KNOWN_KINDS.has(operation.kind)) {
        return `add_block.kind '${operation.kind}' is not a known block type`;
      }
      if (operation.library === 'process' && !isExecutableProcessKind(operation.kind)) {
        return `add_block.kind '${operation.kind}' is not executable in the process library`;
      }
      if (typeof operation.name !== 'string' || operation.name.trim() === '') {
        return 'add_block.name must be a non-empty string';
      }
      return validateParamValues(operation.params);
    }
    case 'update_block': {
      if (typeof operation.target !== 'string' || operation.target.trim() === '') {
        return 'update_block.target must be a non-empty string';
      }
      return validateParamValues(operation.params);
    }
    case 'remove_block':
      return typeof operation.target === 'string' && operation.target.trim() !== ''
        ? null
        : 'remove_block.target must be a non-empty string';
    case 'connect': {
      if (typeof operation.from !== 'string' || typeof operation.to !== 'string') {
        return 'connect.from and connect.to must be strings';
      }
      return null; // port existence is checked against the resolved nodes
    }
    case 'disconnect':
      return null;
    default:
      return `unknown operation '${(operation as { op: string }).op}'`;
  }
}

function validateParamValues(params: Record<string, unknown> | undefined): string | null {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return `param '${key}' must be a finite number`;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return `param '${key}' must be a string, number or boolean`;
    }
  }
  return null;
}

/** Preview the patch against the live document WITHOUT committing, so
 *  unknown/ambiguous targets, duplicate names, bad ports and dangling
 *  removals are rejected before anything touches the undo stack. */
function previewPatch(patch: unknown): { ok: boolean; error?: string; preview?: ModelPatch } {
  if (
    patch === null ||
    typeof patch !== 'object' ||
    (patch as { version?: unknown }).version !== MODEL_PATCH_VERSION ||
    !Array.isArray((patch as { operations?: unknown }).operations)
  ) {
    return { ok: false, error: 'patch must be {version:1, operations:[...]}' };
  }
  const operations = (patch as { operations: ModelPatchOperation[] }).operations;
  if (operations.length === 0) {
    return { ok: false, error: 'patch has no operations' };
  }
  for (const operation of operations) {
    const problem = validateOperation(operation);
    if (problem) {
      return { ok: false, error: problem };
    }
  }
  const document = useModelStore.getState().document;
  const preview = applyModelPatch(document, { version: MODEL_PATCH_VERSION, operations });
  if (!preview.ok) {
    return {
      ok: false,
      error: preview.diagnostics.map((entry) => entry.message).join('; '),
    };
  }
  return { ok: true, preview: { version: MODEL_PATCH_VERSION, operations } };
}

/** Number of edges that would be removed with the node (dangling-connection
 *  report for remove_block). */
function danglingEdgeCount(document: ModelDocument, nodeId: string): number {
  return document.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}

async function compileCurrent(
  session: AssistantSessionState,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  phase: 'preflight' | 'compiler';
  diagnostics: Array<{
    code: string;
    message: string;
    severity?: 'error' | 'warning';
    source?: 'preflight' | 'compiler';
  }>;
}> {
  const document = useModelStore.getState().document;
  const dsl = generateDsl(document);
  session.dsl = dsl;
  const preflight = validateDesModel(document).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: 'preflight' as const,
  }));
  if (preflight.some((diagnostic) => diagnostic.severity === 'error')) {
    session.diagnostics = preflight;
    session.compiled = false;
    return { ok: false, phase: 'preflight', diagnostics: preflight };
  }

  const result = await aiValidateDsl(dsl, signal);
  // Preserve the backend diagnostic wire shape for existing consumers. The
  // top-level phase identifies a compiler result; only local diagnostics
  // need an explicit source marker when they are fed back to the model.
  const diagnostics = [...preflight, ...result.diagnostics];
  session.diagnostics = diagnostics;
  session.compiled = result.ok;
  return { ok: result.ok, phase: 'compiler', diagnostics };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  {
    name: 'inspect_model',
    description: 'Read a compact summary of the current model.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const document = useModelStore.getState().document;
      return { model: summarizeModel(document) };
    },
  },
  {
    name: 'inspect_selection',
    description: 'Read the currently selected block on the canvas.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const { document, selectedId } = useModelStore.getState();
      if (selectedId === null) {
        return { selection: null, message: 'no block is selected' };
      }
      const node = document.nodes.find((entry) => entry.id === selectedId) ?? null;
      return { selection: node };
    },
  },
  {
    name: 'inspect_diagnostics',
    description: 'Read preflight and compiler diagnostics of the most recent compile attempt.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) => {
      if (!session.dsl) {
        return { diagnostics: [], note: 'nothing has been compiled yet' };
      }
      return { diagnostics: session.diagnostics, compiled: session.compiled };
    },
  },
  {
    name: 'inspect_run_metrics',
    description: 'Read metrics of the most recent finished simulation run.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) => {
      if (session.runMetrics === null) {
        return {
          ok: false,
          error: 'no run metrics available - run the model first (run_simulation)',
        };
      }
      return {
        ok: true,
        metrics: summarizeMetrics(session.runMetrics),
        summary: session.runSummary,
      };
    },
  },
  {
    name: 'apply_model_patch',
    description: 'Apply a structured model patch as one atomic, undoable edit, then compile.',
    parameters: {
      patch: { type: 'object', required: true },
      summary: { type: 'string', required: true },
    },
    validate: (args) => {
      if (stringArg(args, 'summary') === null) {
        return 'apply_model_patch.summary must be a string';
      }
      const checked = previewPatch(args.patch);
      return checked.ok ? null : (checked.error ?? 'invalid patch');
    },
    execute: async (args, { session, signal }) => {
      const summary = stringArg(args, 'summary') ?? '';
      const checked = previewPatch(args.patch);
      if (!checked.ok) {
        return { ok: false, error: checked.error ?? 'invalid patch' };
      }
      const patch = checked.preview!;
      const store = useModelStore.getState();
      // Version guard: never write over edits made while the AI was working.
      if (session.documentSnapshot !== null && store.document !== session.documentSnapshot) {
        return {
          ok: false,
          error:
            'the model changed during the AI request; stop and review the manual edit before retrying',
        };
      }
      const before = store.document;
      const result = store.applyPatch(patch);
      if (!result.ok) {
        return {
          ok: false,
          error: result.diagnostics.map((entry) => entry.message).join('; '),
        };
      }
      const after = useModelStore.getState().document;
      const removedEdges = before.edges.filter(
        (edge) => !after.edges.some((entry) => entry.id === edge.id),
      ).length;
      session.documentSnapshot = after;
      session.lastPatch =
        session.lastPatch === null
          ? patch
          : {
              version: MODEL_PATCH_VERSION,
              operations: [...session.lastPatch.operations, ...patch.operations],
            };
      session.lastChangeSummary = [session.lastChangeSummary, summary].filter(Boolean).join('; ');
      session.runStatus = 'none';
      session.runMetrics = null;
      session.runSummary = '';
      // The DES loop: apply -> auto compile -> diagnostics fed back.
      const compiled = await compileCurrent(session, signal);
      return {
        ok: true,
        applied: result.applied,
        summary,
        removedEdges,
        compiled,
        model: summarizeModel(after),
      };
    },
  },
  {
    name: 'compile_model',
    description: 'Preflight the model, then compile its DSL and return diagnostics.',
    parameters: {},
    validate: () => null,
    execute: async (_args, { session, signal }) => {
      const compiled = await compileCurrent(session, signal);
      return {
        ok: compiled.ok,
        phase: compiled.phase,
        diagnostics: compiled.diagnostics,
      };
    },
  },
  {
    name: 'run_simulation',
    description: 'Compile and run a DES simulation of the current model, returning real metrics.',
    parameters: {},
    validate: () => null,
    execute: async (_args, { session, experiment, signal }) => {
      const document = useModelStore.getState().document;
      if (document.nodes.length === 0) {
        return { ok: false, error: 'the canvas is empty - create a model first' };
      }
      const compiled = await compileCurrent(session, signal);
      if (!compiled.ok) {
        session.runStatus = 'failed';
        return {
          ok: false,
          error: 'model does not compile; fix these diagnostics first',
          phase: compiled.phase,
          diagnostics: compiled.diagnostics,
        };
      }
      session.runStatus = 'running';
      const run = await aiRunDsl(session.dsl, experiment, signal);
      if (!run.ok || run.metrics === undefined) {
        session.runStatus = 'failed';
        session.runSummary = run.runSummary ?? 'run failed';
        return { ok: false, error: 'run failed', diagnostics: run.diagnostics };
      }
      session.runStatus = 'finished';
      session.runMetrics = run.metrics;
      session.runSummary = run.runSummary;
      return {
        ok: true,
        metrics: summarizeMetrics(run.metrics),
        summary: run.runSummary,
      };
    },
  },
  {
    name: 'wait_for_run',
    description: 'Return the status of the last requested run.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) => {
      if (session.runStatus === 'none' || session.runStatus === 'idle') {
        return { status: 'none', message: 'no run has been requested yet' };
      }
      return {
        status: session.runStatus,
        summary: session.runSummary,
        metrics: session.runMetrics === null ? null : summarizeMetrics(session.runMetrics),
      };
    },
  },
  {
    name: 'undo_last_ai_change',
    description: 'Undo the most recent AI-applied model change.',
    parameters: {},
    validate: () => null,
    execute: async (_args, { session, signal }) => {
      const undone = undoAssistantChange(session, session.activeUndo?.id ?? '');
      if (!undone.ok) return undone;
      session.lastPatch = null;
      session.lastChangeSummary = '';
      const compiled = await compileCurrent(session, signal);
      return {
        ok: true,
        undone: true,
        compiled,
        model: summarizeModel(useModelStore.getState().document),
      };
    },
  },
];

/** Undo an AI transaction only while it is still the exact top segment of
 * the model history. Manual edits, reloads and later AI transactions make
 * the token stale instead of allowing an unrelated global undo. */
export function undoAssistantChange(
  session: AssistantSessionState,
  tokenId: string,
): { ok: boolean; undone?: boolean; error?: string } {
  const token = session.activeUndo;
  const store = useModelStore.getState();
  if (
    token === null ||
    token.id !== tokenId ||
    store.document !== token.after ||
    token.undoSteps <= 0 ||
    store.past.length < token.undoSteps ||
    store.past[store.past.length - token.undoSteps] !== token.before
  ) {
    return { ok: false, error: 'the AI change is no longer the latest model transaction' };
  }
  for (let index = 0; index < token.undoSteps; ++index) {
    useModelStore.getState().undo();
  }
  if (useModelStore.getState().document !== token.before) {
    return { ok: false, error: 'the model history changed; AI undo was stopped' };
  }
  session.activeUndo = null;
  session.documentSnapshot = useModelStore.getState().document;
  session.dsl = generateDsl(useModelStore.getState().document);
  session.diagnostics = [];
  session.compiled = false;
  session.runStatus = 'none';
  session.runMetrics = null;
  session.runSummary = '';
  return { ok: true, undone: true };
}

export function findAssistantTool(name: string): AssistantTool | null {
  return ASSISTANT_TOOLS.find((tool) => tool.name === name) ?? null;
}

/** Bound a metrics object to the digest the model needs (never the full
 *  replications array, which can be large). */
export function summarizeMetrics(metrics: NonNullable<AssistantSessionState['runMetrics']>) {
  return {
    summary: metrics.summary ?? null,
    blocks: (metrics.blocks ?? []).map((block) => ({
      name: block.name,
      kind: block.kind,
      capacity: block.capacity,
      arrived_mean: block.arrived_mean,
      departed_mean: block.departed_mean,
      timed_out_mean: block.timed_out_mean,
      mean_occupancy: block.mean_occupancy,
      utilization: block.utilization,
      availability: block.availability,
    })),
  };
}

export { summarizeModel };

export function currentExperiment(): ExperimentSettings {
  const { runOptions } = useRunStore.getState();
  return {
    seed: runOptions.seed,
    seedMode: runOptions.seedMode,
    reps: runOptions.reps,
    replicationMode: runOptions.replicationMode,
    minReps: runOptions.minReps,
    maxReps: runOptions.maxReps,
    errorPercent: runOptions.errorPercent,
    precisionMetric: runOptions.precisionMetric,
    arrivals: runOptions.arrivals,
    warmup: runOptions.warmup,
    confidence: runOptions.confidence,
  };
}

export { blockPorts, numberArg, booleanArg, resolveTarget, danglingEdgeCount };

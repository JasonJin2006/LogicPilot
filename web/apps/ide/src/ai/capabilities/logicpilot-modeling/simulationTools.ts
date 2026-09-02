// Simulation and compiler tools owned by the LogicPilot modeling capability.

import { aiRunDsl, runParameterVariation } from '../../api';
import type { AssistantTool } from '../../toolTypes';
import { useModelStore } from '../../../state/modelStore';
import { compileCurrent } from './compile';
import { summarizeMetrics } from './metrics';
import { undoAssistantChange } from './undo';
import { persistRunArtifact } from '../../../artifacts/artifactGraphClient';

function stringArg(args: Record<string, unknown>, key: string): string | null {
  return typeof args[key] === 'string' ? (args[key] as string) : null;
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  return typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : null;
}

export const MODEL_SIMULATION_TOOLS: readonly AssistantTool[] = [
  {
    name: 'run_parameter_study',
    description: 'Run a bounded parameter variation experiment on the current model.',
    parameters: {
      experimentName: { type: 'string' },
      arrivals: { type: 'number' },
      warmup: { type: 'number' },
      concurrency: { type: 'number' },
    },
    validate: (args) => {
      for (const key of ['arrivals', 'warmup', 'concurrency']) {
        const value = args[key];
        if (
          value !== undefined &&
          (typeof value !== 'number' ||
            !Number.isFinite(value) ||
            (key !== 'warmup' && value <= 0) ||
            (key === 'warmup' && value < 0))
        )
          return `${key} must be a positive finite number`;
      }
      return args.experimentName !== undefined && typeof args.experimentName !== 'string'
        ? 'experimentName must be a string'
        : null;
    },
    execute: async (args, { session, experiment }) => {
      if (!session.dsl) {
        const compiled = await compileCurrent(session);
        if (!compiled.ok)
          return { ok: false, error: 'model does not compile', diagnostics: compiled.diagnostics };
      }
      const result = await runParameterVariation(session.dsl, {
        experimentName: stringArg(args, 'experimentName') ?? undefined,
        arrivals: numberArg(args, 'arrivals') ?? experiment.arrivals,
        warmup: numberArg(args, 'warmup') ?? experiment.warmup,
        concurrency: numberArg(args, 'concurrency') ?? undefined,
      });
      return { ...result } as unknown as Record<string, unknown>;
    },
  },
  {
    name: 'compile_model',
    description: 'Preflight and compile the current model, returning structured diagnostics.',
    parameters: {},
    validate: () => null,
    execute: async (_args, { session, signal }) => {
      const compiled = await compileCurrent(session, signal);
      return { ok: compiled.ok, phase: compiled.phase, diagnostics: compiled.diagnostics };
    },
  },
  {
    name: 'run_simulation',
    description: 'Compile and run the current simulation model, returning measured results.',
    parameters: {},
    validate: () => null,
    execute: async (_args, { session, experiment, signal }) => {
      const document = useModelStore.getState().document;
      if (document.nodes.length === 0)
        return { ok: false, error: 'the canvas is empty - create a model first' };
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
      const previousRunMetrics = session.runMetrics;
      const run = await aiRunDsl(session.dsl, experiment, signal);
      let artifactRevisionId: string | undefined;
      let artifactSyncError: string | undefined;
      try {
        artifactRevisionId = await persistRunArtifact({
          modelRevisionId: session.lastArtifactRevisionId,
          result: run,
        });
      } catch (error) {
        artifactSyncError = error instanceof Error ? error.message : String(error);
      }
      if (!run.ok || run.metrics === undefined) {
        session.runStatus = 'failed';
        session.runSummary = run.runSummary ?? 'run failed';
        return {
          ok: false,
          error: 'run failed',
          diagnostics: run.diagnostics,
          ...(artifactRevisionId === undefined ? {} : { artifactRevisionId }),
          ...(artifactSyncError === undefined ? {} : { artifactSyncError }),
        };
      }
      session.runStatus = 'finished';
      session.previousRunMetrics = previousRunMetrics;
      session.runMetrics = run.metrics;
      session.runSummary = run.runSummary;
      return {
        ok: true,
        metrics: summarizeMetrics(run.metrics),
        summary: run.runSummary,
        ...(artifactRevisionId === undefined ? {} : { artifactRevisionId }),
        ...(artifactSyncError === undefined ? {} : { artifactSyncError }),
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
        model: {
          name: useModelStore.getState().document.name,
          nodes: useModelStore.getState().document.nodes.length,
          edges: useModelStore.getState().document.edges.length,
        },
      };
    },
  },
];

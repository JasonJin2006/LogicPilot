// Read-only model inspection tools owned by the LogicPilot capability.

import { summarizeModel } from '../../contextBuilder';
import type { AssistantTool } from '../../toolTypes';
import type { AssistantSessionState } from '../../assistantTypes';
import { useModelStore } from '../../../state/modelStore';

export const MODEL_INSPECTION_TOOLS: readonly AssistantTool[] = [
  {
    name: 'inspect_model',
    executionMode: 'parallel',
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
    executionMode: 'parallel',
    description: 'Read the currently selected block on the canvas.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const { document, selectedId } = useModelStore.getState();
      if (selectedId === null) return { selection: null, message: 'no block is selected' };
      const node = document.nodes.find((entry) => entry.id === selectedId) ?? null;
      return { selection: node };
    },
  },
];

function summarizeRunMetrics(metrics: NonNullable<AssistantSessionState['runMetrics']>) {
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

export const MODEL_READ_TOOLS: readonly AssistantTool[] = [
  {
    name: 'inspect_diagnostics',
    executionMode: 'parallel',
    description: 'Read preflight and compiler diagnostics of the most recent compile attempt.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) =>
      session.dsl
        ? { diagnostics: session.diagnostics, compiled: session.compiled }
        : { diagnostics: [], note: 'nothing has been compiled yet' },
  },
  {
    name: 'inspect_run_metrics',
    executionMode: 'parallel',
    description: 'Read metrics of the most recent finished simulation run.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) =>
      session.runMetrics === null
        ? { ok: false, error: 'no run metrics available - run the model first (run_simulation)' }
        : {
            ok: true,
            metrics: summarizeRunMetrics(session.runMetrics),
            summary: session.runSummary,
          },
  },
  {
    name: 'wait_for_run',
    description: 'Return the status of the last requested run.',
    parameters: {},
    validate: () => null,
    execute: (_args, { session }) =>
      session.runStatus === 'none' || session.runStatus === 'idle'
        ? { status: 'none', message: 'no run has been requested yet' }
        : {
            status: session.runStatus,
            summary: session.runSummary,
            metrics: session.runMetrics === null ? null : summarizeRunMetrics(session.runMetrics),
          },
  },
];

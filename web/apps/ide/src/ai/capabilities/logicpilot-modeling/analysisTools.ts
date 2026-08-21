// Analysis tools owned by the LogicPilot modeling capability.

import { aiCompareMetrics, aiOptimize, aiQueryMetrics } from '../../api';
import type { AssistantTool } from '../../toolTypes';
import { generateDsl } from '@logicpilot/editor';
import { useModelStore } from '../../../state/modelStore';

function stringArg(args: Record<string, unknown>, key: string): string | null {
  return typeof args[key] === 'string' ? (args[key] as string) : null;
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  return typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : null;
}

export const MODEL_ANALYSIS_TOOLS: readonly AssistantTool[] = [
  {
    name: 'explain_results',
    description: 'Explain the latest completed simulation using only grounded metrics.',
    parameters: { question: { type: 'string', required: true } },
    validate: (args) => {
      const question = stringArg(args, 'question');
      return question === null || question.trim() === ''
        ? 'question must be a non-empty string'
        : null;
    },
    execute: async (args, { session }) => {
      if (session.runMetrics === null)
        return { ok: false, error: 'no run metrics available - run the model first' };
      const result = await aiQueryMetrics(
        stringArg(args, 'question')!,
        session.runMetrics,
        useModelStore.getState().document,
      );
      return { ok: true, ...result };
    },
  },
  {
    name: 'optimize_model',
    description: 'Search the current model for a better parameter configuration.',
    parameters: { prompt: { type: 'string', required: true } },
    validate: (args) => {
      const prompt = stringArg(args, 'prompt');
      return prompt === null || prompt.trim() === '' ? 'prompt must be a non-empty string' : null;
    },
    execute: async (args) => {
      const result = await aiOptimize(
        stringArg(args, 'prompt')!,
        generateDsl(useModelStore.getState().document),
      );
      return { ok: true, ...result };
    },
  },
  {
    name: 'compare_runs',
    description: 'Compare the two most recent completed runs using paired metrics.',
    parameters: { confidence: { type: 'number' } },
    validate: (args) => {
      const confidence = args.confidence;
      return confidence !== undefined &&
        (typeof confidence !== 'number' ||
          !Number.isFinite(confidence) ||
          confidence <= 0 ||
          confidence >= 1)
        ? 'confidence must be between 0 and 1'
        : null;
    },
    execute: async (args, { session }) => {
      if (session.previousRunMetrics === null || session.runMetrics === null) {
        return { ok: false, error: 'two completed runs are required before comparing results' };
      }
      const result = await aiCompareMetrics(
        session.previousRunMetrics,
        session.runMetrics,
        numberArg(args, 'confidence') ?? 0.95,
      );
      return { ok: true, ...result };
    },
  },
];

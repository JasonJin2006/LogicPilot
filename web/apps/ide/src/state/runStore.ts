// Run lifecycle store: RunStarted/RunFinished views.

import { create } from 'zustand';
import type { RunFinishedView, RunStartedView } from '@logicpilot/renderer2d';

export interface RunOptions {
  seed: number;
  seedMode: 'fixed' | 'random';
  reps: number;
  replicationMode: 'fixed' | 'precision';
  minReps: number;
  maxReps: number;
  errorPercent: number;
  precisionMetric: 'throughput' | 'L' | 'Lq' | 'W' | 'Wq' | 'utilization' | 'availability';
  // "fast" (default) runs without wall-clock pacing; "animated" paces by
  // speed and keeps pause/step meaningful.
  executionMode: 'fast' | 'animated';
  arrivals: number;
  warmup: number;
  confidence: number;
  speed: number;
}

export function validateRunOptions(options: RunOptions): string | null {
  for (const [name, minimum] of [
    ['seed', 0],
    ['reps', 1],
    ['minReps', 2],
    ['maxReps', 2],
    ['arrivals', 1],
    ['warmup', 0],
  ] as const) {
    const value = options[name];
    if (!Number.isSafeInteger(value) || value < minimum) {
      return `${name} must be an integer ≥ ${minimum}`;
    }
  }
  if (options.warmup >= options.arrivals) return 'warmup must be less than arrivals';
  if (options.replicationMode === 'precision' && options.maxReps < options.minReps) {
    return 'maxReps must be greater than or equal to minReps';
  }
  if (options.executionMode !== 'fast' && options.executionMode !== 'animated') {
    return 'executionMode must be "fast" or "animated"';
  }
  if (!Number.isFinite(options.errorPercent) || options.errorPercent <= 0) {
    return 'errorPercent must be greater than 0';
  }
  if (!Number.isFinite(options.confidence) || options.confidence <= 0 || options.confidence >= 1) {
    return 'confidence must be between 0 and 1';
  }
  if (!Number.isFinite(options.speed) || options.speed <= 0) return 'speed must be greater than 0';
  return null;
}

interface RunStore {
  runInfo: RunStartedView | null;
  results: RunFinishedView | null;
  running: boolean;
  runOptions: RunOptions;

  started: (info: RunStartedView) => void;
  finished: (results: RunFinishedView) => void;
  reset: () => void;
  setRunOptions: (options: Partial<RunOptions>) => void;
}

export const useRunStore = create<RunStore>((set) => ({
  runInfo: null,
  results: null,
  running: false,
  runOptions: {
    seed: 42,
    seedMode: 'fixed',
    reps: 3,
    replicationMode: 'fixed',
    minReps: 5,
    maxReps: 100,
    errorPercent: 5,
    precisionMetric: 'Wq',
    executionMode: 'fast',
    arrivals: 4000,
    warmup: 400,
    confidence: 0.95,
    speed: 10,
  },

  started: (info) => set({ runInfo: info, results: null, running: true }),
  finished: (results) => set({ results, running: false }),
  reset: () => set({ runInfo: null, results: null, running: false }),
  setRunOptions: (options) => set((state) => ({ runOptions: { ...state.runOptions, ...options } })),
}));

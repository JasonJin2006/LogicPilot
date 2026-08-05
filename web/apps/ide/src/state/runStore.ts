// Run lifecycle store: RunStarted/RunFinished views.

import { create } from 'zustand';
import type { RunFinishedView, RunStartedView } from '@logicpilot/renderer2d';

export interface RunOptions {
  seed: number;
  reps: number;
  arrivals: number;
  warmup: number;
  speed: number;
}

interface RunStore {
  runInfo: RunStartedView | null;
  results: RunFinishedView | null;
  runOptions: RunOptions;

  started: (info: RunStartedView) => void;
  finished: (results: RunFinishedView) => void;
  reset: () => void;
  setRunOptions: (options: Partial<RunOptions>) => void;
}

export const useRunStore = create<RunStore>((set) => ({
  runInfo: null,
  results: null,
  runOptions: { seed: 42, reps: 3, arrivals: 4000, warmup: 400, speed: 10 },

  started: (info) => set({ runInfo: info, results: null }),
  finished: (results) => set({ results }),
  reset: () => set({ runInfo: null, results: null }),
  setRunOptions: (options) => set((state) => ({ runOptions: { ...state.runOptions, ...options } })),
}));

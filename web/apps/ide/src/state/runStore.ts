// Run lifecycle store: RunStarted/RunFinished views plus the chart sink the
// frame handler feeds. ChartPanel registers its imperative handle here so
// the 10 Hz counters path never touches React props.

import { create } from 'zustand';
import type { RunFinishedView, RunStartedView } from '@logicpilot/renderer2d';
import type { ChartsHandle } from '../run/ChartPanel';

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
  charts: ChartsHandle | null;
  runOptions: RunOptions;

  started: (info: RunStartedView) => void;
  finished: (results: RunFinishedView) => void;
  reset: () => void;
  registerCharts: (handle: ChartsHandle | null) => void;
  pushCharts: (t: number, counters: Record<string, number>) => void;
  setRunOptions: (options: Partial<RunOptions>) => void;
}

export const useRunStore = create<RunStore>((set, get) => ({
  runInfo: null,
  results: null,
  charts: null,
  runOptions: { seed: 42, reps: 3, arrivals: 4000, warmup: 400, speed: 10 },

  started: (info) => set({ runInfo: info, results: null }),
  finished: (results) => set({ results }),
  reset: () => set({ runInfo: null, results: null }),
  registerCharts: (handle) => set({ charts: handle }),
  pushCharts: (t, counters) => {
    get().charts?.push(t, counters);
  },
  setRunOptions: (options) => set((state) => ({ runOptions: { ...state.runOptions, ...options } })),
}));

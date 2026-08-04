// Run lifecycle store: RunStarted/RunFinished views plus the chart sink the
// frame handler feeds. ChartPanel registers its imperative handle here so
// the 10 Hz counters path never touches React props.

import { create } from 'zustand';
import type { RunFinishedView, RunStartedView } from '@logicpilot/renderer2d';
import type { ChartsHandle } from '../run/ChartPanel';

interface RunStore {
  runInfo: RunStartedView | null;
  results: RunFinishedView | null;
  charts: ChartsHandle | null;

  started: (info: RunStartedView) => void;
  finished: (results: RunFinishedView) => void;
  reset: () => void;
  registerCharts: (handle: ChartsHandle | null) => void;
  pushCharts: (t: number, counters: Record<string, number>) => void;
}

export const useRunStore = create<RunStore>((set, get) => ({
  runInfo: null,
  results: null,
  charts: null,

  started: (info) => set({ runInfo: info, results: null }),
  finished: (results) => set({ results }),
  reset: () => set({ runInfo: null, results: null }),
  registerCharts: (handle) => set({ charts: handle }),
  pushCharts: (t, counters) => {
    get().charts?.push(t, counters);
  },
}));

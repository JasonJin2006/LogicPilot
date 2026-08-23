// SysML projection state. The external .sysml source remains authoritative;
// this store owns the visual projection, selection and layout sidecar only.

import { create } from 'zustand';
import {
  autoLayoutSysML,
  projectSysML,
  type SysMLLayout,
  type SysMLProjection,
  type SysMLPosition,
} from '../sysml/sysmlProjection';
import {
  runExecutionTarget,
  type TraceStep,
} from '../sysml/sysmlExecution';
import { autoLayoutWithElk } from '../sysml/sysmlAutoLayoutElk';

export type SysMLViewMode = 'all' | 'structure' | 'requirements' | 'behavior' | 'traceability';

const LAYOUT_PREFIX = 'logicpilot.sysml.layout.';

function layoutKey(path: string): string {
  return `${LAYOUT_PREFIX}${path}`;
}

function loadLayout(path: string, projection: SysMLProjection, serialized?: string): SysMLLayout {
  const fallback = autoLayoutSysML(projection);
  const serializedLayout = serialized ?? undefined;
  try {
    const raw = serializedLayout ?? (typeof window !== 'undefined' ? window.localStorage.getItem(layoutKey(path)) : null);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SysMLLayout>;
    if (parsed.version !== 1 || typeof parsed.positions !== 'object' || parsed.positions === null) {
      return fallback;
    }
    const positions: Record<string, SysMLPosition> = { ...fallback.positions };
    const sizes =
      typeof parsed.sizes === 'object' && parsed.sizes !== null ? parsed.sizes : fallback.sizes;
    for (const element of projection.elements) {
      const position = parsed.positions[element.id];
      if (
        position &&
        typeof position.x === 'number' &&
        Number.isFinite(position.x) &&
        typeof position.y === 'number' &&
        Number.isFinite(position.y)
      ) {
        positions[element.id] = { x: position.x, y: position.y };
      }
    }
    return { version: 1, sourceHash: projection.sourceHash, positions, sizes };
  } catch {
    return fallback;
  }
}

function persistLayout(path: string, layout: SysMLLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(layoutKey(path), JSON.stringify(layout));
  } catch {
    // A read-only/private storage backend should not disable visualization.
  }
}

interface SysMLState {
  path: string | null;
  source: string;
  projection: SysMLProjection | null;
  layout: SysMLLayout | null;
  selectedId: string | null;
  viewMode: SysMLViewMode;
  layoutDirty: boolean;
  /** The source currently has error-level diagnostics; projection/layout hold
   *  the LAST VALID snapshot until the errors are fixed (plan §8 S1). */
  parseDirty: boolean;
  /** Execution trace bound to one revision (plan §8 S2); cleared whenever a
   *  new revision arrives so stale results are never shown as current. */
  execution: { targetId: string; sourceHash: string; steps: TraceStep[]; result: number | null } | null;
  runError: string | null;
  runTarget: (targetId: string) => void;
  clearExecution: () => void;
  /** ELK-layered layout (worker, async). Checkpoints like a manual edit so
   *  undo returns to the previous arrangement. */
  applyElkLayout: () => Promise<void>;
  past: SysMLLayout[];
  future: SysMLLayout[];
  load: (path: string, source: string, serialized?: string) => void;
  refresh: (source: string) => void;
  select: (id: string | null) => void;
  setViewMode: (mode: SysMLViewMode) => void;
  checkpoint: () => void;
  move: (id: string, position: SysMLPosition) => void;
  autoLayout: () => void;
  undo: () => void;
  redo: () => void;
  markLayoutPersisted: () => void;
  clear: () => void;
}

export const useSysMLStore = create<SysMLState>((set, get) => ({
  path: null,
  source: '',
  projection: null,
  layout: null,
  selectedId: null,
  viewMode: 'all',
  layoutDirty: false,
  parseDirty: false,
  execution: null,
  runError: null,
  past: [],
  future: [],
  load: (path, source, serialized) => {
    // Opening a file has no previous snapshot to protect: take what parsed.
    const projection = projectSysML(source);
    const layout = loadLayout(path, projection, serialized);
    persistLayout(path, layout);
    set({
      path,
      source,
      projection,
      layout,
      selectedId: null,
      viewMode: 'all',
      layoutDirty: false,
      parseDirty: projection.diagnostics.some((d) => d.severity === 'error'),
      execution: null,
      runError: null,
      past: [],
      future: [],
    });
    // Fresh files have no sidecar: beautify asynchronously once ELK lands.
    // The synchronous tree above remains the first paint and the fallback.
    if (serialized === undefined && projection.elements.length > 0) {
      void (async () => {
        try {
          const elkLayout = await autoLayoutWithElk(source, projection);
          if (get().path !== path) return; // user switched files meanwhile
          persistLayout(path, elkLayout);
          if (get().path === path && get().layout?.sourceHash === projection.sourceHash) {
            set({ layout: elkLayout });
          }
        } catch {
          // tree fallback already in place
        }
      })();
    }
  },
  refresh: (source) => {
    const path = get().path;
    if (!path) return;
    const projection = projectSysML(source);
    const hasErrors = projection.diagnostics.some((d) => d.severity === 'error');
    if (hasErrors && get().projection !== null) {
      // Broken source never clobbers the last valid semantic snapshot
      // (workbench-architecture-plan.md §8 S1); only the raw text updates.
      set({ source, parseDirty: true });
      return;
    }
    const previous = get().layout;
    const fallback = loadLayout(path, projection);
    const positions = { ...fallback.positions };
    for (const element of projection.elements) {
      const old = previous?.positions[element.id];
      if (old) positions[element.id] = old;
    }
    const layout: SysMLLayout = { version: 1, sourceHash: projection.sourceHash, positions };
    persistLayout(path, layout);
    set({
      source,
      projection,
      layout,
      selectedId: null,
      layoutDirty: false,
      parseDirty: false,
      execution: null,
      runError: null,
      past: [],
      future: [],
    });
  },
  select: (id) => set({ selectedId: id }),
  runTarget: (targetId) => {
    const state = get();
    if (!state.projection) return;
    const result = runExecutionTarget(state.source, state.projection, targetId);
    if (!result.ok || !result.steps) {
      set({ runError: result.error ?? 'execution failed', execution: null });
      return;
    }
    set({
      execution: {
        targetId,
        sourceHash: state.projection.sourceHash,
        steps: result.steps,
        result: result.result ?? null,
      },
      runError: null,
    });
  },
  clearExecution: () => set({ execution: null, runError: null }),
  applyElkLayout: async () => {
    const state = get();
    if (!state.projection || !state.path) return;
    state.checkpoint();
    try {
      const layout = await autoLayoutWithElk(state.source, state.projection);
      // The user may have switched files while ELK was computing.
      if (get().path !== state.path) return;
      persistLayout(state.path, layout);
      set({ layout, layoutDirty: true });
    } catch (error) {
      console.error('[sysml] ELK layout failed', error);
    }
  },
  setViewMode: (mode) => set({ viewMode: mode, selectedId: null }),
  checkpoint: () => {
    const state = get();
    if (!state.layout) return;
    set({ past: [...state.past, state.layout].slice(-80), future: [] });
  },
  move: (id, position) => {
    const state = get();
    if (!state.path || !state.layout) return;
    const layout: SysMLLayout = {
      ...state.layout,
      positions: { ...state.layout.positions, [id]: position },
    };
    persistLayout(state.path, layout);
    set({ layout, layoutDirty: true });
  },
  autoLayout: () => {
    const state = get();
    if (!state.path || !state.projection) return;
    if (state.layout) set({ past: [...state.past, state.layout].slice(-80), future: [] });
    const layout = autoLayoutSysML(state.projection, state.viewMode);
    persistLayout(state.path, layout);
    set({ layout, selectedId: null, layoutDirty: true });
  },
  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous || !state.layout || !state.path) return;
    const past = state.past.slice(0, -1);
    persistLayout(state.path, previous);
    set({ layout: previous, past, future: [state.layout, ...state.future].slice(0, 80), layoutDirty: true });
  },
  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next || !state.layout || !state.path) return;
    persistLayout(state.path, next);
    set({ layout: next, past: [...state.past, state.layout].slice(-80), future: state.future.slice(1), layoutDirty: true });
  },
  markLayoutPersisted: () => set({ layoutDirty: false }),
  clear: () =>
    set({ path: null, source: '', projection: null, layout: null, selectedId: null, viewMode: 'all', layoutDirty: false, parseDirty: false, execution: null, runError: null, past: [], future: [] }),
}));

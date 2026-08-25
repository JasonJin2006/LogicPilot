// SysML projection state. The external .sysml source remains authoritative;
// this store owns the visual projection, selection and layout sidecar only.

import { create } from 'zustand';
import {
  autoLayoutSysML,
  type SysMLLayout,
  type SysMLProjection,
  type SysMLPosition,
} from '../sysml/sysmlProjection';
import {
  extractExecutionTargets,
  runExecutionTarget,
  SYSML_EXECUTION_CONFORMANCE_VERSION,
  type TraceStep,
} from '../sysml/sysmlExecution';
import {
  appendEvidence,
  makeEvidenceId,
  parseEvidence,
  serializeEvidence,
  type SysMLEvidenceRecord,
} from '../sysml/sysmlEvidence';
import { autoLayoutChunkedWithElk, autoLayoutWithElk } from '../sysml/sysmlAutoLayoutElk';
import { buildLinkedSysMLModel, type SysMLFileUnit } from '../sysml/sysmlLinkedModel';

export type SysMLViewMode =
  | 'all'
  | 'structure'
  | 'requirements'
  | 'behavior'
  | 'traceability'
  | 'definitions'
  | 'usages'
  | 'tables'
  | 'sequence'
  | 'parametric'
  | 'usecase'
  | 'occurrence';

/** Layout backends only know the five geometric modes; the declaration and
 *  table views position everything (visibility filters canvas-side). */
export function layoutModeOf(
  mode: SysMLViewMode,
): 'all' | 'structure' | 'requirements' | 'behavior' | 'traceability' {
  return mode === 'definitions' ||
    mode === 'usages' ||
    mode === 'tables' ||
    mode === 'sequence' ||
    mode === 'parametric' ||
    mode === 'usecase' ||
    mode === 'occurrence'
    ? 'all'
    : mode;
}

const LAYOUT_PREFIX = 'logicpilot.sysml.layout.';
const EVIDENCE_PREFIX = 'logicpilot.sysml.evidence.';

function layoutKey(path: string): string {
  return `${LAYOUT_PREFIX}${path}`;
}

function evidenceKey(path: string): string {
  return `${EVIDENCE_PREFIX}${path}`;
}

function loadEvidence(path: string): SysMLEvidenceRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseEvidence(window.localStorage.getItem(evidenceKey(path)));
  } catch {
    return [];
  }
}

function persistEvidence(path: string, records: readonly SysMLEvidenceRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(evidenceKey(path), serializeEvidence(records));
  } catch {
    // A read-only/private storage backend should not disable visualization.
  }
}

function loadLayout(path: string, projection: SysMLProjection, serialized?: string): SysMLLayout {
  const fallback = autoLayoutSysML(projection);
  const serializedLayout = serialized ?? undefined;
  try {
    const raw =
      serializedLayout ??
      (typeof window !== 'undefined' ? window.localStorage.getItem(layoutKey(path)) : null);
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
  /** Linked multi-file state (plan §8 S1): every file in the import closure
   *  of the open document, its per-file projection (execution authority) and
   *  the elementId -> file map for the merged visualization projection. */
  units: SysMLFileUnit[];
  origins: Record<string, string>;
  linkedSources: Record<string, string>;
  /** Execution trace bound to one revision (plan §8 S2); cleared whenever a
   *  new revision arrives so stale results are never shown as current. */
  execution: {
    targetId: string;
    sourceHash: string;
    steps: TraceStep[];
    result: number | null;
  } | null;
  runError: string | null;
  /** Bounded recent-runs journal (plan §8 S2): every Run appends an immutable
   *  evidence record bound to the exact revision it executed. Deliberately
   *  NOT cleared by refresh - old-revision evidence stays queryable. */
  evidence: SysMLEvidenceRecord[];
  runTarget: (targetId: string) => void;
  clearExecution: () => void;
  /** ELK-layered layout (worker, async). Checkpoints like a manual edit so
   *  undo returns to the previous arrangement. */
  applyElkLayout: () => Promise<void>;
  past: SysMLLayout[];
  future: SysMLLayout[];
  load: (
    path: string,
    source: string,
    serialized?: string,
    evidence?: SysMLEvidenceRecord[],
  ) => void;
  /** Open a document with full knowledge of its sibling .sysml sources; the
   *  store derives the import closure and (when it spans several files) swaps
   *  `projection` to the merged linked model. Same-path calls behave as
   *  refresh. */
  openDocument: (
    path: string,
    source: string,
    workspaceSources: Record<string, string>,
    serialized?: string,
    evidence?: SysMLEvidenceRecord[],
  ) => void;
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

/** Commit a rebuilt linked model for the ALREADY-OPEN document. Preserves
 *  the legacy single-file refresh contract exactly: an error-level parse of
 *  the active file only updates the raw text (projection/layout/selection
 *  keep the last valid snapshot); a clean or foreign-file change rebuilds
 *  and carries element positions over by id. */
function commitLinkedRefresh(
  set: (partial: Partial<SysMLState>) => void,
  get: () => SysMLState,
  path: string,
  source: string,
  linkedSources: Record<string, string>,
  model: ReturnType<typeof buildLinkedSysMLModel>,
  projection: SysMLProjection,
): void {
  const state = get();
  const previousActive = state.units.find((unit) => unit.path === path);
  const activeUnit = model.units.find((unit) => unit.path === path);
  const activeBroke =
    activeUnit?.dirty === true && (previousActive === undefined || !previousActive.dirty);
  if (activeBroke && state.projection !== null) {
    // Broken source never clobbers the last valid semantic snapshot
    // (workbench-architecture-plan.md §8 S1); only the raw text updates.
    set({ source, parseDirty: true, units: model.units, origins: model.origins });
    return;
  }
  const previous = state.layout;
  const fallback = loadLayout(path, projection);
  const positions = { ...fallback.positions };
  for (const element of projection.elements) {
    const old = previous?.positions[element.id];
    if (old) positions[element.id] = old;
  }
  const layout: SysMLLayout = { version: 1, sourceHash: projection.sourceHash, positions };
  persistLayout(path, layout);
  // `evidence` is intentionally absent: the journal keeps records from
  // older revisions - that binding is its whole point.
  set({
    path,
    source,
    projection,
    layout,
    selectedId: null,
    layoutDirty: false,
    parseDirty: model.units.some((unit) => unit.dirty),
    execution: null,
    runError: null,
    past: [],
    future: [],
    units: model.units,
    origins: model.origins,
    linkedSources,
  });
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
  units: [],
  origins: {},
  linkedSources: {},
  execution: null,
  runError: null,
  evidence: [],
  past: [],
  future: [],
  load: (path, source, serialized, evidenceRecords) => {
    // Opening a file has no previous snapshot to protect: take what parsed.
    // Single-document entry point: no sibling sources are considered, so the
    // linked model degenerates to exactly the legacy per-file projection.
    const model = buildLinkedSysMLModel(path, { [path]: source });
    const projection = model.units[0]!.projection;
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
      // A project bundle's evidence sidecar wins; localStorage keeps the
      // journal alive for external .sysml files.
      evidence:
        evidenceRecords !== undefined && evidenceRecords.length > 0
          ? evidenceRecords
          : loadEvidence(path),
      past: [],
      future: [],
      units: model.units,
      origins: model.origins,
      linkedSources: { [path]: source },
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
  openDocument: (path, source, workspaceSources, serialized, evidenceRecords) => {
    const state = get();
    const linkedSources = collectSysmlEntries(workspaceSources);
    linkedSources[path] = source;
    const sameDocument =
      state.path === path && state.source === source && state.projection !== null;
    const sameSiblings =
      Object.keys(linkedSources).length === Object.keys(state.linkedSources).length &&
      Object.entries(state.linkedSources).every(([key, value]) => linkedSources[key] === value);
    if (sameDocument && sameSiblings) return;

    const previousUnits = new Map(state.units.map((unit) => [unit.path, unit]));
    const model = buildLinkedSysMLModel(path, linkedSources, previousUnits);
    const linked = model.units.length > 1;
    const projection = linked ? model.projection : model.units[0]!.projection;

    if (sameDocument) {
      commitLinkedRefresh(set, get, path, source, linkedSources, model, projection);
      return;
    }

    // Fresh document - the legacy open flow over the (possibly merged)
    // projection. No snapshot to protect: take what parsed.
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
      evidence:
        evidenceRecords !== undefined && evidenceRecords.length > 0
          ? evidenceRecords
          : loadEvidence(path),
      past: [],
      future: [],
      units: model.units,
      origins: model.origins,
      linkedSources,
    });
    if (serialized === undefined && projection.elements.length > 0) {
      void (async () => {
        try {
          const elkLayout = await autoLayoutWithElk(source, projection);
          if (get().path !== path) return;
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
    const linkedSources = { ...get().linkedSources, [path]: source };
    const previousUnits = new Map(get().units.map((unit) => [unit.path, unit]));
    const model = buildLinkedSysMLModel(path, linkedSources, previousUnits);
    const projection = model.units.length > 1 ? model.projection : model.units[0]!.projection;
    commitLinkedRefresh(set, get, path, source, linkedSources, model, projection);
  },
  select: (id) => set({ selectedId: id }),
  runTarget: (targetId) => {
    const state = get();
    if (!state.projection || !state.path) return;
    // Execution stays per-file even in a linked workspace: spans index into
    // the OWNING unit's text, so pick the file that declares the target.
    const owner =
      state.units.find((unit) =>
        unit.projection.elements.some((element) => element.id === targetId),
      ) ?? state.units.find((unit) => unit.path === state.path);
    if (!owner) return;
    if (owner.dirty) {
      set({
        runError: 'source has parse errors: fix them before running',
        execution: null,
      });
      return;
    }
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const result = runExecutionTarget(owner.source, owner.projection, targetId);
    // Every run - success or failure - becomes an evidence record bound to
    // the exact revision it executed (plan §8 S2).
    const target = extractExecutionTargets(owner.source, owner.projection).find(
      (entry) => entry.id === targetId,
    );
    const record: SysMLEvidenceRecord = {
      id: makeEvidenceId(owner.projection.sourceHash, targetId, startedAt),
      targetId,
      targetQualifiedName: target?.qualifiedName ?? targetId,
      targetKind: target?.kind ?? 'unknown',
      revision: owner.projection.sourceHash,
      ok: result.ok,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      ...(result.steps ? { steps: result.steps } : {}),
      ...(result.result !== undefined ? { result: result.result } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      conformanceVersion: SYSML_EXECUTION_CONFORMANCE_VERSION,
    };
    const evidence = appendEvidence(state.evidence, record);
    persistEvidence(state.path, evidence);
    if (!result.ok || !result.steps) {
      set({ runError: result.error ?? 'execution failed', execution: null, evidence });
      return;
    }
    set({
      execution: {
        targetId,
        sourceHash: owner.projection.sourceHash,
        steps: result.steps,
        result: result.result ?? null,
      },
      runError: null,
      evidence,
    });
  },
  clearExecution: () => set({ execution: null, runError: null }),
  applyElkLayout: async () => {
    const state = get();
    if (!state.projection || !state.path) return;
    state.checkpoint();
    try {
      // The active view mode picks the diagram-kind reading direction;
      // large models go through the chunked pipeline.
      const layout =
        state.projection.elements.length > 250
          ? await autoLayoutChunkedWithElk(state.projection)
          : await autoLayoutWithElk(state.source, state.projection, layoutModeOf(state.viewMode));
      // The user may have switched files while ELK was computing.
      if (get().path !== state.path) return;
      persistLayout(state.path, layout);
      set({ layout, layoutDirty: true });
    } catch (error) {
      // eslint-disable-next-line no-console -- keep the fallback trail for the canvas re-render.
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
    const layout = autoLayoutSysML(state.projection, layoutModeOf(state.viewMode));
    persistLayout(state.path, layout);
    set({ layout, selectedId: null, layoutDirty: true });
  },
  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous || !state.layout || !state.path) return;
    const past = state.past.slice(0, -1);
    persistLayout(state.path, previous);
    set({
      layout: previous,
      past,
      future: [state.layout, ...state.future].slice(0, 80),
      layoutDirty: true,
    });
  },
  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next || !state.layout || !state.path) return;
    persistLayout(state.path, next);
    set({
      layout: next,
      past: [...state.past, state.layout].slice(-80),
      future: state.future.slice(1),
      layoutDirty: true,
    });
  },
  markLayoutPersisted: () => set({ layoutDirty: false }),
  clear: () =>
    set({
      path: null,
      source: '',
      projection: null,
      layout: null,
      selectedId: null,
      viewMode: 'all',
      layoutDirty: false,
      parseDirty: false,
      units: [],
      origins: {},
      linkedSources: {},
      execution: null,
      runError: null,
      evidence: [],
      past: [],
      future: [],
    }),
}));

function collectSysmlEntries(sources: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [path, content] of Object.entries(sources)) {
    if (/\.sysml$/i.test(path)) filtered[path] = content;
  }
  return filtered;
}

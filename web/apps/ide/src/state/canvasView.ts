// The center canvas's open views: the model root canvas plus every container
// Node subgraph the user drilled into. Both are center-workspace tabs
// (Model / Flow / Backup / ...), and like code tabs they only exist once
// opened: with nothing open the center area shows its empty state. Set from
// the Project tree, the root canvas (double-click), the palette Scenes drag
// and project open/new.

import { create } from 'zustand';
import type { ModelDocument } from '@logicpilot/editor';

export interface CanvasView {
  kind: string;
  name: string;
}

/** Filter a document to one container Node's subgraph (its children); null
 *  shows the model root: only model-level elements (nodes not owned by a
 *  container - resources, container Nodes, canvas annotations). Stages of a
 *  process container never leak onto the root canvas. */
export function documentForView(document: ModelDocument, view: CanvasView | null): ModelDocument {
  if (!view) {
    const nodes = document.nodes.filter((node) => !node.container);
    const ids = new Set(nodes.map((node) => node.id));
    return {
      name: document.name,
      nodes,
      edges: document.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    };
  }
  const nodes = document.nodes.filter((node) => node.container === view.name);
  const ids = new Set(nodes.map((node) => node.id));
  return {
    name: document.name,
    nodes,
    edges: document.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

interface CanvasViewState {
  /** Open container views, in open order (the model root is implicit). */
  views: CanvasView[];
  /** Whether the model root canvas is open. */
  rootOpen: boolean;
  /** Active view; null = the model root. */
  view: CanvasView | null;
  /** Open + activate a container view (or return to the root with null).
   *  Re-activating an already-open view keeps its open order. */
  setView: (view: CanvasView | null) => void;
  /** Drop a view (null = the root); the active one falls back to the last
   *  remaining open view, else the root, else nothing (empty center). */
  closeView: (view: CanvasView | null) => void;
  /** Close every container view (a different model is being loaded). */
  resetCanvasViews: () => void;
  /** The model canvas's current camera (synced by ModelCanvas) so the
   *  palette's pointer-based drop can map screen -> world coordinates. */
  viewport: { scale: number; panX: number; panY: number } | null;
  setViewport: (viewport: { scale: number; panX: number; panY: number }) => void;
}

function sameView(a: CanvasView | null, b: CanvasView | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.name === b.name;
}

/** Re-key the open views after one document revision transition. Views are
 *  keyed by {kind, name}, so a container rename must carry its tab along
 *  (undo carries it back) and a removed container must close its tab -
 *  otherwise a stale empty tab lingers under the old name. Name-keyed by
 *  necessity: stable ElementRef identity replaces this (plan §9.5). */
export function syncCanvasViewsWithDocument(
  next: ModelDocument,
  previous: ModelDocument,
): void {
  const state = useCanvasView.getState();
  const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
  const renames = new Map<string, string>();
  for (const node of next.nodes) {
    const before = previousById.get(node.id);
    if (before && before.kind === node.kind && before.name !== node.name) {
      renames.set(`${node.kind}\u0000${before.name}`, node.name);
    }
  }
  const exists = new Set(next.nodes.map((node) => `${node.kind}\u0000${node.name}`));
  const follow = (view: CanvasView): CanvasView => {
    const renamed = renames.get(`${view.kind}\u0000${view.name}`);
    return renamed === undefined ? view : { kind: view.kind, name: renamed };
  };
  const alive = (view: CanvasView) => exists.has(`${view.kind}\u0000${view.name}`);
  // A rename onto an already-open name collapses into that tab instead of
  // duplicating its key.
  const seen = new Set<string>();
  const views: CanvasView[] = [];
  for (const candidate of state.views.map(follow)) {
    if (!alive(candidate)) continue;
    const key = `${candidate.kind}\u0000${candidate.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push(candidate);
  }
  let view = state.view === null ? null : follow(state.view);
  if (view !== null && !alive(view)) {
    view = views.length > 0 ? views[views.length - 1]! : null;
  }
  const unchanged =
    views.length === state.views.length &&
    views.every((entry, index) => sameView(entry, state.views[index] ?? null)) &&
    sameView(view, state.view);
  if (unchanged) {
    return;
  }
  useCanvasView.setState({ views, view });
}

export const useCanvasView = create<CanvasViewState>((set) => ({
  views: [],
  rootOpen: false,
  view: null,
  setView: (view) =>
    set((state) => {
      if (view === null) {
        return state.rootOpen && state.view === null ? {} : { rootOpen: true, view: null };
      }
      if (sameView(state.view, view)) {
        return {};
      }
      const exists = state.views.some((entry) => sameView(entry, view));
      return { views: exists ? state.views : [...state.views, view], view };
    }),
  closeView: (view) =>
    set((state) => {
      if (view === null) {
        // Closing the root: the active view falls back to the most recently
        // opened container (or nothing) when the root was active.
        const fallback =
          state.view === null && state.views.length > 0
            ? state.views[state.views.length - 1]!
            : state.view;
        return { rootOpen: false, view: fallback };
      }
      const views = state.views.filter((entry) => !sameView(entry, view));
      if (!sameView(state.view, view)) {
        return { views };
      }
      const fallback = views.length > 0 ? views[views.length - 1]! : null;
      return { views, view: fallback };
    }),
  resetCanvasViews: () => set({ views: [], rootOpen: false, view: null }),
  viewport: null,
  setViewport: (viewport) => set({ viewport }),
}));

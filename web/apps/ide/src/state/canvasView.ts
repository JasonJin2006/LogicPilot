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
export function documentForView(
  document: ModelDocument,
  view: CanvasView | null,
): ModelDocument {
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
}

function sameView(a: CanvasView | null, b: CanvasView | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.name === b.name;
}

export const useCanvasView = create<CanvasViewState>((set) => ({
  views: [],
  rootOpen: false,
  view: null,
  setView: (view) =>
    set((state) => {
      if (view === null) {
        return state.rootOpen && state.view === null
          ? {}
          : { rootOpen: true, view: null };
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
      const fallback =
        views.length > 0 ? views[views.length - 1]! : null;
      return { views, view: fallback };
    }),
  resetCanvasViews: () => set({ views: [], rootOpen: false, view: null }),
}));

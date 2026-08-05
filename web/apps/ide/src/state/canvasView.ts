// The center canvas's open views: the model root (implicit, `view: null`)
// plus every container Node subgraph the user drilled into. Each open
// container becomes a center-workspace tab (Model / Flow / Backup / ...),
// so switching between container canvases never forces a trip back to the
// root. Set from the Project tree, the root canvas (double-click) and the
// palette Scenes drag.

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
  /** Active view; null = the model root. */
  view: CanvasView | null;
  /** Open + activate a container view (or return to the root with null).
   *  Re-activating an already-open view keeps its open order. */
  setView: (view: CanvasView | null) => void;
  /** Drop a container view; if it was active, fall back to the root. */
  closeView: (view: CanvasView) => void;
  /** Close every container view (a different model is being loaded). */
  resetCanvasViews: () => void;
}

function sameView(a: CanvasView | null, b: CanvasView | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.name === b.name;
}

export const useCanvasView = create<CanvasViewState>((set) => ({
  views: [],
  view: null,
  setView: (view) =>
    set((state) => {
      if (view === null) {
        return state.view === null ? {} : { view: null };
      }
      if (sameView(state.view, view)) {
        return {};
      }
      const exists = state.views.some((entry) => sameView(entry, view));
      return { views: exists ? state.views : [...state.views, view], view };
    }),
  closeView: (view) =>
    set((state) => {
      const views = state.views.filter((entry) => !sameView(entry, view));
      const active = sameView(state.view, view) ? null : state.view;
      return { views, view: active };
    }),
  resetCanvasViews: () => set({ views: [], view: null }),
}));

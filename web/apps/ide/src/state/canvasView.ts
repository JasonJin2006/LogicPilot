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
  /** The container node's stable id; membership filtering follows this and
   *  survives renames. Views opened before it existed match by name. */
  containerId?: string;
}

/** Filter a document to one container Node's subgraph (its children); null
 *  shows the model root: only model-level elements (nodes not owned by a
 *  container - resources, container Nodes, canvas annotations). Stages of a
 *  process container never leak onto the root canvas. */
export function documentForView(document: ModelDocument, view: CanvasView | null): ModelDocument {
  const inContainer = (node: ModelDocument['nodes'][number]): boolean =>
    view === null
      ? node.containerId === undefined && !node.container
      : view.containerId !== undefined
        ? node.containerId === view.containerId
        : !node.containerId && node.container === view.name;
  const nodes = document.nodes.filter(inContainer);
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
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.name === b.name && a.containerId === b.containerId;
}

/** Re-resolve the open views across one document revision transition.
 *  Id-keyed views keep their container across renames (only the label
 *  refreshes); legacy name-only views adopt the container's id when found,
 *  follow it through a rename via the previous revision, and close when the
 *  container is gone - so no stale empty tab lingers under an old name. */
export function syncCanvasViewsWithDocument(next: ModelDocument, previous?: ModelDocument): void {
  const state = useCanvasView.getState();
  const keyOf = (entry: CanvasView): string =>
    entry.containerId ?? `${entry.kind}\u0000${entry.name}`;
  const resolve = (entry: CanvasView): CanvasView | null => {
    if (entry.containerId !== undefined) {
      const byId = next.nodes.find((candidate) => candidate.id === entry.containerId);
      if (byId) {
        return { kind: byId.kind, name: byId.name, containerId: byId.id };
      }
    }
    const byName = next.nodes.find(
      (candidate) => candidate.kind === entry.kind && candidate.name === entry.name,
    );
    if (byName) {
      return { kind: byName.kind, name: byName.name, containerId: byName.id };
    }
    // Renamed (or re-parsed with fresh ids) while this view pointed at the
    // previous revision: follow the same node through `previous` - first by
    // its old id's name, then by the raw name match.
    const before =
      (entry.containerId !== undefined
        ? previous?.nodes.find((candidate) => candidate.id === entry.containerId)
        : undefined) ??
      previous?.nodes.find(
        (candidate) => candidate.kind === entry.kind && candidate.name === entry.name,
      );
    if (before !== undefined) {
      const after = next.nodes.find(
        (candidate) =>
          candidate.id === before.id ||
          (candidate.kind === before.kind && candidate.name === before.name),
      );
      if (after) {
        return { kind: after.kind, name: after.name, containerId: after.id };
      }
    }
    return null;
  };
  const seen = new Set<string>();
  const views: CanvasView[] = [];
  let collapsed = false;
  for (const entry of state.views) {
    const resolved = resolve(entry);
    if (resolved === null) {
      collapsed = true;
      continue;
    }
    const key = keyOf(resolved);
    if (seen.has(key)) {
      collapsed = true; // e.g. a rename landed on an already-open view
      continue;
    }
    seen.add(key);
    views.push(resolved);
  }
  let view: CanvasView | null = null;
  if (state.view !== null) {
    const activeKey = keyOf(resolve(state.view) ?? state.view);
    view =
      views.find((entry) => keyOf(entry) === activeKey) ??
      (views.length > 0 ? views[views.length - 1]! : null);
  }
  const unchanged =
    !collapsed &&
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

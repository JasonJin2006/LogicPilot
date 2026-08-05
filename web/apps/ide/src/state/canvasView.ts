// The center canvas's focus: which container Node's subgraph it is currently
// showing. null = the model root (the whole document). Set from the Project
// tree when a container element (process Flow, agent Drone, ...) is opened.

import { create } from 'zustand';
import type { ModelDocument } from '@logicpilot/editor';

export interface CanvasView {
  kind: string;
  name: string;
}

/** Filter a document to one container Node's subgraph; null shows it whole. */
export function documentForView(
  document: ModelDocument,
  view: CanvasView | null,
): ModelDocument {
  if (!view) {
    return document;
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
  view: CanvasView | null;
  setView: (view: CanvasView | null) => void;
}

export const useCanvasView = create<CanvasViewState>((set) => ({
  view: null,
  setView: (view) => set({ view }),
}));

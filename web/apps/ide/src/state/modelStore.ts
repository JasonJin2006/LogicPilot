// Modeling store (P1-6): the editor's ModelDocument plus selection state.
// Operations delegate to the pure @logicpilot/editor graph functions, so
// undo/redo and diagnostics can layer on top without touching shared state.

import { create } from 'zustand';
import {
  addNode,
  connect,
  createDocument,
  disconnect,
  moveNode,
  renameNode,
  setParam,
  type AddNodeInput,
  type ModelDocument,
} from '@logicpilot/editor';

interface ModelState {
  document: ModelDocument;
  selectedId: string | null;
  addBlock: (input: AddNodeInput) => void;
  moveBlock: (id: string, x: number, y: number) => void;
  connectBlocks: (from: string, to: string) => void;
  disconnectEdge: (id: string) => void;
  select: (id: string | null) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockParam: (id: string, key: string, value: string | number | boolean) => void;
  reset: () => void;
}

export const useModelStore = create<ModelState>((set) => ({
  document: createDocument('Model'),
  selectedId: null,
  addBlock: (input) => set((state) => ({ document: addNode(state.document, input) })),
  moveBlock: (id, x, y) =>
    set((state) => ({ document: moveNode(state.document, id, x, y) })),
  connectBlocks: (from, to) =>
    set((state) => {
      const result = connect(state.document, from, to);
      return result.error ? {} : { document: result.document };
    }),
  disconnectEdge: (id) =>
    set((state) => ({ document: disconnect(state.document, id) })),
  select: (id) => set({ selectedId: id }),
  renameBlock: (id, name) => set((state) => ({ document: renameNode(state.document, id, name) })),
  setBlockParam: (id, key, value) =>
    set((state) => ({
      document: setParam(state.document, id, key, value),
    })),
  reset: () => set({ document: createDocument('Model'), selectedId: null }),
}));

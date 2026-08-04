// Modeling store (P1-6): the editor's ModelDocument plus selection state.
// Operations delegate to the pure @logicpilot/editor graph functions, so
// undo/redo and diagnostics can layer on top without touching shared state.

import { create } from 'zustand';
import {
  addNode,
  createDocument,
  renameNode,
  setParam,
  type AddNodeInput,
  type ModelDocument,
} from '@logicpilot/editor';

interface ModelState {
  document: ModelDocument;
  selectedId: string | null;
  addBlock: (input: AddNodeInput) => void;
  select: (id: string | null) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockParam: (id: string, key: string, value: string | number | boolean) => void;
  reset: () => void;
}

export const useModelStore = create<ModelState>((set) => ({
  document: createDocument('Model'),
  selectedId: null,
  addBlock: (input) => set((state) => ({ document: addNode(state.document, input) })),
  select: (id) => set({ selectedId: id }),
  renameBlock: (id, name) => set((state) => ({ document: renameNode(state.document, id, name) })),
  setBlockParam: (id, key, value) =>
    set((state) => ({
      document: setParam(state.document, id, key, value),
    })),
  reset: () => set({ document: createDocument('Model'), selectedId: null }),
}));

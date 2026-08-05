// Modeling store (P1-6): the editor's ModelDocument plus selection state.
// Operations delegate to the pure @logicpilot/editor graph functions, so
// undo/redo and diagnostics can layer on top without touching shared state.
// The document auto-persists to localStorage; the undo history does not.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  addNode,
  connect,
  createDocument,
  disconnect,
  moveNode,
  removeNode,
  renameNode,
  setParam,
  type AddNodeInput,
  type ModelDocument,
} from '@logicpilot/editor';

const MAX_HISTORY = 100;
// Rapid successive edits (drag moves, typing) within this window collapse
// into a single undo step.
const COALESCE_MS = 600;

// Validate a hydrated document: must be an object with `nodes` and `edges`
// arrays. Older builds (or hand-edited localStorage) can leave a partial
// document behind whose `nodes` is undefined, which crashes the first render
// (modelDoc.nodes.find -> Cannot read properties of undefined) and turns the
// whole window into an unrecoverable black surface. Fall back to a fresh
// blank document on any shape mismatch.
function sanitizeDocument(value: unknown): ModelDocument {
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as ModelDocument).nodes) &&
    Array.isArray((value as ModelDocument).edges) &&
    typeof (value as ModelDocument).name === 'string'
  ) {
    return value as ModelDocument;
  }
  return createDocument('Model');
}

// zustand persist `merge`: keep the in-memory actions, only trust persisted
// fields we recognize. The persisted document is validated; everything else
// (past/future/selectedId...) is never persisted anyway and stays at defaults.
function mergePersistedState(
  persisted: unknown,
  current: ModelState,
): ModelState {
  const stored = (persisted ?? {}) as Partial<ModelState>;
  return {
    ...current,
    ...stored,
    document: sanitizeDocument(stored.document),
    // Never trust persisted history/selection: it can reference node ids that
    // no longer exist after sanitize, which would break undo/redo invariants.
    past: [],
    future: [],
    selectedId: null,
    canUndo: false,
    canRedo: false,
    lastCommitAt: 0,
  };
}

interface ModelState {
  document: ModelDocument;
  selectedId: string | null;
  past: ModelDocument[];
  future: ModelDocument[];
  canUndo: boolean;
  canRedo: boolean;
  lastCommitAt: number;
  addBlock: (input: AddNodeInput) => void;
  moveBlock: (id: string, x: number, y: number) => void;
  connectBlocks: (from: string, to: string) => void;
  disconnectEdge: (id: string) => void;
  removeBlock: (id: string) => void;
  select: (id: string | null) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockParam: (id: string, key: string, value: string | number | boolean) => void;
  loadDocument: (document: ModelDocument) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

function commit(state: ModelState, next: ModelDocument): Partial<ModelState> {
  const now = Date.now();
  const coalesced = now - state.lastCommitAt < COALESCE_MS;
  return {
    document: next,
    past: coalesced ? state.past : [...state.past, state.document].slice(-MAX_HISTORY),
    future: [],
    lastCommitAt: now,
    canUndo: coalesced ? state.past.length > 0 : true,
    canRedo: false,
  };
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      document: createDocument('Model'),
      selectedId: null,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      lastCommitAt: 0,
      addBlock: (input) => set((state) => commit(state, addNode(state.document, input))),
      moveBlock: (id, x, y) =>
        set((state) => commit(state, moveNode(state.document, id, x, y))),
      connectBlocks: (from, to) =>
        set((state) => {
          const result = connect(state.document, from, to);
          return result.error ? {} : commit(state, result.document);
        }),
      disconnectEdge: (id) =>
        set((state) => commit(state, disconnect(state.document, id))),
      removeBlock: (id) =>
        set((state) => ({
          ...commit(state, removeNode(state.document, id)),
          selectedId: state.selectedId === id ? null : state.selectedId,
        })),
      select: (id) => set({ selectedId: id }),
      renameBlock: (id, name) =>
        set((state) => commit(state, renameNode(state.document, id, name))),
      setBlockParam: (id, key, value) =>
        set((state) => commit(state, setParam(state.document, id, key, value))),
      loadDocument: (document) =>
        set((state) => commit(state, sanitizeDocument(document))),
      undo: () =>
        set((state) => {
          if (state.past.length === 0) return {};
          const previous = state.past[state.past.length - 1]!;
          return {
            document: previous,
            past: state.past.slice(0, -1),
            future: [state.document, ...state.future],
            selectedId: null,
            canUndo: state.past.length > 1,
            canRedo: true,
            lastCommitAt: 0, // the next edit always starts a fresh entry
          };
        }),
      redo: () =>
        set((state) => {
          if (state.future.length === 0) return {};
          const next = state.future[0]!;
          return {
            document: next,
            past: [...state.past, state.document].slice(-MAX_HISTORY),
            future: state.future.slice(1),
            selectedId: null,
            canUndo: true,
            canRedo: state.future.length > 1,
            lastCommitAt: 0,
          };
        }),
      reset: () =>
        set({
          document: createDocument('Model'),
          selectedId: null,
          past: [],
          future: [],
          canUndo: false,
          canRedo: false,
          lastCommitAt: 0,
        }),
    }),
    {
      name: 'logicpilot.model',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ document: state.document }),
      merge: mergePersistedState,
    },
  ),
);

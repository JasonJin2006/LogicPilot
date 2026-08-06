// Modeling store (P1-6): the editor's ModelDocument plus selection state.
// Operations delegate to the pure @logicpilot/editor graph functions, so
// undo/redo and diagnostics can layer on top without touching shared state.
// The document is session-only: every launch starts from a fresh blank model
// and previous projects are reopened via Open / Open Recent.

import { create } from 'zustand';
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
  type PresentationObject,
} from '@logicpilot/editor';
import { blockPorts } from '../model/blockDefs';

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
  connectBlocks: (from: string, to: string, fromPort?: string, toPort?: string) => void;
  disconnectEdge: (id: string) => void;
  removeBlock: (id: string) => void;
  select: (id: string | null) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockParam: (id: string, key: string, value: string | number | boolean) => void;
  /** Replace a node's vector presentation object (undoable). Keeps the
   *  node's x/y in sync with the object's transform. */
  setPresentation: (id: string, object: PresentationObject) => void;
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

export const useModelStore = create<ModelState>()((set) => ({
  document: createDocument('Model'),
  selectedId: null,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  lastCommitAt: 0,
  addBlock: (input) => set((state) => commit(state, addNode(state.document, input))),
  moveBlock: (id, x, y) =>
    set((state) => {
      const document = moveNode(state.document, id, x, y);
      const node = document.nodes.find((entry) => entry.id === id);
      if (!node?.presentation) {
        return commit(state, document);
      }
      const next: ModelDocument = {
        ...document,
        nodes: document.nodes.map((entry) =>
          entry.id === id && entry.presentation
            ? {
                ...entry,
                presentation: {
                  ...entry.presentation,
                  transform: { ...entry.presentation.transform, x, y },
                },
              }
            : entry,
        ),
      };
      return commit(state, next);
    }),
  connectBlocks: (from, to, fromPort, toPort) =>
    set((state) => {
      const fromNode = state.document.nodes.find((node) => node.id === from);
      const toNode = state.document.nodes.find((node) => node.id === to);
      const fromSpec = fromNode
        ? blockPorts(fromNode.kind).find(
            (port) => port.name === (fromPort ?? 'out') && port.direction !== 'in',
          )
        : undefined;
      const toSpec = toNode
        ? blockPorts(toNode.kind).find(
            (port) => port.name === (toPort ?? 'in') && port.direction !== 'out',
          )
        : undefined;
      if (!fromSpec || !toSpec) {
        return {};
      }
      const result = connect(state.document, from, to, fromPort, toPort);
      if (result.error) {
        return {};
      }
      // Wiring a conditional port turns on its gating option (AnyLogic
      // semantics: the port exists only while the option is enabled), so the
      // generated DSL compiles without an LP5003.
      let document = result.document;
      const enableGates = (
        nodeId: string,
        spec: ReturnType<typeof blockPorts>[number] | undefined,
        port: string | undefined,
      ) => {
        if (!spec?.conditionalOn || !port) {
          return;
        }
        const node = document.nodes.find((entry) => entry.id === nodeId);
        if (node && node.params[spec.conditionalOn] !== true) {
          document = setParam(document, nodeId, spec.conditionalOn, true);
        }
      };
      enableGates(from, fromSpec, fromPort ?? 'out');
      enableGates(to, toSpec, toPort ?? 'in');
      return commit(state, document);
    }),
  disconnectEdge: (id) => set((state) => commit(state, disconnect(state.document, id))),
  removeBlock: (id) =>
    set((state) => ({
      ...commit(state, removeNode(state.document, id)),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  select: (id) => set({ selectedId: id }),
  renameBlock: (id, name) => set((state) => commit(state, renameNode(state.document, id, name))),
  setBlockParam: (id, key, value) =>
    set((state) => commit(state, setParam(state.document, id, key, value))),
  setPresentation: (id, object) =>
    set((state) => {
      let found = false;
      const document: ModelDocument = {
        ...state.document,
        nodes: state.document.nodes.map((node) => {
          if (node.id !== id) {
            return node;
          }
          found = true;
          return {
            ...node,
            presentation: object,
            x: object.transform.x,
            y: object.transform.y,
          };
        }),
      };
      return found ? commit(state, document) : {};
    }),
  loadDocument: (document) => set((state) => commit(state, sanitizeDocument(document))),
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
}));

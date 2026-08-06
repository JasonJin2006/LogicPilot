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
  freshId,
  moveNode,
  removeNode,
  renameNode,
  setParam,
  type AddNodeInput,
  type ModelDocument,
  type ModelNode,
  type PresentationObject,
  defaultPresentationStyle,
} from '@logicpilot/editor';
import { blockPorts } from '../model/blockDefs';

const MAX_HISTORY = 100;
// Rapid successive edits (drag moves, typing) within this window collapse
// into a single undo step.
const COALESCE_MS = 600;

/** Presentation object type -> canvas node kind (the palette names ovals
 *  'oval' while the scene-graph type is 'ellipse'). */
const PRESENTATION_KIND_BY_TYPE: Record<string, string> = { ellipse: 'oval' };

/** Alignment axis for the multi-selected presentation shapes. */
export type AlignAxis = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
/** Distribution axis: equal spacing along the union span. */
export type DistributeAxis = 'horizontal' | 'vertical';

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
  /** Merge presentation nodes into one `group` node (undoable). Returns the
   *  new node's id, or null when fewer than two nodes were given. */
  groupShapes: (ids: string[]) => string | null;
  /** Expand a `group` node back into its children (undoable). Returns the
   *  first child id (for selection), or null. */
  ungroupShape: (id: string) => string | null;
  /** Align ≥2 presentation shapes along an axis (undoable). */
  alignShapes: (ids: string[], axis: AlignAxis) => void;
  /** Evenly space ≥3 shapes along the union span (undoable). */
  distributeShapes: (ids: string[], axis: DistributeAxis) => void;
  /** Move a node to the end of the render order (on top). */
  bringToFront: (id: string) => void;
  /** Move a node to the start of the render order (behind everything). */
  sendToBack: (id: string) => void;
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
  groupShapes: (ids) => {
    const state = useModelStore.getState();
    const members = ids
      .map((id) => state.document.nodes.find((node) => node.id === id && node.presentation))
      .filter((node): node is ModelNode & { presentation: PresentationObject } => !!node);
    if (members.length < 2) {
      return null;
    }
    const minX = Math.min(...members.map((m) => m.presentation.transform.x));
    const minY = Math.min(...members.map((m) => m.presentation.transform.y));
    const maxX = Math.max(
      ...members.map((m) => m.presentation.transform.x + m.presentation.transform.width),
    );
    const maxY = Math.max(
      ...members.map((m) => m.presentation.transform.y + m.presentation.transform.height),
    );
    const children = members.map((m) => ({
      ...m.presentation,
      transform: {
        ...m.presentation.transform,
        x: m.presentation.transform.x - minX,
        y: m.presentation.transform.y - minY,
      },
    }));
    const groupId = freshId('group');
    const groupNode: ModelNode = {
      id: groupId,
      kind: 'group',
      name: 'group',
      x: minX,
      y: minY,
      params: {},
      library: 'presentation',
      presentation: {
        type: 'group',
        transform: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        },
        style: defaultPresentationStyle(),
        children,
      },
    };
    const memberIds = new Set(members.map((m) => m.id));
    const document: ModelDocument = {
      ...state.document,
      nodes: [...state.document.nodes.filter((n) => !memberIds.has(n.id)), groupNode],
    };
    set({ ...commit(state, document), selectedId: groupId });
    return groupId;
  },
  ungroupShape: (id) => {
    const state = useModelStore.getState();
    const group = state.document.nodes.find(
      (node) => node.id === id && node.presentation?.type === 'group',
    );
    const children = group?.presentation?.children;
    if (!group?.presentation || !children || children.length === 0) {
      return null;
    }
    const g = group.presentation.transform;
    const newNodes: ModelNode[] = children.map((child) => {
      const kind = PRESENTATION_KIND_BY_TYPE[child.type] ?? child.type;
      return {
        id: freshId(kind),
        kind,
        name: kind,
        x: g.x + child.transform.x,
        y: g.y + child.transform.y,
        params: {},
        library: 'presentation',
        presentation: {
          ...child,
          transform: {
            ...child.transform,
            x: g.x + child.transform.x,
            y: g.y + child.transform.y,
          },
        },
      };
    });
    const document: ModelDocument = {
      ...state.document,
      nodes: [...state.document.nodes.filter((n) => n.id !== id), ...newNodes],
    };
    set({ ...commit(state, document), selectedId: newNodes[0]?.id ?? null });
    return newNodes[0]?.id ?? null;
  },
  alignShapes: (ids, axis) => {
    const state = useModelStore.getState();
    const targets = ids
      .map((id) => state.document.nodes.find((node) => node.id === id && node.presentation))
      .filter((node): node is ModelNode & { presentation: PresentationObject } => !!node);
    if (targets.length < 2) {
      return;
    }
    const minX = Math.min(...targets.map((m) => m.presentation.transform.x));
    const maxX = Math.max(
      ...targets.map((m) => m.presentation.transform.x + m.presentation.transform.width),
    );
    const minY = Math.min(...targets.map((m) => m.presentation.transform.y));
    const maxY = Math.max(
      ...targets.map((m) => m.presentation.transform.y + m.presentation.transform.height),
    );
    const nodes = state.document.nodes.map((node) => {
      const target = targets.find((entry) => entry.id === node.id);
      if (!target) {
        return node;
      }
      const tr = target.presentation.transform;
      let x = tr.x;
      let y = tr.y;
      if (axis === 'left') x = minX;
      else if (axis === 'centerX') x = (minX + maxX) / 2 - tr.width / 2;
      else if (axis === 'right') x = maxX - tr.width;
      else if (axis === 'top') y = minY;
      else if (axis === 'centerY') y = (minY + maxY) / 2 - tr.height / 2;
      else if (axis === 'bottom') y = maxY - tr.height;
      return {
        ...node,
        x,
        y,
        presentation: { ...target.presentation, transform: { ...tr, x, y } },
      };
    });
    set({ ...commit(state, { ...state.document, nodes }) });
  },
  distributeShapes: (ids, axis) => {
    const state = useModelStore.getState();
    const targets = ids
      .map((id) => state.document.nodes.find((node) => node.id === id && node.presentation))
      .filter((node): node is ModelNode & { presentation: PresentationObject } => !!node);
    if (targets.length < 3) {
      return;
    }
    const key = axis === 'horizontal' ? 'x' : 'y';
    const sorted = [...targets].sort(
      (a, b) => a.presentation.transform[key] - b.presentation.transform[key],
    );
    const min = sorted[0]!.presentation.transform[key];
    const max = sorted[sorted.length - 1]!.presentation.transform[key];
    const step = (max - min) / (sorted.length - 1);
    const positions = new Map(sorted.map((target, index) => [target.id, min + index * step]));
    const nodes = state.document.nodes.map((node) => {
      const position = positions.get(node.id);
      if (position === undefined || !node.presentation) {
        return node;
      }
      const tr = node.presentation.transform;
      const next = axis === 'horizontal' ? { x: position, y: tr.y } : { x: tr.x, y: position };
      return {
        ...node,
        x: next.x,
        y: next.y,
        presentation: { ...node.presentation, transform: { ...tr, ...next } },
      };
    });
    set({ ...commit(state, { ...state.document, nodes }) });
  },
  bringToFront: (id) => {
    const state = useModelStore.getState();
    const node = state.document.nodes.find((entry) => entry.id === id);
    if (!node) {
      return;
    }
    const nodes = [...state.document.nodes.filter((entry) => entry.id !== id), node];
    set({ ...commit(state, { ...state.document, nodes }) });
  },
  sendToBack: (id) => {
    const state = useModelStore.getState();
    const node = state.document.nodes.find((entry) => entry.id === id);
    if (!node) {
      return;
    }
    const nodes = [node, ...state.document.nodes.filter((entry) => entry.id !== id)];
    set({ ...commit(state, { ...state.document, nodes }) });
  },
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

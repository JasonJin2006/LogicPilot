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
  removeParam,
  removeNode,
  renameNode,
  renameParam,
  setParam,
  booleanShapes,
  applyModelPatch,
  type BooleanOp,
  type AddNodeInput,
  defaultGraphicStyle,
  type GraphicNode,
  type ModelDocument,
  type ModelPatch,
  type ModelPatchResult,
  type ModelNode,
} from '@logicpilot/editor';
import { blockPorts } from '../model/blockDefs';
import { routeOrthogonal } from '../presentation/routing';

const MAX_HISTORY = 100;
// Rapid successive edits (drag moves, typing) within this window collapse
// into a single undo step.
const COALESCE_MS = 600;

/** GraphicNode -> canvas node kind for ungrouped children (the palette names
 *  shapes by their legacy kinds: rect / oval / polyline / curve). */
function presentationKindFor(child: GraphicNode): string {
  if (child.type === 'shape') {
    switch (child.geometry?.shapeType) {
      case 'rectangle':
        return 'rect';
      case 'ellipse':
        return 'oval';
      case 'polygon':
        return 'polygon';
      case 'polyline':
        return 'polyline';
      default:
        return 'line';
    }
  }
  if (child.type === 'path') {
    return 'curve';
  }
  return child.type; // text / image / group
}

/** Alignment axis for the multi-selected presentation shapes. */
export type AlignAxis = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
/** Distribution axis: equal spacing along the union span. */
export type DistributeAxis = 'horizontal' | 'vertical';

function refreshLinkedConnectors(document: ModelDocument): ModelDocument {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const connector = node.presentation?.connector;
      if (!connector || !node.presentation?.geometry) return node;
      const from = byId.get(connector.fromId)?.presentation;
      const to = byId.get(connector.toId)?.presentation;
      if (!from || !to) return node;
      const route = routeOrthogonal(from.transform, to.transform);
      return {
        ...node,
        x: route.transform.x,
        y: route.transform.y,
        presentation: {
          ...node.presentation,
          transform: route.transform,
          geometry: { ...node.presentation.geometry, points: route.points },
        },
      };
    }),
  };
}

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
  /** Remove a param (entity attribute editing). */
  removeBlockParam: (id: string, key: string) => void;
  /** Rename a param key, keeping its value (entity attribute editing). */
  renameBlockParam: (id: string, oldKey: string, newKey: string) => void;
  /** Replace a node's vector presentation object (undoable). Keeps the
   *  node's x/y in sync with the object's transform. */
  setPresentation: (id: string, object: GraphicNode) => void;
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
  /** Replace the z-order of the given presentation layers. The ids are in
   * visual top-to-bottom order, matching the Layers panel. */
  reorderPresentationLayers: (idsTopFirst: string[]) => void;
  /** Turn a presentation node into a reusable component master. */
  makeComponent: (id: string) => string | null;
  /** Create a linked instance of a component master. */
  createComponentInstance: (id: string) => string | null;
  /** Break a component instance link while preserving its current visuals. */
  detachComponentInstance: (id: string) => void;
  /** Create a linked, automatically routed connector between two shapes. */
  connectPresentationShapes: (ids: string[]) => string | null;
  /** Apply a boolean operation over presentation shapes, replacing them
   *  with a single path node (undoable). Returns the new node id. */
  applyBooleanShapes: (ids: string[], op: BooleanOp) => string | null;
  loadDocument: (document: ModelDocument) => void;
  /** Atomically apply one AI/editor ModelPatch as a single undo step. */
  applyPatch: (patch: ModelPatch) => ModelPatchResult;
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

/** AI/editor patches are explicit transactions and must never coalesce with
 * a user's immediately preceding drag or field edit. */
function commitAtomic(state: ModelState, next: ModelDocument): Partial<ModelState> {
  return {
    document: next,
    past: [...state.past, state.document].slice(-MAX_HISTORY),
    future: [],
    lastCommitAt: 0,
    canUndo: true,
    canRedo: false,
  };
}

export const useModelStore = create<ModelState>()((set, get) => ({
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
      return commit(state, refreshLinkedConnectors(next));
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
    set((state) => {
      const removed = removeNode(state.document, id);
      const document = {
        ...removed,
        nodes: removed.nodes.filter(
          (node) =>
            node.presentation?.connector?.fromId !== id &&
            node.presentation?.connector?.toId !== id,
        ),
      };
      return {
        ...commit(state, document),
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    }),
  select: (id) => set({ selectedId: id }),
  renameBlock: (id, name) => set((state) => commit(state, renameNode(state.document, id, name))),
  setBlockParam: (id, key, value) =>
    set((state) => commit(state, setParam(state.document, id, key, value))),
  applyPatch: (patch) => {
    const state = get();
    const result = applyModelPatch(state.document, patch);
    if (result.ok) {
      set({ ...commitAtomic(state, result.document), selectedId: null });
    }
    return result;
  },
  removeBlockParam: (id, key) =>
    set((state) => commit(state, removeParam(state.document, id, key))),
  renameBlockParam: (id, oldKey, newKey) =>
    set((state) => commit(state, renameParam(state.document, id, oldKey, newKey))),
  setPresentation: (id, object) =>
    set((state) => {
      let found = false;
      let document: ModelDocument = {
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
      if (object.componentId && !object.instanceOf) {
        document = {
          ...document,
          nodes: document.nodes.map((node) => {
            const instance = node.presentation;
            if (!instance || instance.instanceOf !== object.componentId) return node;
            const transform = instance.transform;
            return {
              ...node,
              presentation: {
                ...object,
                id: instance.id,
                componentId: undefined,
                instanceOf: object.componentId,
                transform,
                visible: instance.visible,
                locked: instance.locked,
              },
            };
          }),
        };
      }
      document = refreshLinkedConnectors(document);
      return found ? commit(state, document) : {};
    }),
  groupShapes: (ids) => {
    const state = useModelStore.getState();
    const members = ids
      .map((id) => state.document.nodes.find((node) => node.id === id && node.presentation))
      .filter((node): node is ModelNode & { presentation: GraphicNode } => !!node);
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
          skewX: 0,
          skewY: 0,
        },
        style: defaultGraphicStyle(),
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
      const kind = presentationKindFor(child);
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
      .filter((node): node is ModelNode & { presentation: GraphicNode } => !!node);
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
      .filter((node): node is ModelNode & { presentation: GraphicNode } => !!node);
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
  reorderPresentationLayers: (idsTopFirst) => {
    const state = get();
    const requested = [...new Set(idsTopFirst)];
    const requestedSet = new Set(requested);
    const layerSlots = state.document.nodes.filter(
      (node) => requestedSet.has(node.id) && node.presentation,
    );
    if (layerSlots.length !== requested.length) return;
    const byId = new Map(layerSlots.map((node) => [node.id, node]));
    const bottomFirst = [...requested].reverse().map((id) => byId.get(id)!);
    let cursor = 0;
    const nodes = state.document.nodes.map((node) =>
      requestedSet.has(node.id) ? bottomFirst[cursor++]! : node,
    );
    if (nodes.every((node, index) => node === state.document.nodes[index])) return;
    set({ ...commitAtomic(state, { ...state.document, nodes }) });
  },
  makeComponent: (id) => {
    const state = get();
    const node = state.document.nodes.find((entry) => entry.id === id && entry.presentation);
    if (!node?.presentation || node.presentation.instanceOf) return null;
    const componentId = node.presentation.componentId ?? freshId('component');
    const nodes = state.document.nodes.map((entry) =>
      entry.id === id ? { ...entry, presentation: { ...node.presentation!, componentId } } : entry,
    );
    set({ ...commitAtomic(state, { ...state.document, nodes }) });
    return componentId;
  },
  createComponentInstance: (id) => {
    const state = get();
    const requested = state.document.nodes.find((entry) => entry.id === id && entry.presentation);
    const master = requested?.presentation?.instanceOf
      ? state.document.nodes.find(
          (entry) => entry.presentation?.componentId === requested.presentation?.instanceOf,
        )
      : requested;
    if (!master?.presentation) return null;
    const componentId = master.presentation.componentId ?? freshId('component');
    const instanceId = freshId(`${master.kind}-instance`);
    const masterObject = { ...master.presentation, componentId };
    const transform = {
      ...masterObject.transform,
      x: masterObject.transform.x + 32,
      y: masterObject.transform.y + 32,
    };
    const instance: ModelNode = {
      ...master,
      id: instanceId,
      name: `${master.name} instance`,
      x: transform.x,
      y: transform.y,
      presentation: {
        ...masterObject,
        componentId: undefined,
        instanceOf: componentId,
        transform,
      },
    };
    const nodes = state.document.nodes.map((entry) =>
      entry.id === master.id ? { ...entry, presentation: masterObject } : entry,
    );
    nodes.push(instance);
    set({ ...commitAtomic(state, { ...state.document, nodes }), selectedId: instanceId });
    return instanceId;
  },
  detachComponentInstance: (id) => {
    const state = get();
    const nodes = state.document.nodes.map((node) =>
      node.id === id && node.presentation?.instanceOf
        ? { ...node, presentation: { ...node.presentation, instanceOf: undefined } }
        : node,
    );
    set({ ...commitAtomic(state, { ...state.document, nodes }) });
  },
  connectPresentationShapes: (ids) => {
    const state = get();
    const unique = [...new Set(ids)];
    if (unique.length !== 2) return null;
    const from = state.document.nodes.find((node) => node.id === unique[0] && node.presentation);
    const to = state.document.nodes.find((node) => node.id === unique[1] && node.presentation);
    if (!from?.presentation || !to?.presentation || from.container !== to.container) return null;
    const route = routeOrthogonal(from.presentation.transform, to.presentation.transform);
    const style = defaultGraphicStyle();
    const id = freshId('connector');
    const connector: ModelNode = {
      id,
      kind: 'polyline',
      name: 'Connector',
      x: route.transform.x,
      y: route.transform.y,
      params: {},
      library: 'presentation',
      container: from.container,
      presentation: {
        type: 'shape',
        transform: route.transform,
        style: {
          ...style,
          fill: { kind: 'none' },
          stroke: { ...style.stroke, width: 2, endArrow: 'arrow' },
        },
        geometry: {
          shapeType: 'polyline',
          width: route.transform.width,
          height: route.transform.height,
          points: route.points,
        },
        connector: { fromId: from.id, toId: to.id, routing: 'orthogonal' },
      },
    };
    set({
      ...commitAtomic(state, { ...state.document, nodes: [...state.document.nodes, connector] }),
      selectedId: id,
    });
    return id;
  },
  applyBooleanShapes: (ids, op) => {
    const state = useModelStore.getState();
    const members = ids
      .map((id) => state.document.nodes.find((node) => node.id === id && node.presentation))
      .filter((node): node is ModelNode & { presentation: GraphicNode } => !!node);
    if (members.length < 2) {
      return null;
    }
    const result = booleanShapes(
      members.map((member) => member.presentation),
      op,
    );
    if (!result) {
      return null;
    }
    const nodeId = freshId('boolean');
    const memberIds = new Set(members.map((member) => member.id));
    const document: ModelDocument = {
      ...state.document,
      nodes: [
        ...state.document.nodes.filter((node) => !memberIds.has(node.id)),
        {
          id: nodeId,
          kind: 'curve',
          name: 'boolean',
          x: result.transform.x,
          y: result.transform.y,
          params: {},
          library: 'presentation',
          presentation: result,
        },
      ],
    };
    set({ ...commit(state, document), selectedId: nodeId });
    return nodeId;
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

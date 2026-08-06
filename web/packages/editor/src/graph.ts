// Editor block-graph model (P1-6 drag-and-drop modeling).
//
// A ModelDocument is the source of truth the canvas renders and the DSL
// generator consumes. Operations are pure (they return a new document) so
// the IDE can layer undo/redo and diagnostics on top without mutating
// shared state.

import type { GraphicNode } from './presentation.js';

// Any DSL v2 member kind: the five kernel blocks, container kinds and
// library-registered or still-unknown kinds (the latter render as
// placeholder nodes so the canvas never drops DSL members).
export type BlockKind = string;

/** Block kinds that are containers: their children (nodes whose `container`
 *  equals the container's name) form a subgraph edited on its own canvas. */
export const CONTAINER_KINDS: readonly string[] = ['process'];

/** One block instance on the canvas. `params` are field values keyed by
 *  the block's registered param name (see libraries/process.lplib). */
export interface ModelNode {
  id: string;
  kind: BlockKind;
  name: string;
  x: number;
  y: number;
  params: Record<string, string | number | boolean>;
  /** The containing process block's name (e.g. 'Flow'); undefined = model
   *  level. The canvas can focus on one container's subgraph. */
  container?: string;
  /** The palette library the block came from ('process', 'presentation',
   *  'statechart', 'action', ...). Process-flow blocks emit into the DSL;
   *  drawing/behavior elements do not. Legacy nodes leave it undefined. */
  library?: string;
  /** True for kinds the canvas cannot render yet: the node stays in the
   *  model and the DSL round-trip (never dropped), shown as a grey
   *  placeholder frame. */
  placeholder?: boolean;
  /** Vector drawing object (Figma-style vector graphics node).
   *  Present exactly for presentation-library nodes; geometry and style
   *  live here while `x`/`y` mirror `transform.x`/`transform.y`. */
  presentation?: GraphicNode;
}

/** A coupling between two block instances (process flow). `fromPort` /
 *  `toPort` name the connecting ports; undefined means the block's default
 *  output (`out`) / input (`in`) port. */
export interface ModelEdge {
  id: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
}

export interface ModelDocument {
  name: string;
  nodes: ModelNode[];
  edges: ModelEdge[];
}

export interface AddNodeInput {
  kind: BlockKind;
  name: string;
  x: number;
  y: number;
  params?: Record<string, string | number | boolean>;
  container?: string;
  library?: string;
  /** Vector drawing object for presentation-library nodes. */
  presentation?: GraphicNode;
}

let nextId = 1;

/** Deterministic id for tests and the canvas key. */
export function freshId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

export function createDocument(name = 'Model'): ModelDocument {
  return { name, nodes: [], edges: [] };
}

export function findNode(document: ModelDocument, id: string): ModelNode | undefined {
  return document.nodes.find((node) => node.id === id);
}

export function addNode(document: ModelDocument, input: AddNodeInput): ModelDocument {
  const node: ModelNode = {
    id: freshId(input.kind),
    kind: input.kind,
    name: input.name,
    x: input.x,
    y: input.y,
    params: { ...input.params },
    container: input.container,
    library: input.library,
    presentation: input.presentation,
  };
  return { ...document, nodes: [...document.nodes, node] };
}

export function removeNode(document: ModelDocument, id: string): ModelDocument {
  const node = findNode(document, id);
  const removed = new Set([id]);
  if (node && CONTAINER_KINDS.includes(node.kind)) {
    // Removing a container removes its whole subgraph (children + their
    // couplings), matching the Node-tree semantics: a container Node is its
    // scene file, so deleting it deletes the scene.
    for (const child of document.nodes) {
      if (child.container === node.name) {
        removed.add(child.id);
      }
    }
  }
  return {
    ...document,
    nodes: document.nodes.filter((candidate) => !removed.has(candidate.id)),
    edges: document.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to)),
  };
}

export function moveNode(document: ModelDocument, id: string, x: number, y: number): ModelDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)),
  };
}

export function renameNode(document: ModelDocument, id: string, name: string): ModelDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => (node.id === id ? { ...node, name } : node)),
  };
}

export function setParam(
  document: ModelDocument,
  id: string,
  key: string,
  value: string | number | boolean,
): ModelDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === id ? { ...node, params: { ...node.params, [key]: value } } : node,
    ),
  };
}

export interface ConnectResult {
  document: ModelDocument;
  /** Rejected connections carry the reason; the document is unchanged. */
  error?: string;
}

export function connect(
  document: ModelDocument,
  from: string,
  to: string,
  fromPort?: string,
  toPort?: string,
): ConnectResult {
  if (from === to) {
    return { document, error: 'a block cannot connect to itself' };
  }
  if (!findNode(document, from) || !findNode(document, to)) {
    return { document, error: 'connection references an unknown block' };
  }
  // Normalize the default ports away so linear flows stay compact and
  // legacy edges (without ports) remain valid.
  const normalizedFrom = fromPort === 'out' ? undefined : fromPort;
  const normalizedTo = toPort === 'in' ? undefined : toPort;
  if (
    document.edges.some(
      (edge) =>
        edge.from === from &&
        edge.to === to &&
        (edge.fromPort ?? 'out') === (normalizedFrom ?? 'out') &&
        (edge.toPort ?? 'in') === (normalizedTo ?? 'in'),
    )
  ) {
    return { document, error: 'connection already exists' };
  }
  const edge: ModelEdge = { id: freshId('edge'), from, to };
  if (normalizedFrom !== undefined) edge.fromPort = normalizedFrom;
  if (normalizedTo !== undefined) edge.toPort = normalizedTo;
  return { document: { ...document, edges: [...document.edges, edge] } };
}

export function disconnect(document: ModelDocument, id: string): ModelDocument {
  return {
    ...document,
    edges: document.edges.filter((edge) => edge.id !== id),
  };
}

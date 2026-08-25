// ELK-powered automatic layout for the SysML projection
// (workbench-architecture-plan.md §8 S3 "Diagram 只保存 viewpoint/layout").
//
// elkjs (Eclipse Layout Kernel) is the industry-standard layered layout for
// architecture diagrams: it natively handles COMPOUND hierarchies - our
// containment tree nests as ELK children, so `contains` relations become
// structure instead of edges - and layers the remaining relations
// deterministically with a pinned random seed.
//
// Scale contract: layout runs OFF the render path in a Web Worker by
// default, so large graphs from future simulation paradigms cannot freeze
// the UI. Fallbacks degrade gracefully: worker → main-thread bundle → the
// synchronous tidy-tree layout that also serves first paint.

import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { runElkLayout } from '@logicpilot/canvas';
import {
  SYML_NODE_HEIGHT,
  SYML_NODE_WIDTH,
  projectSysML,
  type SysMLLayout,
  type SysMLPosition,
  type SysMLProjection,
} from './sysmlProjection';

interface ElkShape {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkShape[];
  edges?: unknown[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph extends ElkShape {
  layoutOptions: Record<string, string>;
}

/** Pure builder: projection → ELK compound graph. Exported for tests -
 *  containment nests as children, `contains` edges disappear into that
 *  hierarchy, every other relation becomes an edge. Element order follows
 *  the document order of the projection, keeping results deterministic.
 *
 *  Per-kind reading directions (SysML diagram conventions):
 *   - structure / all: containment grows left→right (block definition);
 *   - behavior: state machines and activity flows read top→down;
 *   - requirements: satisfaction trees grow top→down;
 *   - traceability: cross-cutting matrix-like flows read left→right. */
export function buildElkGraph(
  projection: SysMLProjection,
  mode: 'all' | 'structure' | 'requirements' | 'behavior' | 'traceability' = 'all',
): ElkGraph {
  const byId = new Map<string, ElkShape>();
  const roots: ElkShape[] = [];
  const nodeById = new Map(projection.elements.map((element) => [element.id, element]));

  const makeNode = (id: string): ElkShape => {
    const shape: ElkShape = { id, width: SYML_NODE_WIDTH, height: SYML_NODE_HEIGHT, children: [] };
    byId.set(id, shape);
    return shape;
  };

  for (const element of projection.elements) {
    const shape = makeNode(element.id);
    if (
      element.ownerId !== undefined &&
      nodeById.has(element.ownerId) &&
      element.id !== element.ownerId
    ) {
      byId.get(element.ownerId)!.children!.push(shape);
    } else {
      roots.push(shape);
    }
  }

  const edges = projection.relations
    .filter((relation) => relation.kind !== 'contains')
    .map((relation, index) => ({
      id: `e${index}`,
      sources: [relation.from],
      targets: [relation.to],
    }));

  const direction = mode === 'behavior' || mode === 'requirements' ? 'DOWN' : 'RIGHT';

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // Reading direction of the active diagram kind (see doc above).
      'elk.direction': direction,
      // Deterministic runs: same projection + options ⇒ same layout.
      'elk.randomSeed': '1',
      // DOWN layouts stack siblings horizontally; give them room so labels
      // do not collide, matching how statechart regions spread.
      'elk.spacing.nodeNode': mode === 'behavior' ? '48' : '36',
      'elk.layered.spacing.nodeNodeBetweenLayers':
        mode === 'behavior' || mode === 'requirements' ? '80' : '90',
      // Cross-hierarchy edges participate in one global layering pass.
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': '[top=140,left=60,bottom=60,right=60]',
    },
    children: roots,
    edges,
  };
}

function collectPositions(
  shapes:
    | Array<{
        id?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        children?: unknown[];
      }>
    | undefined,
  originX: number,
  originY: number,
  positions: Record<string, SysMLPosition>,
  sizes: Record<string, { width: number; height: number }>,
): void {
  // ELK reports child coordinates RELATIVE to their parent - accumulate the
  // ancestor chain so the canvas can keep drawing in one absolute space.
  for (const shape of shapes ?? []) {
    const absX = originX + (shape.x ?? 0);
    const absY = originY + (shape.y ?? 0);
    if (shape.id !== undefined) {
      positions[shape.id] = { x: Math.round(absX), y: Math.round(absY) };
      if (
        shape.width !== undefined &&
        shape.height !== undefined &&
        (shape.width > SYML_NODE_WIDTH || shape.height > SYML_NODE_HEIGHT)
      ) {
        sizes[shape.id] = { width: Math.round(shape.width), height: Math.round(shape.height) };
      }
    }
    collectPositions(
      shape.children as
        | Array<{
            id?: string;
            x?: number;
            y?: number;
            width?: number;
            height?: number;
            children?: unknown[];
          }>
        | undefined,
      absX,
      absY,
      positions,
      sizes,
    );
  }
}

export interface ElkLayoutOutput {
  positions: Record<string, SysMLPosition>;
  /** ELK-enlarged bounds for compound containers (parents wrapping their
   *  children); absent for plain leaf nodes. */
  sizes: Record<string, { width: number; height: number }>;
}

async function runElk(graph: ElkGraph): Promise<ElkLayoutOutput> {
  // Worker/bundled orchestration lives in the canvas platform kernel; this
  // site only supplies the two elkjs constructors and the collector.
  const result = await runElkLayout({
    graph,
    createWorkerElk: () => new ELK({ workerUrl: elkWorkerUrl }),
    createBundledElk: async () => {
      const bundled = await import('elkjs/lib/elk.bundled.js');
      const ctor =
        (bundled as unknown as { default: new () => { layout: (g: never) => Promise<unknown> } })
          .default ??
        (bundled as unknown as { ELK: new () => { layout: (g: never) => Promise<unknown> } }).ELK;
      return new ctor();
    },
  });
  const positions: Record<string, SysMLPosition> = {};
  const sizes: Record<string, { width: number; height: number }> = {};
  collectPositions(
    result.children as
      | Array<{
          id?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          children?: unknown[];
        }>
      | undefined,
    0,
    0,
    positions,
    sizes,
  );
  return { positions, sizes };
}

/** Compute an ELK-layered layout for one projection. Throws when both the
 *  worker and the main-thread fallback fail; callers keep their synchronous
 *  fallback layout in that case. `mode` picks the diagram-kind reading
 *  direction (see buildElkGraph). */
export async function autoLayoutWithElk(
  source: string,
  projection: SysMLProjection,
  mode: 'all' | 'structure' | 'requirements' | 'behavior' | 'traceability' = 'all',
): Promise<SysMLLayout & { sizes: ElkLayoutOutput['sizes'] }> {
  void projectSysML; // kept for API symmetry with other layout backends
  const graph = buildElkGraph(projection, mode);
  const { positions, sizes } = await runElk(graph);
  if (Object.keys(positions).length !== projection.elements.length) {
    throw new Error('ELK layout did not position every element');
  }
  return { version: 1, sourceHash: projection.sourceHash, positions, sizes };
}

/** Chunked compound layout for large models (plan S4 follow-up): one ELK
 *  run per TOP-LEVEL root element instead of a single graph with hundreds
 *  of nodes - each chunk stays inside the worker's comfort zone, results
 *  land in seconds, and chunks are packed left-to-right deterministically.
 *  Relations whose endpoints live in different chunks are dropped from the
 *  per-chunk graphs (cross-chunk edges re-emerge visually as the chunks sit
 *  side by side). */
export async function autoLayoutChunkedWithElk(
  projection: SysMLProjection,
  chunkThreshold = 250,
): Promise<SysMLLayout & { sizes: ElkLayoutOutput['sizes'] }> {
  if (projection.elements.length <= chunkThreshold) {
    return autoLayoutWithElk('', projection);
  }
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  // Chunk units: top-level roots, or - when the model is one giant root
  // package (the spec vehicle shape) - its second-level children.
  let units = projection.elements.filter(
    (element) => element.ownerId === undefined || !byId.has(element.ownerId),
  );
  if (units.length <= 1) {
    units = projection.elements.filter(
      (element) =>
        element.ownerId !== undefined &&
        byId.has(element.ownerId) &&
        (byId.get(element.ownerId)!.ownerId === undefined ||
          !byId.has(byId.get(element.ownerId)!.ownerId!)),
    );
  }
  if (units.length <= 1) {
    return autoLayoutWithElk('', projection);
  }
  const descendants = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    const walk = (ownerId: string) => {
      for (const element of projection.elements) {
        if (element.ownerId === ownerId && !ids.has(element.id)) {
          ids.add(element.id);
          walk(element.id);
        }
      }
    };
    walk(rootId);
    return ids;
  };
  const positions: Record<string, SysMLPosition> = {};
  const sizes: Record<string, { width: number; height: number }> = {};
  const CHUNK_GAP = 90;
  const PER_ROW = 3;
  let cursorX = 80;
  let cursorY = 80;
  let rowHeight = 0;
  let placed = 0;
  for (const unit of units) {
    const ids = descendants(unit.id);
    const elements = projection.elements.filter((element) => ids.has(element.id));
    const relations = projection.relations.filter(
      (relation) => ids.has(relation.from) && ids.has(relation.to) && relation.kind !== 'contains',
    );
    const sub = { elements, relations, sourceHash: projection.sourceHash } as SysMLProjection;
    const { positions: chunkPositions, sizes: chunkSizes } = await runElk(buildElkGraph(sub));
    let maxX = 0;
    let maxY = 0;
    for (const [id, pos] of Object.entries(chunkPositions)) {
      positions[id] = { x: pos.x + cursorX, y: pos.y + cursorY };
      maxX = Math.max(maxX, pos.x + (chunkSizes[id]?.width ?? SYML_NODE_WIDTH));
      maxY = Math.max(maxY, pos.y + (chunkSizes[id]?.height ?? SYML_NODE_HEIGHT));
    }
    for (const [id, size] of Object.entries(chunkSizes)) sizes[id] = size;
    placed += 1;
    cursorX += maxX + CHUNK_GAP;
    rowHeight = Math.max(rowHeight, maxY + 60);
    if (placed % PER_ROW === 0) {
      cursorX = 80;
      cursorY += rowHeight;
      rowHeight = 0;
    }
  }
  // The root package itself lives in no chunk - pin it above the grid.
  for (const element of projection.elements) {
    if (positions[element.id] === undefined) {
      positions[element.id] = { x: 80, y: 24 };
    }
  }
  return { version: 1, sourceHash: projection.sourceHash, positions, sizes };
}

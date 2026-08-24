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

let workerElk: import('elkjs/lib/elk-api.js').ELK | null = null;

function workerInstance(): import('elkjs/lib/elk-api.js').ELK {
  if (workerElk === null) {
    if (typeof Worker === 'undefined') {
      // Non-browser environment (unit tests): fail fast into the main-thread
      // fallback instead of throwing deep inside the worker shim.
      throw new Error('Worker is not available in this environment');
    }
    // Classic worker shipped by elkjs; Vite copies it via ?url.
    workerElk = new ELK({ workerUrl: elkWorkerUrl });
  }
  return workerElk;
}

/** Pure builder: projection → ELK compound graph. Exported for tests -
 *  containment nests as children, `contains` edges disappear into that
 *  hierarchy, every other relation becomes an edge. Element order follows
 *  the document order of the projection, keeping results deterministic. */
export function buildElkGraph(projection: SysMLProjection): ElkGraph {
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

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // RIGHT makes same-parent siblings stack VERTICALLY inside their
      // container while depth grows left-to-right - the reading direction
      // of block/containment diagrams.
      'elk.direction': 'RIGHT',
      // Deterministic runs: same projection + options ⇒ same layout.
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
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

type LayoutResult = {
  children?: Array<{ id: string; x?: number; y?: number; children?: unknown[] }>;
};

export interface ElkLayoutOutput {
  positions: Record<string, SysMLPosition>;
  /** ELK-enlarged bounds for compound containers (parents wrapping their
   *  children); absent for plain leaf nodes. */
  sizes: Record<string, { width: number; height: number }>;
}

async function runElk(graph: ElkGraph): Promise<ElkLayoutOutput> {
  // `never` parameter keeps every elkjs flavor assignable regardless of its
  // declared graph node interface.
  const run = async (elk: { layout: (g: never) => Promise<unknown> }) =>
    (await elk.layout(graph as never)) as LayoutResult;
  let result;
  try {
    result = await run(workerInstance());
  } catch (workerError) {
    // Worker unavailable (CSP, exotic bundler): main thread keeps working.
    // eslint-disable-next-line no-console -- one-shot fallback diagnostic.
    console.warn('[sysml] ELK worker failed, falling back to main thread', workerError);
    const bundled = await import('elkjs/lib/elk.bundled.js');
    const MainThreadELK =
      (bundled as unknown as { default: new () => { layout: (g: never) => Promise<unknown> } })
        .default ??
      (bundled as unknown as { ELK: new () => { layout: (g: never) => Promise<unknown> } }).ELK;
    result = await run(new MainThreadELK());
  }
  const positions: Record<string, SysMLPosition> = {};
  const sizes: Record<string, { width: number; height: number }> = {};
  collectPositions(result.children, 0, 0, positions, sizes);
  return { positions, sizes };
}

/** Compute an ELK-layered layout for one projection. Throws when both the
 *  worker and the main-thread fallback fail; callers keep their synchronous
 *  fallback layout in that case. */
export async function autoLayoutWithElk(
  source: string,
  projection: SysMLProjection,
): Promise<SysMLLayout & { sizes: ElkLayoutOutput['sizes'] }> {
  void projectSysML; // kept for API symmetry with other layout backends
  const graph = buildElkGraph(projection);
  const { positions, sizes } = await runElk(graph);
  if (Object.keys(positions).length !== projection.elements.length) {
    throw new Error('ELK layout did not position every element');
  }
  return { version: 1, sourceHash: projection.sourceHash, positions, sizes };
}

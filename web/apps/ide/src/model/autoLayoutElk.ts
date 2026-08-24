// ELK layered auto-arrange for model-canvas flow subgraphs (UX audit
// follow-up). Shares elkjs and its worker plumbing with the SysML
// projection layout, but scopes to ONE container view's flat node/edge
// set: presentation shapes and hand-pinned positions never participate,
// and results stay deterministic through a pinned random seed.

import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

export interface ArrangeNode {
  id: string;
}

export interface ArrangeEdge {
  from: string;
  to: string;
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ id: string; sources: string[]; targets: string[] }>;
}

type LayoutResult = {
  children?: Array<{ id?: string; x?: number; y?: number }>;
};

/** Approximate on-screen card footprint; exact pixel truth is unnecessary
 *  for layered ordering - only relative sizes matter to ELK. */
const NODE_WIDTH = 150;
const NODE_HEIGHT = 64;

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

/** Pure builder: flat node/edge set → ELK layered graph. Exported for
 *  tests - same input always yields the same graph. */
export function buildArrangeGraph(nodes: ArrangeNode[], edges: ArrangeEdge[]): ElkGraph {
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // Flow reading direction: sources left, sinks right - matches how
      // process chains are drawn everywhere else in the product.
      'elk.direction': 'RIGHT',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
    },
    children: nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((edge, index) => ({
      id: `e${index}`,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };
}

async function runElk(graph: ElkGraph): Promise<Record<string, { x: number; y: number }>> {
  const run = async (elk: { layout: (g: never) => Promise<unknown> }) =>
    (await elk.layout(graph as never)) as LayoutResult;
  let result;
  try {
    result = await run(workerInstance());
  } catch (workerError) {
    // Worker unavailable (CSP, exotic bundler): main thread keeps working.
    // eslint-disable-next-line no-console -- one-shot fallback diagnostic.
    console.warn('[model] ELK worker failed, falling back to main thread', workerError);
    const bundled = await import('elkjs/lib/elk.bundled.js');
    const MainThreadELK =
      (bundled as unknown as { default: new () => { layout: (g: never) => Promise<unknown> } })
        .default ??
      (bundled as unknown as { ELK: new () => { layout: (g: never) => Promise<unknown> } }).ELK;
    result = await run(new MainThreadELK());
  }
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of result.children ?? []) {
    if (child.id !== undefined) {
      positions[child.id] = { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) };
    }
  }
  return positions;
}

/** Layered positions for one flow subgraph. Rejects empty input up front;
 *  throws when both the worker and the main-thread fallback fail - callers
 *  treat layout as best-effort and keep the current arrangement. */
export async function autoArrangePositions(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
): Promise<Record<string, { x: number; y: number }>> {
  if (nodes.length === 0) {
    return {};
  }
  return runElk(buildArrangeGraph(nodes, edges));
}

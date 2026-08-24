// ELK layered auto-arrange for model-canvas flow subgraphs (UX audit
// follow-up). Shares the ELK orchestration policy with every other canvas
// through @logicpilot/canvas; this site owns the flow graph builder
// (deterministic pinned seed, RIGHT reading direction) and the collector.

import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { runElkLayout } from '@logicpilot/canvas';

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

type ElkLayoutResult = {
  children?: Array<{ id?: string; x?: number; y?: number }>;
};

/** Approximate on-screen card footprint; exact pixel truth is unnecessary
 *  for layered ordering - only relative sizes matter to ELK. */
const NODE_WIDTH = 150;
const NODE_HEIGHT = 64;

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

async function runElk(graph: ElkGraph): Promise<ElkLayoutResult> {
  // Worker/bundled orchestration lives in the canvas platform kernel.
  return runElkLayout({
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
  const result = await runElk(buildArrangeGraph(nodes, edges));
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of result.children ?? []) {
    const id = child.id;
    if (typeof id === 'string') {
      positions[id] = {
        x: Math.round(typeof child.x === 'number' ? child.x : 0),
        y: Math.round(typeof child.y === 'number' ? child.y : 0),
      };
    }
  }
  return positions;
}

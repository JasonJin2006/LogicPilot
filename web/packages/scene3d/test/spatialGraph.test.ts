import { describe, expect, it } from 'vitest';
import type { ModelDocument, ModelNode } from '@logicpilot/editor';
import { spatialGraphFromDocument } from '../src/spatialGraph';

function node(
  id: string,
  kind: string,
  name: string,
  params: Record<string, string | number | boolean> = {},
): ModelNode {
  return { id, kind, name, x: 0, y: 0, params };
}

function doc(nodes: ModelNode[]): ModelDocument {
  return { name: 'test', nodes, edges: [] };
}

/** The spatial markup of `examples/move_route.lp`, built by hand so this file
 *  stays a pure unit test. The same source is exercised end to end from the real
 *  DSL file in the IDE app's test. */
function moveRoute(): ModelDocument {
  return doc([
    node('n1', 'node', 'Dock', { x: 0, y: 0 }),
    node('n2', 'node', 'Depot', { x: 10, y: 0 }),
    node('n3', 'node', 'Bay', { x: 10, y: 10 }),
    node('p1', 'path', 'Run1', { node1: 'Dock', node2: 'Depot' }),
    node('p2', 'path', 'Run2', { node1: 'Depot', node2: 'Bay' }),
    node('b1', 'source', 'Jobs', { arrival: 1 }),
    node('b2', 'moveTo', 'Ship', { node: 'Bay', speed: 10 }),
    node('b3', 'sink', 'Done'),
  ]);
}

describe('spatial extraction', () => {
  it('reads the declared network, not the canvas layout', () => {
    const graph = spatialGraphFromDocument(moveRoute());
    expect(graph).not.toBeNull();
    if (graph === null) return;
    expect(graph.nodes.map((entry) => [entry.name, entry.x, entry.y])).toEqual([
      ['Dock', 0, 0],
      ['Depot', 10, 0],
      ['Bay', 10, 10],
    ]);
  });

  it('returns null when the document declares no nodes', () => {
    // The signal that this model is not spatial, so the structural projection is
    // the right one. A `path` on its own is not enough to draw a floor.
    expect(spatialGraphFromDocument(doc([node('a', 'source', 'Jobs')]))).toBeNull();
    expect(
      spatialGraphFromDocument(doc([node('a', 'path', 'Run', { node1: 'X', node2: 'Y' })])),
    ).toBeNull();
    expect(spatialGraphFromDocument(doc([]))).toBeNull();
  });

  it('weights a path by its Euclidean length in the model plane', () => {
    const graph = spatialGraphFromDocument(moveRoute());
    const paths = graph?.paths ?? [];
    expect(paths.map((path) => [path.name, path.fromName, path.toName, path.length])).toEqual([
      ['Run1', 'Dock', 'Depot', 10],
      ['Run2', 'Depot', 'Bay', 10],
    ]);
    // Endpoints are ids, not names, so a 3D pick round-trips to the canvas node.
    expect(paths[0]?.from).toBe('n1');
    expect(paths[0]?.to).toBe('n2');
  });

  it('measures a diagonal path diagonally', () => {
    const graph = spatialGraphFromDocument(
      doc([
        node('a', 'node', 'A', { x: 0, y: 0 }),
        node('b', 'node', 'B', { x: 3, y: 4 }),
        node('p', 'path', 'D', { node1: 'A', node2: 'B' }),
      ]),
    );
    expect(graph?.paths[0]?.length).toBeCloseTo(5, 12);
  });

  it('accepts string coordinates, which is how the DSL delivers them', () => {
    const graph = spatialGraphFromDocument(doc([node('a', 'node', 'A', { x: '2.5', y: '-1' })]));
    expect(graph?.nodes[0]?.x).toBe(2.5);
    expect(graph?.nodes[0]?.y).toBe(-1);
  });

  it('puts a node with no coordinates at the origin, as the kernel does', () => {
    // `node_float_param(child, "x", 0.0)` is the reference: the view must not
    // place a node somewhere the simulation would not.
    const graph = spatialGraphFromDocument(doc([node('a', 'node', 'A')]));
    expect(graph?.nodes[0]?.x).toBe(0);
    expect(graph?.nodes[0]?.y).toBe(0);
    expect(graph?.extent).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, depth: 0 });
  });

  it('falls back for an unreadable coordinate instead of leaking NaN', () => {
    // A NaN reaching the projection would poison every derived position, size and
    // bound, and a blank scene with no error is the worst possible outcome.
    const graph = spatialGraphFromDocument(
      doc([node('a', 'node', 'A', { x: 'not-a-number', y: { bad: true } as unknown as number })]),
    );
    expect(graph?.nodes[0]?.x).toBe(0);
    expect(graph?.nodes[0]?.y).toBe(0);
  });

  it('reads z and reports that it was declared', () => {
    const flat = spatialGraphFromDocument(doc([node('a', 'node', 'A', { x: 1, y: 1 })]));
    expect(flat?.usesZ).toBe(false);
    const lifted = spatialGraphFromDocument(doc([node('a', 'node', 'A', { x: 1, y: 1, z: 4 })]));
    expect(lifted?.nodes[0]?.z).toBe(4);
    expect(lifted?.usesZ).toBe(true);
  });

  it('computes the extent from the declared coordinates', () => {
    const graph = spatialGraphFromDocument(moveRoute());
    expect(graph?.extent).toEqual({
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
      width: 10,
      depth: 10,
    });
  });

  it('is deterministic', () => {
    const input = moveRoute();
    expect(spatialGraphFromDocument(input)).toEqual(spatialGraphFromDocument(input));
  });
});

describe('spatial extraction: unusable declarations are reported', () => {
  it('drops a path naming an unknown node, and says which name', () => {
    // The kernel skips an edge it cannot index, so the view must not invent one.
    const graph = spatialGraphFromDocument(
      doc([
        node('a', 'node', 'A', { x: 0, y: 0 }),
        node('p', 'path', 'Bad', { node1: 'A', node2: 'Nowhere' }),
      ]),
    );
    expect(graph?.paths).toHaveLength(0);
    expect(graph?.issues).toHaveLength(1);
    expect(graph?.issues[0]?.detail).toContain('Nowhere');
    expect(graph?.issues[0]?.id).toBe('p');
  });

  it('drops a path missing an endpoint', () => {
    const graph = spatialGraphFromDocument(
      doc([
        node('a', 'node', 'A', { x: 0, y: 0 }),
        node('p1', 'path', 'Half', { node1: 'A' }),
        node('p2', 'path', 'Blank', { node1: '  ', node2: 'A' }),
      ]),
    );
    expect(graph?.paths).toHaveLength(0);
    expect(graph?.issues.map((issue) => issue.id)).toEqual(['p1', 'p2']);
  });

  it('drops a path that joins a node to itself', () => {
    // No length and no direction: nothing to draw, and the kernel's weight is 0.
    const graph = spatialGraphFromDocument(
      doc([
        node('a', 'node', 'A', { x: 3, y: 3 }),
        node('p', 'path', 'Loop', { node1: 'A', node2: 'A' }),
      ]),
    );
    expect(graph?.paths).toHaveLength(0);
    expect(graph?.issues[0]?.detail).toContain('itself');
  });

  it('drops a destination that names no node, and keeps the ones that resolve', () => {
    const graph = spatialGraphFromDocument(
      doc([
        node('a', 'node', 'A', { x: 0, y: 0 }),
        node('b', 'moveTo', 'Good', { node: 'A' }),
        node('c', 'moveTo', 'Bad', { node: 'Nowhere' }),
      ]),
    );
    expect(graph?.anchors).toEqual([
      { blockId: 'b', blockName: 'Good', nodeId: 'a', nodeName: 'A' },
    ]);
    expect(graph?.issues[0]?.detail).toContain('Nowhere');
  });

  it('resolves a destination name to the node the kernel would use', () => {
    // Duplicate names: the kernel writes into `positions[name]`, so the later
    // declaration wins. A view picking the first would route trips differently
    // from the simulation.
    const graph = spatialGraphFromDocument(
      doc([
        node('first', 'node', 'Bay', { x: 1, y: 1 }),
        node('second', 'node', 'Bay', { x: 9, y: 9 }),
        node('m', 'moveTo', 'Ship', { node: 'Bay' }),
      ]),
    );
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.nodes[0]?.x).toBe(9);
    expect(graph?.anchors[0]?.nodeId).toBe('second');
    expect(graph?.issues.some((issue) => issue.detail.includes('duplicate'))).toBe(true);
  });

  it('does not treat spatial markup itself as anchored to a place', () => {
    // A `node` block's `x`/`y` are its coordinates, not a destination reference,
    // and a `path` names nodes rather than being one.
    const graph = spatialGraphFromDocument(moveRoute());
    expect(graph?.anchors.map((anchor) => anchor.blockName)).toEqual(['Ship']);
  });

  it('reports nothing when the network is well formed', () => {
    expect(spatialGraphFromDocument(moveRoute())?.issues).toEqual([]);
  });
});

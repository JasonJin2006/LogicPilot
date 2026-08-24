// Determinism contract for the model-canvas auto-arrange builder: same
// nodes/edges always produce the same ELK graph shape (pinned seed, flow
// reading direction).

import { describe, expect, it } from 'vitest';
import { buildArrangeGraph } from './autoLayoutElk';

describe('buildArrangeGraph', () => {
  it('builds a layered graph with a pinned seed and stable ordering', () => {
    const graph = buildArrangeGraph(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(graph.layoutOptions['elk.algorithm']).toBe('layered');
    expect(graph.layoutOptions['elk.direction']).toBe('RIGHT');
    expect(graph.layoutOptions['elk.randomSeed']).toBe('1');
    expect(graph.children.map((child) => child.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges).toEqual([
      { id: 'e0', sources: ['a'], targets: ['b'] },
      { id: 'e1', sources: ['b'], targets: ['c'] },
    ]);
  });

  it('accepts an edgeless set (layout still spreads the nodes)', () => {
    const graph = buildArrangeGraph([{ id: 'x' }, { id: 'y' }], []);
    expect(graph.edges).toEqual([]);
    expect(graph.children).toHaveLength(2);
  });
});

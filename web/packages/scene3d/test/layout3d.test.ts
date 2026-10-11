import { describe, expect, it } from 'vitest';
import type { ModelDocument, ModelNode } from '@logicpilot/editor';
import {
  LAYOUT_SCALE,
  LEVEL_HEIGHT,
  MAX_CONTAINER_DEPTH,
  NODE_FOOTPRINT,
  containerDepth,
  layoutDocument,
  nodeVisualBounds,
} from '../src/layout3d';
import { vec3 } from '../src/math3d';

function node(id: string, x: number, y: number, containerId?: string): ModelNode {
  return {
    id,
    kind: 'action',
    name: id,
    x,
    y,
    params: {},
    ...(containerId !== undefined ? { containerId, container: containerId } : {}),
  };
}

function document(nodes: ModelNode[]): ModelDocument {
  return { name: 'test', nodes, edges: [] };
}

describe('3D layout', () => {
  it('maps model x to world x and model y to world z', () => {
    const layout = layoutDocument(document([node('a', 100, 250)]));
    const placed = layout.get('a');
    expect(placed).toBeDefined();
    if (!placed) return;
    expect(placed.position.x).toBeCloseTo(100 * LAYOUT_SCALE, 12);
    expect(placed.position.z).toBeCloseTo(250 * LAYOUT_SCALE, 12);
    // Model level: nothing is stacked.
    expect(placed.position.y).toBe(0);
  });

  it('does not collapse a model onto a single axis', () => {
    // x and y must land on different world axes, or a 2D arrangement would
    // render as a line.
    const layout = layoutDocument(document([node('a', 50, 80)]));
    const placed = layout.get('a');
    if (!placed) throw new Error('missing layout');
    expect(placed.position.x).not.toBeCloseTo(placed.position.z, 6);
    expect(placed.position.y).toBe(0);
  });

  it('stacks a container child one level above its parent', () => {
    const layout = layoutDocument(document([node('parent', 0, 0), node('child', 0, 0, 'parent')]));
    expect(layout.get('parent')?.position.y).toBe(0);
    expect(layout.get('child')?.position.y).toBeCloseTo(LEVEL_HEIGHT, 12);
    expect(layout.get('child')?.depth).toBe(1);
  });

  it('counts nesting depth through the container chain', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0, 'a'), node('c', 0, 0, 'b')];
    const layout = layoutDocument(document(nodes));
    expect(layout.get('a')?.depth).toBe(0);
    expect(layout.get('b')?.depth).toBe(1);
    expect(layout.get('c')?.depth).toBe(2);
    expect(layout.get('c')?.position.y).toBeCloseTo(2 * LEVEL_HEIGHT, 12);
  });

  it('treats a missing container as model level instead of failing', () => {
    const layout = layoutDocument(document([node('orphan', 0, 0, 'does-not-exist')]));
    expect(layout.get('orphan')?.depth).toBe(0);
  });

  it('terminates on a container cycle', () => {
    // A malformed document must not hang the renderer: a contains b, b contains a.
    const cyc = document([node('a', 0, 0, 'b'), node('b', 0, 0, 'a')]);
    const layout = layoutDocument(cyc);
    for (const id of ['a', 'b']) {
      const depth = layout.get(id)?.depth ?? -1;
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(MAX_CONTAINER_DEPTH);
      expect(Number.isFinite(layout.get(id)?.position.y ?? Number.NaN)).toBe(true);
    }
  });

  it('terminates on a self-referencing container', () => {
    const self = node('loop', 10, 10);
    self.containerId = 'loop';
    const byId = new Map([['loop', self]]);
    expect(containerDepth(byId, 'loop')).toBe(0);
  });

  it('is deterministic and gives every node a placement', () => {
    const doc = document([node('a', 0, 0), node('b', 10, 20), node('c', -30, 5, 'a')]);
    const first = layoutDocument(doc);
    const second = layoutDocument(doc);
    expect(first.size).toBe(3);
    for (const [id, placed] of first) {
      expect(second.get(id)).toEqual(placed);
    }
  });
});

describe('nodeVisualBounds', () => {
  it('is centred on the placement', () => {
    const position = vec3(4, 2, -6);
    const size = vec3(NODE_FOOTPRINT, 1.4, NODE_FOOTPRINT);
    const bounds = nodeVisualBounds(position, size);
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(position.x, 12);
    expect((bounds.min.y + bounds.max.y) / 2).toBeCloseTo(position.y, 12);
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(position.z, 12);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(size.x, 12);
  });
});

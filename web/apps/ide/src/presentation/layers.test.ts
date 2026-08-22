import { describe, expect, it } from 'vitest';
import { createGraphicNode } from '@logicpilot/editor';
import { flattenPresentationLayers, getPresentationLayer, updatePresentationLayer } from './layers';

describe('presentation layer tree', () => {
  it('flattens nested children in visual top-first order', () => {
    const group = createGraphicNode('group', 0, 0);
    const bottom = createGraphicNode('rect', 0, 0);
    const top = createGraphicNode('group', 0, 0);
    top.children = [createGraphicNode('text', 0, 0)];
    group.children = [bottom, top];

    const layers = flattenPresentationLayers('group-1', 'Group', 'group', group);
    expect(layers.map((layer) => [layer.id, layer.depth])).toEqual([
      ['group-1', 0],
      ['group-1:1', 1],
      ['group-1:1.0', 2],
      ['group-1:0', 1],
    ]);
  });

  it('updates and reads a nested child without mutating the original tree', () => {
    const group = createGraphicNode('group', 0, 0);
    group.children = [createGraphicNode('rect', 0, 0)];
    const next = updatePresentationLayer(group, [0], { visible: false, locked: true });

    expect(next).not.toBeNull();
    expect(getPresentationLayer(next!, [0])).toMatchObject({ visible: false, locked: true });
    expect(getPresentationLayer(group, [0])).not.toHaveProperty('visible', false);
  });

  it('rejects an invalid child path', () => {
    const group = createGraphicNode('group', 0, 0);
    expect(updatePresentationLayer(group, [2], { visible: false })).toBeNull();
    expect(getPresentationLayer(group, [2])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { ModelDocument, ModelEdge, ModelNode } from '@logicpilot/editor';
import { buildStructureScene, visualForKind } from '../src/sceneModel';
import { LAYOUT_SCALE } from '../src/layout3d';

function node(id: string, kind = 'action', x = 0, y = 0, containerId?: string): ModelNode {
  return {
    id,
    kind,
    name: `name-${id}`,
    x,
    y,
    params: {},
    ...(containerId !== undefined ? { containerId } : {}),
  };
}

function doc(nodes: ModelNode[], edges: ModelEdge[] = []): ModelDocument {
  return { name: 'test', nodes, edges };
}

describe('structure projection', () => {
  it('turns every node into one scene object', () => {
    const scene = buildStructureScene(doc([node('a'), node('b'), node('c', 'queue')]));
    expect(scene.objects).toHaveLength(3);
    expect(scene.objects.map((object) => object.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('carries the label, kind and placement through', () => {
    const scene = buildStructureScene(doc([node('a', 'service', 120, 40)]));
    const object = scene.objects[0];
    expect(object).toBeDefined();
    if (!object) return;
    expect(object.id).toBe('a');
    expect(object.label).toBe('name-a');
    expect(object.kind).toBe('service');
    expect(object.position.x).toBeCloseTo(120 * LAYOUT_SCALE, 12);
    expect(object.position.z).toBeCloseTo(40 * LAYOUT_SCALE, 12);
  });

  it('drops an edge whose endpoint is not in the document', () => {
    // A line drawn to nowhere reads as a modelling error that is not there.
    const scene = buildStructureScene(
      doc(
        [node('a')],
        [
          { id: 'ok', from: 'a', to: 'a' },
          { id: 'dangling', from: 'a', to: 'missing' },
        ],
      ),
    );
    expect(scene.links.map((link) => link.id)).toEqual(['ok']);
  });

  it('keeps link endpoints and ports', () => {
    const scene = buildStructureScene(
      doc([node('a'), node('b')], [{ id: 'e', from: 'a', to: 'b', fromPort: 'out', toPort: 'in' }]),
    );
    const link = scene.links[0];
    expect(link).toBeDefined();
    if (!link) return;
    expect(link.from).toBe('a');
    expect(link.to).toBe('b');
    expect(link.fromPort).toBe('out');
    expect(link.toPort).toBe('in');
  });

  it('falls back for an unknown kind instead of dropping or faking it', () => {
    const scene = buildStructureScene(doc([node('x', 'paradigm-from-the-future')]));
    const object = scene.objects[0];
    expect(object).toBeDefined();
    if (!object) return;
    expect(object.knownKind).toBe(false);
    expect(object.shape).toBe('box');
    expect(object.colorKey).toBe('unknown');
    // The raw kind survives so the UI can name what it does not understand.
    expect(object.kind).toBe('paradigm-from-the-future');
  });

  it('marks a mapped kind as known', () => {
    const scene = buildStructureScene(doc([node('q', 'queue')]));
    expect(scene.objects[0]?.knownKind).toBe(true);
    expect(scene.objects[0]?.shape).toBe('cylinder');
  });

  it('gives distinct kinds distinct shapes', () => {
    // The mapping is only worth having if it actually differentiates.
    const queue = visualForKind('queue').visual;
    const source = visualForKind('source').visual;
    const resource = visualForKind('resource').visual;
    const shapes = new Set([queue.shape, source.shape, resource.shape]);
    expect(shapes.size).toBe(3);
  });

  it('is deterministic for the same document', () => {
    const input = doc([node('a', 'queue'), node('b')], [{ id: 'e', from: 'a', to: 'b' }]);
    expect(buildStructureScene(input)).toEqual(buildStructureScene(input));
  });

  it('does not depend on selection', () => {
    // Selection is view state: it must not appear in the description, or every
    // click would rebuild geometry.
    const scene = buildStructureScene(doc([node('a')]));
    expect(JSON.stringify(scene)).not.toContain('selected');
  });
});

describe('scene bounds', () => {
  it('contains every object', () => {
    const scene = buildStructureScene(
      doc([node('a', 'action', -300, -200), node('b', 'action', 400, 250)]),
    );
    for (const object of scene.objects) {
      expect(object.position.x).toBeGreaterThanOrEqual(scene.bounds.min.x);
      expect(object.position.x).toBeLessThanOrEqual(scene.bounds.max.x);
      expect(object.position.z).toBeGreaterThanOrEqual(scene.bounds.min.z);
      expect(object.position.z).toBeLessThanOrEqual(scene.bounds.max.z);
    }
  });

  it('is padded so links and labels are not clipped by the fit', () => {
    const scene = buildStructureScene(doc([node('a', 'action', 0, 0)]));
    expect(scene.bounds.max.x - scene.bounds.min.x).toBeGreaterThan(0);
    expect(scene.bounds.max.y).toBeGreaterThan(scene.bounds.min.y);
  });

  it('produces a usable box for an empty document', () => {
    const scene = buildStructureScene(doc([]));
    expect(scene.objects).toHaveLength(0);
    expect(scene.links).toHaveLength(0);
    // Degenerate but finite: the camera fit then still yields a sane frame.
    expect(Number.isFinite(scene.bounds.min.x)).toBe(true);
    expect(scene.bounds.max.x).toBeGreaterThan(scene.bounds.min.x);
  });

  it('grows the bounds when containers stack', () => {
    const flat = buildStructureScene(doc([node('a'), node('b')]));
    const nested = buildStructureScene(doc([node('a'), node('b', 'action', 0, 0, 'a')]));
    expect(nested.bounds.max.y).toBeGreaterThan(flat.bounds.max.y);
  });
});

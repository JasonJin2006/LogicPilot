import { describe, expect, it } from 'vitest';
import type { ModelDocument, ModelNode } from '@logicpilot/editor';
import { buildScene, buildSpatialScene, chooseGridCell } from '../src/spatialScene';
import { spatialGraphFromDocument } from '../src/spatialGraph';
import { buildStructureScene } from '../src/sceneModel';
import { NODE_FOOTPRINT } from '../src/layout3d';
import type { SceneDescription, SceneObject } from '../src/sceneModel';

function node(
  id: string,
  kind: string,
  name: string,
  params: Record<string, string | number | boolean> = {},
): ModelNode {
  return { id, kind, name, x: 0, y: 0, params };
}

function doc(nodes: ModelNode[], edges: ModelDocument['edges'] = []): ModelDocument {
  return { name: 'test', nodes, edges };
}

/** `examples/move_route.lp`: a 10x10 board with two 10-unit runs meeting at Depot,
 *  an emitter, a `moveTo` aimed at Bay, and a sink. */
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

function build(document: ModelDocument = moveRoute()): SceneDescription {
  const graph = spatialGraphFromDocument(document);
  if (graph === null) throw new Error('fixture is not spatial');
  return buildSpatialScene(document, graph);
}

function objectNamed(scene: SceneDescription, label: string): SceneObject {
  const found = scene.objects.find((object) => object.label === label);
  if (found === undefined) throw new Error(`no object labelled ${label}`);
  return found;
}

function railObjects(scene: SceneDescription): SceneObject[] {
  // Everything that is not spatial markup: the schematic strip.
  return scene.objects.filter((object) => object.kind !== 'node' && object.kind !== 'path');
}

describe('distance, chooseGridCell', () => {
  it('keeps a 1-unit cell while the count fits', () => {
    expect(chooseGridCell(10)).toBe(1);
    expect(chooseGridCell(59)).toBe(1);
  });

  it('grows the cell along 1-2-5 rather than exceeding the line budget', () => {
    // A ruler whose squares are 1.37 units long is not a ruler.
    expect(chooseGridCell(61)).toBe(2);
    expect(chooseGridCell(200)).toBe(5);
    expect(chooseGridCell(10_000)).toBe(200);
    // Every cell starts with 1, 2 or 5 - a decade step people read off a ruler,
    // not an arbitrary division of the extent.
    const leadingDigits = [1, 2, 5];
    for (const extent of [10, 61, 200, 1234, 10_000, 99_999]) {
      const cell = chooseGridCell(extent);
      expect(extent / cell).toBeLessThanOrEqual(60);
      expect(leadingDigits).toContain(Number(cell.toExponential(0).split('e')[0]));
    }
  });

  it('survives a degenerate or non-finite extent', () => {
    expect(chooseGridCell(0)).toBe(1);
    expect(chooseGridCell(-5)).toBe(1);
    expect(chooseGridCell(Number.NaN)).toBe(1);
  });
});

describe('spatial projection: the floor is the declared space', () => {
  it('places every node at its real coordinate, to scale', () => {
    const scene = build();
    const dock = objectNamed(scene, 'Dock');
    const depot = objectNamed(scene, 'Depot');
    const bay = objectNamed(scene, 'Bay');
    // The board is centred on the world origin, so absolute coordinates are not
    // preserved - the DISTANCES are, and those are what carry meaning.
    expect(depot.position.x - dock.position.x).toBeCloseTo(10, 12);
    expect(depot.position.z - dock.position.z).toBeCloseTo(0, 12);
    expect(bay.position.z - depot.position.z).toBeCloseTo(10, 12);
    expect(bay.position.x - depot.position.x).toBeCloseTo(0, 12);
    // Centred: the 10x10 board spans -5..5 on both floor axes.
    expect(dock.position.x).toBeCloseTo(-5, 12);
    expect(bay.position.z).toBeCloseTo(5, 12);
  });

  it('draws both nodes of a 10-unit run 10 units apart whatever the units mean', () => {
    const metres = build();
    // The same network written 100x larger. Every position and every length must
    // scale together, or the floor stops being a scale drawing.
    const millimetres = build(
      doc([
        node('n1', 'node', 'Dock', { x: 0, y: 0 }),
        node('n2', 'node', 'Depot', { x: 1000, y: 0 }),
        node('n3', 'node', 'Bay', { x: 1000, y: 1000 }),
        node('p1', 'path', 'Run1', { node1: 'Dock', node2: 'Depot' }),
        node('p2', 'path', 'Run2', { node1: 'Depot', node2: 'Bay' }),
      ]),
    );
    const span = (scene: SceneDescription): number => {
      const a = objectNamed(scene, 'Dock');
      const b = objectNamed(scene, 'Depot');
      return b.position.x - a.position.x;
    };
    const ratio = span(millimetres) / span(metres);
    // 100x the coordinates, but each board is centred on itself, so the drawn
    // span grows 100x while the board's own proportions stay identical.
    expect(ratio).toBeCloseTo(100, 9);
    expect(millimetres.spatial?.segments[0]?.length).toBe(1000);
    expect(metres.spatial?.segments[0]?.length).toBe(10);
    // Marker size is a fraction of the board, so it scales with it too.
    expect(millimetres.spatial?.markerDiameter).toBeCloseTo(
      (metres.spatial?.markerDiameter ?? 0) * 100,
      9,
    );
  });

  it('sizes every marker the same, as a stated fraction of the board', () => {
    const scene = build();
    const diameters = scene.objects
      .filter((object) => object.kind === 'node')
      .map((object) => object.size.x);
    expect(new Set(diameters).size).toBe(1);
    // 6% of the 10-unit shorter side. Conventional, and stated as such.
    expect(diameters[0]).toBeCloseTo(0.6, 9);
    expect(scene.spatial?.markerDiameter).toBeCloseTo(0.6, 9);
    // The footprint is not a modelled quantity, so the readout must not present it
    // as one.
    expect(scene.spatial?.modelUnitsPerWorldUnit).toBe(1);
  });

  it('keeps markers above the grid instead of z-fighting with it', () => {
    const scene = build();
    for (const object of scene.objects.filter((entry) => entry.kind === 'node')) {
      expect(object.position.y - object.size.y / 2).toBeGreaterThan(0);
    }
  });
});

describe('spatial projection: paths are ribbons of their real length', () => {
  it('draws each declared path at its true length, turned along the segment', () => {
    const scene = build();
    const run1 = objectNamed(scene, 'Run1');
    const run2 = objectNamed(scene, 'Run2');
    // A box's local +Z axis turned by yaw points along (sin yaw, 0, cos yaw).
    expect(run1.size.z).toBeCloseTo(10, 9);
    expect(run1.rotation?.y).toBeCloseTo(Math.PI / 2, 9); // along +X
    expect(run2.size.z).toBeCloseTo(10, 9);
    expect(run2.rotation?.y).toBeCloseTo(0, 9); // along +Z
    // Midpoint of the run, not one of its ends.
    expect(run1.position.x).toBeCloseTo(0, 9);
    expect(run1.position.z).toBeCloseTo(-5, 9);
    expect(run2.position.z).toBeCloseTo(0, 9);
  });

  it('reports the length the simulation travels, not the drawn extent', () => {
    const scene = build();
    expect(scene.spatial?.segments.map((segment) => [segment.name, segment.length])).toEqual([
      ['Run1', 10],
      ['Run2', 10],
    ]);
    expect(scene.spatial?.segments[0]?.fromName).toBe('Dock');
    expect(scene.spatial?.segments[0]?.toName).toBe('Depot');
  });

  it('turns a diagonal segment to the angle its endpoints define', () => {
    const scene = build(
      doc([
        node('a', 'node', 'A', { x: 0, y: 0 }),
        node('b', 'node', 'B', { x: 10, y: 10 }),
        node('p', 'path', 'Diag', { node1: 'A', node2: 'B' }),
      ]),
    );
    const diagonal = objectNamed(scene, 'Diag');
    expect(diagonal.rotation?.y).toBeCloseTo(Math.PI / 4, 9);
    expect(diagonal.size.z).toBeCloseTo(Math.hypot(10, 10), 9);
  });

  it('leaves no ribbon behind for coincident nodes', () => {
    // Two nodes at one coordinate make a path of zero length: there is no segment
    // to draw, and a zero-length scaled box is a rendering artefact, not a path.
    const scene = build(
      doc([
        node('a', 'node', 'A', { x: 1, y: 1 }),
        node('b', 'node', 'B', { x: 1, y: 1 }),
        node('p', 'path', 'Nothing', { node1: 'A', node2: 'B' }),
      ]),
    );
    expect(scene.objects.some((object) => object.label === 'Nothing')).toBe(false);
    expect(scene.spatial?.segments).toHaveLength(1); // the declaration is still read
  });

  it('marks spatial markup as understood instead of falling back', () => {
    const scene = build();
    expect(scene.objects.filter((object) => object.kind === 'node').every((o) => o.knownKind)).toBe(
      true,
    );
    expect(scene.objects.filter((object) => object.kind === 'path').every((o) => o.knownKind)).toBe(
      true,
    );
    // Reverse control: the fallback still exists for kinds nobody mapped.
    const unknown = build(
      doc([node('a', 'node', 'A', { x: 0, y: 0 }), node('b', 'paradigm-from-the-future', 'X')]),
    );
    expect(
      unknown.objects.find((object) => object.kind === 'paradigm-from-the-future')?.knownKind,
    ).toBe(false);
  });
});

describe('spatial projection: the rail beside the floor', () => {
  it('puts every non-spatial block on the rail, once', () => {
    const scene = build();
    expect(railObjects(scene).map((object) => object.label)).toEqual(['Jobs', 'Ship', 'Done']);
    // Spatial markup is drawn as the floor: drawing it again on the rail would
    // show two objects for one declaration.
    expect(scene.objects.filter((object) => object.kind === 'node')).toHaveLength(3);
    expect(scene.objects.filter((object) => object.kind === 'path')).toHaveLength(2);
    expect(scene.objects).toHaveLength(8);
  });

  it('places the rail clear of the board, not on top of it', () => {
    const scene = build();
    const floorMinZ = -5; // the 10-unit board, centred
    for (const object of railObjects(scene)) {
      expect(object.position.z + object.size.z / 2).toBeLessThan(floorMinZ);
    }
    // And every rail block sits at the same distance, so the strip reads as a line.
    expect(new Set(railObjects(scene).map((object) => object.position.z)).size).toBe(1);
  });

  it('lays the rail out by document order, centred on the board', () => {
    const scene = build();
    const rail = railObjects(scene);
    expect(rail.map((object) => object.position.x)).toEqual(
      [...rail.map((object) => object.position.x)].sort((a, b) => a - b),
    );
    // Centred: the rail block positions sum to zero around the board's centre.
    const total = rail.reduce((sum, object) => sum + object.position.x, 0);
    expect(total).toBeCloseTo(0, 9);
    // Evenly spaced, whatever the canvas did with those blocks: `source`, `moveTo`
    // and `sink` genuinely have no coordinates, so spacing is a stated convention.
    const gaps = rail
      .slice(1)
      .map((object, index) => object.position.x - (rail[index]?.position.x ?? 0));
    expect(new Set(gaps.map((gap) => Number(gap.toFixed(9)))).size).toBe(1);
  });

  it('keeps the coupling links between rail blocks and drops dangling ones', () => {
    const scene = build(
      doc(moveRoute().nodes, [
        { id: 'e1', from: 'b1', to: 'b2' },
        { id: 'e2', from: 'b2', to: 'b3' },
        { id: 'dangling', from: 'b3', to: 'missing' },
      ]),
    );
    expect(scene.links.map((link) => link.id)).toEqual(['e1', 'e2']);
  });

  it('lifts a nested block above the rail, keeping container depth visible', () => {
    const flat = build();
    const nested = build(
      doc([
        ...moveRoute().nodes,
        { ...node('b4', 'action', 'Inside'), containerId: 'b1', container: 'Jobs' },
      ]),
    );
    const railHeight = (scene: SceneDescription, label: string): number =>
      objectNamed(scene, label).position.y;
    expect(railHeight(nested, 'Inside')).toBeGreaterThan(railHeight(nested, 'Jobs'));
    expect(railHeight(flat, 'Jobs')).toBeCloseTo(railHeight(nested, 'Jobs'), 9);
  });

  it('uses the rectangular block footprint for the rail, not the marker size', () => {
    // The strip is schematic, so it keeps the block language legible instead of
    // shrinking to the floor's marker scale.
    const scene = build();
    for (const object of railObjects(scene)) {
      expect(object.size.x).toBe(NODE_FOOTPRINT);
      expect(object.rotation).toBeUndefined();
    }
  });
});

describe('spatial projection: the bridge from a step to its place', () => {
  it('connects a step to the node it targets', () => {
    const scene = build();
    const bridges = scene.spatial?.bridges ?? [];
    expect(bridges.map((bridge) => [bridge.from, bridge.to])).toEqual([['b2', 'n3']]);
    const bridge = bridges[0];
    const ship = objectNamed(scene, 'Ship');
    const bay = objectNamed(scene, 'Bay');
    expect(bridge?.from3.z).toBeCloseTo(ship.position.z + NODE_FOOTPRINT / 2, 9);
    expect(bridge?.to3.x).toBeCloseTo(bay.position.x, 9);
    expect(bridge?.to3.z).toBeCloseTo(bay.position.z, 9);
    // It stays out of the coupling links: a destination is not a flow connection,
    // and folding it in would make "Links" mean two different things.
    expect(scene.links.some((link) => link.to === 'n3')).toBe(false);
  });

  it('draws no bridge for a model with no anchored step', () => {
    const scene = build(doc([node('a', 'node', 'A', { x: 0, y: 0 }), node('b', 'source', 'Feed')]));
    expect(scene.spatial?.bridges).toEqual([]);
  });
});

describe('spatial projection: the grid states the scale', () => {
  it('covers the board with cells of a round size', () => {
    const scene = build();
    const floor = scene.spatial?.floor;
    expect(floor?.cell).toBe(1);
    expect(floor?.divisions).toBe(12); // 10 units of board plus one cell of slack
    expect((floor?.divisions ?? 0) * (floor?.cell ?? 0)).toBeCloseTo(floor?.width ?? 0, 9);
  });

  it('still frames a board whose nodes all sit at one point', () => {
    const scene = build(doc([node('a', 'node', 'Only', { x: 4, y: 4 })]));
    expect(scene.spatial?.markerDiameter).toBeGreaterThan(0);
    expect(scene.spatial?.floor.divisions).toBeGreaterThanOrEqual(1);
    expect(scene.bounds.max.x).toBeGreaterThan(scene.bounds.min.x);
  });
});

describe('spatial projection: framing and determinism', () => {
  it('bounds everything it draws, floor and rail alike', () => {
    const scene = build();
    for (const object of scene.objects) {
      expect(object.position.x).toBeGreaterThanOrEqual(scene.bounds.min.x);
      expect(object.position.x).toBeLessThanOrEqual(scene.bounds.max.x);
      expect(object.position.z).toBeGreaterThanOrEqual(scene.bounds.min.z);
      expect(object.position.z).toBeLessThanOrEqual(scene.bounds.max.z);
    }
    // The floor is framed even where no object sits on it, or the ruler would fall
    // outside the view on a network with no paths.
    const grid = (scene.spatial?.floor.width ?? 0) / 2;
    expect(scene.bounds.max.x).toBeGreaterThanOrEqual(grid);
  });

  it('frames a rail that would otherwise push the board out of view', () => {
    const scene = build();
    for (const bridge of scene.spatial?.bridges ?? []) {
      for (const point of [bridge.from3, bridge.to3]) {
        expect(point.z).toBeGreaterThanOrEqual(scene.bounds.min.z);
        expect(point.z).toBeLessThanOrEqual(scene.bounds.max.z);
      }
    }
  });

  it('is deterministic and does not mutate the document', () => {
    const document = moveRoute();
    const before = JSON.stringify(document);
    expect(build(document)).toEqual(build(document));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('does not depend on selection', () => {
    expect(JSON.stringify(build())).not.toContain('selected');
  });
});

describe('buildScene picks the reading of the document', () => {
  it('uses the floor when the model declares a spatial graph', () => {
    const scene = buildScene(moveRoute());
    expect(scene.spatial).toBeDefined();
    expect(scene.spatial?.markerCount).toBe(3);
  });

  it('falls back to the structural lift when it does not', () => {
    // A `path` with no `node` cannot make a floor: there are no coordinates to
    // draw it from, and the structural view is honest about that.
    const pathsOnly = doc([
      node('a', 'path', 'Run', { node1: 'X', node2: 'Y' }),
      node('b', 'source', 'Jobs'),
    ]);
    const scene = buildScene(pathsOnly);
    expect(scene.spatial).toBeUndefined();
    expect(scene).toEqual(buildStructureScene(pathsOnly));
  });

  it('leaves a non-spatial model exactly as the structural projection built it', () => {
    const plain = doc(
      [node('a', 'queue'), node('b', 'service')],
      [{ id: 'e', from: 'a', to: 'b' }],
    );
    expect(buildScene(plain)).toEqual(buildStructureScene(plain));
  });

  it('passes the margin option through both readings', () => {
    const document = moveRoute();
    const wide = buildScene(document, { margin: 20 });
    const graph = spatialGraphFromDocument(document);
    expect(wide.bounds.max.x).toBeCloseTo(
      buildSpatialScene(document, graph!, { margin: 20 }).bounds.max.x,
      9,
    );
    expect(wide.bounds.max.x).toBeGreaterThan(buildScene(document).bounds.max.x);
  });
});

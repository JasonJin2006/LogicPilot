// The real DSL file, through the real parser, into the real projection.
//
// The scene3d package's own tests build documents by hand, which pins the
// projection but not the handover: they would keep passing if `parseDsl` stored
// coordinates under a different parameter name, or if it stopped reading
// `node`/`path` at all. This test closes that gap with the repository's actual
// spatial example, so the chain the user sees - source text to floor geometry - is
// covered end to end.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDsl } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import { buildScene, buildStructureScene } from '@logicpilot/scene3d';

function parse(relative: string): ModelDocument {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const parsed = parseDsl(source);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.error ?? 'unknown'}`);
  return parsed.document;
}

const moveRoute = parse('../../../../../examples/move_route.lp');
const mm1 = parse('../../../../../examples/mm1.lp');

function objectNamed(label: string) {
  const scene = buildScene(moveRoute);
  const found = scene.objects.find((object) => object.label === label);
  if (found === undefined) throw new Error(`no object labelled ${label}`);
  return found;
}

describe('examples/move_route.lp reaches the floor', () => {
  it('is recognised as a spatial model', () => {
    const scene = buildScene(moveRoute);
    expect(scene.spatial).toBeDefined();
    expect(scene.spatial?.markerCount).toBe(3);
    expect(scene.spatial?.segments.map((segment) => segment.name)).toEqual(['Run1', 'Run2']);
    // A well-formed example: nothing dropped, and it declares no z.
    expect(scene.spatial?.issueCount).toBe(0);
    expect(scene.spatial?.usesZ).toBe(false);
  });

  it('draws the declared coordinates, not the canvas layout', () => {
    // This is the whole point of the change. `parseDsl` gives every member a
    // synthetic canvas position on a grid (`160 + (order % 8) * 180`), and lifting
    // that produced an extruded flowchart. The DSL's own numbers are the L-shape
    // Dock -> Depot -> Bay, and only those produce it.
    const dock = objectNamed('Dock');
    const depot = objectNamed('Depot');
    const bay = objectNamed('Bay');

    expect(depot.position.x - dock.position.x).toBeCloseTo(10, 9);
    expect(depot.position.z - dock.position.z).toBeCloseTo(0, 9);
    expect(bay.position.x - depot.position.x).toBeCloseTo(0, 9);
    expect(bay.position.z - depot.position.z).toBeCloseTo(10, 9);

    // Reverse control: the canvas grid would put all three in one row at a fixed
    // pitch, so these two gaps would be equal. They are not.
    const firstGap = depot.position.x - dock.position.x;
    const secondGapX = bay.position.x - depot.position.x;
    expect(Math.abs(firstGap - secondGapX)).toBeGreaterThan(1);
  });

  it('draws each run at its true length', () => {
    const scene = buildScene(moveRoute);
    expect(
      scene.spatial?.segments.map((segment) => [segment.fromName, segment.toName, segment.length]),
    ).toEqual([
      ['Dock', 'Depot', 10],
      ['Depot', 'Bay', 10],
    ]);
    // The ribbons agree with the reported lengths.
    expect(objectNamed('Run1').size.z).toBeCloseTo(10, 9);
    expect(objectNamed('Run2').size.z).toBeCloseTo(10, 9);
  });

  it('reads every block in the example as understood', () => {
    // Before this change six of these eight blocks fell into the unknown-kind
    // fallback (three `node`, two `path` and the `moveTo`), which is what made the
    // pane look like a generic box diagram.
    const scene = buildScene(moveRoute);
    expect(scene.objects).toHaveLength(8);
    expect(scene.objects.filter((object) => !object.knownKind)).toEqual([]);
  });

  it('anchors the moveTo step to the node it targets', () => {
    const scene = buildScene(moveRoute);
    const ship = moveRoute.nodes.find((node) => node.name === 'Ship');
    const bay = moveRoute.nodes.find((node) => node.name === 'Bay');
    expect(scene.spatial?.bridges.map((bridge) => [bridge.from, bridge.to])).toEqual([
      [ship?.id, bay?.id],
    ]);
  });

  it('keeps every scene id equal to its model node id, so picking round-trips', () => {
    // A click on the floor marker has to select the `node Dock` block, or the 3D
    // view stops being connected to the model.
    const scene = buildScene(moveRoute);
    const ids = new Set(moveRoute.nodes.map((node) => node.id));
    for (const object of scene.objects) {
      expect(ids.has(object.id)).toBe(true);
    }
    expect(scene.objects.map((object) => object.id).sort()).toEqual([...ids].sort());
  });

  it('sizes markers off the board so the readout can state them', () => {
    const scene = buildScene(moveRoute);
    // 10 x 10 board: one unit per world unit, a 1-unit grid, 6% markers.
    expect(scene.spatial?.extent).toEqual({ width: 10, depth: 10 });
    expect(scene.spatial?.modelUnitsPerWorldUnit).toBe(1);
    expect(scene.spatial?.floor.cell).toBe(1);
    expect(scene.spatial?.markerDiameter).toBeCloseTo(0.6, 9);
  });
});

describe('a model without spatial markup is untouched', () => {
  it('keeps the structural projection for examples/mm1.lp', () => {
    // mm1.lp declares no `node`/`path`, so it must behave exactly as before this
    // change - same objects, same bounds, no floor.
    const scene = buildScene(mm1);
    expect(scene.spatial).toBeUndefined();
    expect(scene).toEqual(buildStructureScene(mm1));
    expect(scene.objects).toHaveLength(mm1.nodes.length);
    // And the 2D couplings survive into the links.
    expect(scene.links).toHaveLength(3);
  });
});

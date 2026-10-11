// Spatial model -> 3D scene: the floor the simulation travels on, plus the
// process blocks as a schematic strip beside it.
//
// The structural projection (`sceneModel.ts`) lifts the canvas's own layout. That
// is the wrong input for a model that declares real coordinates: the canvas x/y is
// a layout the editor invents, so extruding it produces a flowchart with thickness
// and nothing more. A model with `node`/`path`/`moveTo` markup says where things
// are, and that is what this file draws.
//
// Two layers, deliberately separate:
//
//   * **The floor** is the declared space, drawn to scale: every `node` is a
//     marker at its real coordinate, every `path` a ribbon of its real length,
//     and a unit grid sits under them so the scale can be counted rather than
//     taken on trust.
//   * **The rail** is the process flow, moved out in front of the floor and laid
//     out at a fixed spacing. It keeps the schematic language (blocks, couplings)
//     legible without pretending those blocks have coordinates - `source` and
//     `sink` genuinely have none.
//
// The bridge between the two is `moveTo Ship { node = Bay }`: a line from the step
// on the rail to the place on the floor. That single line is the whole reason the
// two layers belong in one view.
//
// What is true and what is conventional, stated plainly because the difference
// matters when reading the picture:
//
//   * **True:** every marker position, and every path length, in model units,
//     scaled 1:1 into world units.
//   * **Conventional:** marker diameter and path width. The DSL declares
//     positions, not footprints, so there is no modelled size to draw. They are a
//     fixed fraction of the board so they stay legible at any coordinate range,
//     and the panel reports them as conventional rather than implying a size the
//     model never stated.
//   * **Not placed:** `z`. The kernel's spatial model is two-dimensional
//     (`NodePos` is `{x, y}`), so the view draws the network flat and reports
//     `usesZ` for the panel to state. Drawing a height the simulation does not
//     have would be a prettier lie.

import type { ModelDocument } from '@logicpilot/editor';
import { boundsOf, expandBounds, vec3, type Bounds3, type Vec3 } from './math3d.js';
import {
  layoutDocument,
  nodeVisualBounds,
  LEVEL_HEIGHT,
  NODE_FOOTPRINT,
  NODE_HEIGHT,
} from './layout3d.js';
import {
  SPATIAL_PATH_KIND,
  SPATIAL_NODE_KIND,
  spatialGraphFromDocument,
  type SpatialGraph,
} from './spatialGraph.js';
import {
  SCENE_BOUNDS_MARGIN,
  visualForKind,
  buildStructureScene,
  type SceneDescription,
  type SceneLink,
  type SceneObject,
  type SpatialLayer,
  type SpatialSegment,
  type StructureSceneOptions,
} from './sceneModel.js';

/** Model units are world units. Kept as a named constant rather than a bare 1 so
 *  the convention is stated once and a test can hold it: the floor is a ruler,
 *  and a ruler that silently rescales is worthless. */
export const SPATIAL_WORLD_UNITS_PER_MODEL_UNIT = 1;

/** Marker diameter and path width as a fraction of the board's smaller side.
 *
 * Footprints are not a modelled quantity - `node Dock { x = 0 }` says where Dock
 * is, never how big it is - so the size is a legibility choice, and tying it to
 * the board keeps a network written in millimetres as readable as one written in
 * metres. The floors stop a tiny or degenerate board from drawing sub-pixel
 * geometry. */
export const SPATIAL_MARKER_EXTENT_FRACTION = 0.06;
export const SPATIAL_PATH_EXTENT_FRACTION = 0.02;
export const SPATIAL_MIN_MARKER_DIAMETER = 0.15;
export const SPATIAL_MIN_PATH_WIDTH = 0.05;

/** Marker height and ribbon thickness, as a fraction of their own width. */
const MARKER_HEIGHT_FRACTION = 0.25;
const RIBBON_THICKNESS_FRACTION = 0.25;
/** Smallest marker height / ribbon thickness, so a flat disc is still a solid. */
const MIN_MARKER_HEIGHT = 0.04;
const MIN_RIBBON_THICKNESS = 0.02;

/** Gap between the grid plane and the geometry resting on it. Coplanar faces
 *  z-fight, and a flickering floor reads as a rendering fault. */
export const SPATIAL_FLOOR_CLEARANCE = 0.02;

/** The schematic strip sits this far in front of the floor's near edge, measured
 *  from edge to edge so a nested container on the rail cannot overlap the board. */
export const SPATIAL_RAIL_GAP = 2.6;
/** Rail block pitch. Wider than the footprint so labels stay readable. */
export const SPATIAL_RAIL_SPACING = NODE_FOOTPRINT * 1.35;

/** Grid cell size in world units. One cell per model unit makes the floor a
 *  countable ruler; on a board too large for that, the CELL grows along the
 *  1-2-5 progression rather than the line count, so a square is always a round
 *  number of units and the readout can state it. */
export const SPATIAL_GRID_CELL = 1;
export const MAX_GRID_DIVISIONS = 60;

/** Largest 1-2-5-progression cell that keeps a grid over `extent` within
 *  `maxDivisions` lines. A ruler whose squares are 1.37 units long is not a
 *  ruler, so the cell grows instead of the line count. */
export function chooseGridCell(extent: number, maxDivisions: number = MAX_GRID_DIVISIONS): number {
  if (!Number.isFinite(extent) || extent <= 0) return SPATIAL_GRID_CELL;
  // 2, 2.5, 2 repeats to give 1, 2, 5, 10, 20, 50, 100 - the decade steps people
  // read off a ruler. A two-step cycle would produce 25 and 125 instead.
  const steps = [2, 2.5, 2];
  let cell = SPATIAL_GRID_CELL;
  for (let index = 0; extent / cell > maxDivisions; index += 1) {
    cell *= steps[index % steps.length] ?? 2;
    if (cell > extent) return cell;
  }
  return cell;
}

/** Charting surface used when a board has no extent at all (a single node, or
 *  every node at the same coordinate). Without it the fractions above collapse to
 *  zero and nothing is drawn. */
const DEGENERATE_EXTENT = 1;

export function buildScene(
  document: ModelDocument,
  options: StructureSceneOptions = {},
): SceneDescription {
  const graph = spatialGraphFromDocument(document);
  if (graph === null) return buildStructureScene(document, options);
  return buildSpatialScene(document, graph, options);
}

export function buildSpatialScene(
  document: ModelDocument,
  graph: SpatialGraph,
  options: StructureSceneOptions = {},
): SceneDescription {
  const scale = SPATIAL_WORLD_UNITS_PER_MODEL_UNIT;
  const reference =
    Math.max(Math.min(graph.extent.width, graph.extent.depth), DEGENERATE_EXTENT) * scale;

  const markerDiameter = Math.max(
    reference * SPATIAL_MARKER_EXTENT_FRACTION,
    SPATIAL_MIN_MARKER_DIAMETER,
  );
  const markerHeight = Math.max(markerDiameter * MARKER_HEIGHT_FRACTION, MIN_MARKER_HEIGHT);
  const pathWidth = Math.max(reference * SPATIAL_PATH_EXTENT_FRACTION, SPATIAL_MIN_PATH_WIDTH);
  const ribbonThickness = Math.max(pathWidth * RIBBON_THICKNESS_FRACTION, MIN_RIBBON_THICKNESS);

  // The board is centred on the world origin. Absolute model coordinates are not
  // preserved as world positions on purpose: the world is a viewing frame, and
  // centring means orbiting turns around the network instead of swinging it out of
  // view. Relative positions - the thing that carries meaning - are exact.
  const centerX = (graph.extent.minX + graph.extent.maxX) / 2;
  const centerY = (graph.extent.minY + graph.extent.maxY) / 2;
  const toWorld = (x: number, y: number): Vec3 =>
    vec3((x - centerX) * scale, 0, (y - centerY) * scale);

  const objects: SceneObject[] = [];
  const boxes: Bounds3[] = [];
  const objectIds = new Set<string>();
  const markerWorld = new Map<string, Vec3>();

  // --- floor: markers ---------------------------------------------------------
  for (const node of graph.nodes) {
    const world = toWorld(node.x, node.y);
    const placed = vec3(world.x, SPATIAL_FLOOR_CLEARANCE + markerHeight / 2, world.z);
    markerWorld.set(node.id, placed);
    const { visual } = visualForKind(SPATIAL_NODE_KIND);
    objects.push({
      id: node.id,
      label: node.name,
      kind: SPATIAL_NODE_KIND,
      knownKind: true,
      shape: visual.shape,
      colorKey: visual.colorKey,
      position: placed,
      size: vec3(markerDiameter, markerHeight, markerDiameter),
      depth: 0,
    });
    objectIds.add(node.id);
    boxes.push(nodeVisualBounds(placed, vec3(markerDiameter, markerHeight, markerDiameter)));
  }

  // --- floor: path ribbons ----------------------------------------------------
  const segments: SpatialSegment[] = [];
  for (const path of graph.paths) {
    const from = markerWorld.get(path.from);
    const to = markerWorld.get(path.to);
    if (from === undefined || to === undefined) continue;
    const deltaX = to.x - from.x;
    const deltaZ = to.z - from.z;
    const ribbonLength = Math.hypot(deltaX, deltaZ);
    // The declaration is recorded whatever happens: a path the model declares and
    // the view does not count would read as a path that vanished.
    segments.push({
      id: path.id,
      name: path.name,
      from: path.from,
      to: path.to,
      fromName: path.fromName,
      toName: path.toName,
      length: path.length,
    });
    // Coincident nodes leave nothing to draw, and a zero-length scaled box is a
    // rendering artefact rather than a path.
    if (ribbonLength < 1e-9) continue;
    // A box's local +Z axis, turned by yaw about +Y, points along
    // (sin yaw, 0, cos yaw) - so this yaw lies the ribbon along the segment.
    const yaw = Math.atan2(deltaX, deltaZ);
    const placed = vec3(
      (from.x + to.x) / 2,
      SPATIAL_FLOOR_CLEARANCE + ribbonThickness / 2,
      (from.z + to.z) / 2,
    );
    const size = vec3(pathWidth, ribbonThickness, ribbonLength);
    const { visual } = visualForKind(SPATIAL_PATH_KIND);
    objects.push({
      id: path.id,
      label: path.name,
      kind: SPATIAL_PATH_KIND,
      knownKind: true,
      shape: visual.shape,
      colorKey: visual.colorKey,
      position: placed,
      size,
      rotation: vec3(0, yaw, 0),
      depth: 0,
    });
    objectIds.add(path.id);
    // An axis-aligned box covering the ribbon, rather than the ribbon's own box:
    // a rotated box's AABB would need its corners, and the covering box is what
    // the bounds want anyway.
    boxes.push(
      boundsOf([
        vec3(from.x, placed.y - ribbonThickness, from.z),
        vec3(to.x, placed.y + ribbonThickness, to.z),
      ]),
    );
  }

  // --- the rail: every block that is not spatial markup -----------------------
  const layout = layoutDocument(document);
  const railBlocks = document.nodes.filter(
    (node) => node.kind !== SPATIAL_NODE_KIND && node.kind !== SPATIAL_PATH_KIND,
  );
  const railZ = -(graph.extent.depth * scale) / 2 - SPATIAL_RAIL_GAP - NODE_FOOTPRINT / 2;
  const railY = SPATIAL_FLOOR_CLEARANCE + NODE_HEIGHT / 2;
  const railPosition = new Map<string, Vec3>();
  for (const [index, node] of railBlocks.entries()) {
    const offset = (index - (railBlocks.length - 1) / 2) * SPATIAL_RAIL_SPACING;
    const depth = layout.get(node.id)?.depth ?? 0;
    const placed = vec3(offset, railY + depth * LEVEL_HEIGHT, railZ);
    railPosition.set(node.id, placed);
    const { visual, knownKind } = visualForKind(node.kind);
    const size = vec3(NODE_FOOTPRINT, NODE_HEIGHT, NODE_FOOTPRINT);
    objects.push({
      id: node.id,
      label: node.name,
      kind: node.kind,
      knownKind,
      shape: visual.shape,
      colorKey: visual.colorKey,
      position: placed,
      size,
      depth,
    });
    objectIds.add(node.id);
    boxes.push(nodeVisualBounds(placed, size));
  }

  // --- bridges: a step to the place it acts on --------------------------------
  const bridgeY = SPATIAL_FLOOR_CLEARANCE * 2;
  const bridges: SpatialLayer['bridges'] = [];
  for (const anchor of graph.anchors) {
    const fromBlock = railPosition.get(anchor.blockId);
    const target = markerWorld.get(anchor.nodeId);
    if (fromBlock === undefined || target === undefined) continue;
    bridges.push({
      id: `spatial-bridge:${anchor.blockId}`,
      from: anchor.blockId,
      to: anchor.nodeId,
      from3: vec3(fromBlock.x, bridgeY, fromBlock.z + NODE_FOOTPRINT / 2),
      to3: vec3(target.x, bridgeY, target.z),
    });
  }

  // --- couplings between rail blocks ------------------------------------------
  // A coupling whose endpoint is spatial markup still lands on a floor mesh, and
  // that is correct rather than a special case: the line then shows the step
  // reaching into the space.
  const links: SceneLink[] = [];
  for (const edge of document.edges) {
    if (!objectIds.has(edge.from) || !objectIds.has(edge.to)) continue;
    links.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.fromPort !== undefined ? { fromPort: edge.fromPort } : {}),
      ...(edge.toPort !== undefined ? { toPort: edge.toPort } : {}),
    });
  }

  const floorWidth = graph.extent.width * scale;
  const floorDepth = graph.extent.depth * scale;
  // A square grid (a grid helper is square) at least as large as the board, with
  // one cell of slack so the outermost markers do not sit on the grid's edge.
  const cell = chooseGridCell(Math.max(floorWidth, floorDepth));
  const divisions = Math.max(1, Math.ceil((Math.max(floorWidth, floorDepth) + 2 * cell) / cell));
  const gridSize = divisions * cell;

  const spatial: SpatialLayer = {
    markerCount: graph.nodes.length,
    segments,
    bridges,
    modelUnitsPerWorldUnit: 1 / scale,
    markerDiameter,
    pathWidth,
    floor: {
      width: gridSize,
      depth: gridSize,
      center: vec3(0, 0, 0),
      cell,
      divisions,
    },
    extent: { width: graph.extent.width, depth: graph.extent.depth },
    usesZ: graph.usesZ,
    issueCount: graph.issues.length,
  };

  // The floor is part of what must be framed even though the grid is not a scene
  // object: a network with no paths would otherwise be framed by its markers alone
  // and the ruler would fall outside the view.
  const gridHalfWidth = spatial.floor.width / 2;
  const gridHalfDepth = spatial.floor.depth / 2;
  boxes.push(
    boundsOf([vec3(-gridHalfWidth, 0, -gridHalfDepth), vec3(gridHalfWidth, 0, gridHalfDepth)]),
  );

  return {
    objects,
    links,
    spatial,
    bounds: expandBounds(
      boundsOf(boxes.length > 0 ? boxes.flatMap((box) => [box.min, box.max]) : []),
      options.margin ?? SCENE_BOUNDS_MARGIN,
    ),
  };
}

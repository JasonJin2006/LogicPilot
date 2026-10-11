// Model document -> 3D scene description.
//
// This is the only place that decides what the 3D view shows. It is pure: same
// document in, same description out, no renderer and no engine types. That is
// what lets the projection be tested exhaustively in Node while the actual
// drawing stays a thin translation in the app.
//
// Selection is deliberately NOT part of the description. Selection is view
// state, not content: folding it in would rebuild every object's geometry on
// each click. The renderer applies `selectedId` to materials instead.

import type { ModelDocument } from '@logicpilot/editor';
import { boundsOf, expandBounds, type Bounds3, type Vec3 } from './math3d.js';
import { layoutDocument, nodeVisualBounds, type NodeLayout } from './layout3d.js';

export type SceneShape = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus';

export interface SceneObject {
  /** Scene id; currently the model node id. */
  id: string;
  label: string;
  /** The model's `kind`, kept verbatim so an unmapped kind is still shown. */
  kind: string;
  /** False when this kind has no entry in the visual table and the generic
   *  shape is being substituted. The renderer surfaces that instead of
   *  pretending the kind is understood. */
  knownKind: boolean;
  shape: SceneShape;
  colorKey: string;
  position: Vec3;
  size: Vec3;
  /** Euler rotation in radians. Used by the spatial layer, where a path is a
   *  ribbon of real length that has to be turned to lie along its segment;
   *  absent means axis-aligned, which is every structural node. */
  rotation?: Vec3;
  /** Nesting level, for callers that want to draw level guides. */
  depth: number;
}

export interface SceneLink {
  id: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
}

export interface SceneDescription {
  objects: SceneObject[];
  links: SceneLink[];
  /** Bounds of everything drawn, already padded. */
  bounds: Bounds3;
  /** Present only when the model declares a spatial graph (`node`/`path`
   *  markup). Absent means the structural projection is all there is. */
  spatial?: SpatialLayer;
}

/** One declared path segment, with the length the simulation actually travels.
 *
 * The length is the kernel's edge weight - Euclidean in the X/Y plane - so it is
 * the distance a `moveTo` spends time covering, not the length of the drawn
 * ribbon (which can differ when a model declares `z`). */
export interface SpatialSegment {
  /** Model node id of the `path` block, so a pick round-trips to the canvas. */
  id: string;
  name: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  length: number;
}

/** A line from a spatial step to the place it acts on (`moveTo Ship { node = Bay }`).
 *
 * Drawn apart from the coupling links on purpose: a destination is not a flow
 * connection, and folding it into `links` would make "Links" mean two things. */
export interface SpatialBridge {
  id: string;
  /** Model node id of the block (a rail block, i.e. not a `node`/`path`). */
  from: string;
  /** Model node id of the target `node` block. */
  to: string;
  from3: Vec3;
  to3: Vec3;
}

/** What the renderer needs beyond the marker meshes: the floor to put under them,
 *  the bridges, and the numbers the panel reports. */
export interface SpatialLayer {
  /** `node` markers drawn on the floor. Their meshes are in `objects` (kind
   *  `node`); this is the count the readout needs. */
  markerCount: number;
  segments: SpatialSegment[];
  bridges: SpatialBridge[];
  /** Model units per world unit. 1 means the DSL's own numbers are world units
   *  and the floor can be counted against the grid. */
  modelUnitsPerWorldUnit: number;
  /** Conventional marker diameter and path width, in world units. Node
   *  footprints are not a modelled quantity - the DSL declares positions, not
   *  sizes - so these are chosen for legibility and stated as conventional,
   *  while positions and path lengths stay true. */
  markerDiameter: number;
  pathWidth: number;
  /** Floor extent in world units, and the grid to draw it as a ruler. */
  floor: {
    width: number;
    depth: number;
    center: Vec3;
    /** Grid cell size in world units, so squares stay countable. */
    cell: number;
    divisions: number;
  };
  /** Model-space board size, for the readout. */
  extent: { width: number; depth: number };
  /** True when the model declares a non-zero `z`, which the view draws but the
   *  kernel's 2D path solver ignores. The panel says so rather than letting the
   *  discrepancy be discovered later. */
  usesZ: boolean;
  /** Spatial declarations that could not be used (unknown node references...).
   *  Reported, never silently dropped. */
  issueCount: number;
}

interface KindVisual {
  shape: SceneShape;
  colorKey: string;
}

/** Visual interest table: `kind` -> shape and palette key.
 *
 * This is NOT an exhaustive registry of block kinds, and it is not meant to be
 * kept in sync with the palette. `BlockKind` is an open string, the DSL can
 * introduce kinds the palette never had, and a model may reference a kind from
 * a plugin that is not installed — so an unknown kind must be a normal outcome.
 * Anything absent here renders as a generic box carrying its raw kind in the
 * label, with `knownKind: false`.
 *
 * The buckets below are the ones where a distinct 3D shape says something at a
 * glance: an emitter is a cone, a buffer is a tube, a behavioural unit is a
 * sphere, a loop is a ring.
 */
const KIND_VISUALS: Readonly<Record<string, KindVisual>> = {
  // Emitters.
  source: { shape: 'cone', colorKey: 'process' },
  event: { shape: 'cone', colorKey: 'event' },
  dynamicEvent: { shape: 'cone', colorKey: 'event' },
  schedule: { shape: 'cone', colorKey: 'event' },
  linkToAgents: { shape: 'cone', colorKey: 'agent' },

  // Buffers and holdings.
  queue: { shape: 'cylinder', colorKey: 'buffer' },
  collection: { shape: 'cylinder', colorKey: 'buffer' },
  dataSet: { shape: 'cylinder', colorKey: 'data' },
  variable: { shape: 'cylinder', colorKey: 'data' },
  localVariable: { shape: 'cylinder', colorKey: 'data' },
  parameter: { shape: 'cylinder', colorKey: 'data' },
  histogram: { shape: 'cylinder', colorKey: 'chart' },
  histogramData: { shape: 'cylinder', colorKey: 'chart' },
  histogram2D: { shape: 'cylinder', colorKey: 'chart' },
  histogram2DData: { shape: 'cylinder', colorKey: 'chart' },
  stackChart: { shape: 'cylinder', colorKey: 'chart' },

  // Behavioural units.
  resource: { shape: 'sphere', colorKey: 'resource' },
  function: { shape: 'sphere', colorKey: 'behaviour' },
  tableFunction: { shape: 'sphere', colorKey: 'behaviour' },
  statistics: { shape: 'sphere', colorKey: 'behaviour' },
  pieChart: { shape: 'sphere', colorKey: 'chart' },

  // Cyclic / jump flow.
  forLoop: { shape: 'torus', colorKey: 'control' },
  whileLoop: { shape: 'torus', colorKey: 'control' },
  doWhileLoop: { shape: 'torus', colorKey: 'control' },
  return: { shape: 'torus', colorKey: 'control' },
  break: { shape: 'torus', colorKey: 'control' },
  transition: { shape: 'torus', colorKey: 'control' },

  // Terminal.
  sink: { shape: 'box', colorKey: 'terminal' },
  finalState: { shape: 'box', colorKey: 'terminal' },
  historyState: { shape: 'box', colorKey: 'terminal' },

  // States and decisions.
  state: { shape: 'box', colorKey: 'state' },
  initialStatePointer: { shape: 'box', colorKey: 'state' },
  statechartEntryPoint: { shape: 'box', colorKey: 'state' },
  decision: { shape: 'box', colorKey: 'decision' },
  branch: { shape: 'box', colorKey: 'decision' },

  // Spatial markup. These get their geometry from the spatial projection (a
  // marker stands on the floor, a path is a ribbon turned along its segment), but
  // they are listed so the view never reports them as kinds it does not
  // understand - it reads exactly what they mean.
  node: { shape: 'cylinder', colorKey: 'spatialNode' },
  path: { shape: 'box', colorKey: 'spatialPath' },
  moveTo: { shape: 'box', colorKey: 'process' },

  // Generic processing.
  action: { shape: 'box', colorKey: 'process' },
  service: { shape: 'box', colorKey: 'process' },
  delay: { shape: 'box', colorKey: 'process' },
  connector: { shape: 'box', colorKey: 'process' },
  port: { shape: 'box', colorKey: 'process' },
  output: { shape: 'box', colorKey: 'process' },
  progressBar: { shape: 'box', colorKey: 'process' },

  // Charts and widgets render as flat cards; the 3D view is not their home,
  // but they exist in models and must not vanish.
  plot: { shape: 'box', colorKey: 'chart' },
  timePlot: { shape: 'box', colorKey: 'chart' },
  timeStackChart: { shape: 'box', colorKey: 'chart' },
  timeColorChart: { shape: 'box', colorKey: 'chart' },
  barChart: { shape: 'box', colorKey: 'chart' },
  button: { shape: 'box', colorKey: 'widget' },
  slider: { shape: 'box', colorKey: 'widget' },
  checkBox: { shape: 'box', colorKey: 'widget' },
  radioButtons: { shape: 'box', colorKey: 'widget' },
  comboBox: { shape: 'box', colorKey: 'widget' },
  editBox: { shape: 'box', colorKey: 'widget' },
  listBox: { shape: 'box', colorKey: 'widget' },
  fileChooser: { shape: 'box', colorKey: 'widget' },
  customDistribution: { shape: 'box', colorKey: 'data' },

  // Containers.
  statechart: { shape: 'box', colorKey: 'container' },
};

const FALLBACK_VISUAL: KindVisual = { shape: 'box', colorKey: 'unknown' };

/** Padding added around the content bounds so links and labels are not clipped
 *  by the fit. */
export const SCENE_BOUNDS_MARGIN = 2;

export function visualForKind(kind: string): { visual: KindVisual; knownKind: boolean } {
  const visual = KIND_VISUALS[kind];
  if (visual === undefined) return { visual: FALLBACK_VISUAL, knownKind: false };
  return { visual, knownKind: true };
}

export interface StructureSceneOptions {
  /** Overrides the scene bounds margin. */
  margin?: number;
}

export function buildStructureScene(
  document: ModelDocument,
  options: StructureSceneOptions = {},
): SceneDescription {
  const layout = layoutDocument(document);
  const objects: SceneObject[] = [];
  const objectIds = new Set<string>();
  const boxes: Bounds3[] = [];

  for (const node of document.nodes) {
    const placed: NodeLayout | undefined = layout.get(node.id);
    if (placed === undefined) continue;
    const { visual, knownKind } = visualForKind(node.kind);
    objects.push({
      id: node.id,
      label: node.name,
      kind: node.kind,
      knownKind,
      shape: visual.shape,
      colorKey: visual.colorKey,
      position: placed.position,
      size: placed.size,
      depth: placed.depth,
    });
    objectIds.add(node.id);
    boxes.push(nodeVisualBounds(placed.position, placed.size));
  }

  const links: SceneLink[] = [];
  for (const edge of document.edges) {
    // A dangling edge is dropped rather than drawn to nowhere: a document can
    // briefly reference a node that was just removed, and a line to the origin
    // reads as a modelling error that is not there.
    if (!objectIds.has(edge.from) || !objectIds.has(edge.to)) continue;
    links.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.fromPort !== undefined ? { fromPort: edge.fromPort } : {}),
      ...(edge.toPort !== undefined ? { toPort: edge.toPort } : {}),
    });
  }

  const bounds = expandBounds(
    boundsOf(boxes.length > 0 ? boxes.flatMap((box) => [box.min, box.max]) : []),
    options.margin ?? SCENE_BOUNDS_MARGIN,
  );

  return { objects, links, bounds };
}

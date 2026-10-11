// Spatial markup -> a drawable path network.
//
// The DSL carries real spatial semantics, and they are not the canvas's own x/y
// (which is a layout the editor invents):
//
//     node Dock { x = 0  y = 0  z = 0 }          a place, in the model's units
//     path Run1 { node1 = Dock  node2 = Depot }  a straight network segment
//     moveTo Ship { node = Bay  speed = 10 }     travel along the network
//
// The kernel already reads these as geometry: it collects the node coordinates,
// weights every path by Euclidean distance and solves all-pairs shortest paths so
// that `moveTo` can spend `distance / speed` on the trip
// (methods/process/process_flow.cpp, `build_spatial_graph`). This module is the
// front end of the same reading, so the 3D view can draw the space the simulation
// actually travels through instead of an extruded flowchart.
//
// Defaults here are chosen to match the kernel, not to be convenient: a node with
// no `x`/`y` sits at the origin because the kernel's `node_float_param(child,
// "x", 0.0)` says so, and a `path` naming an unknown node is dropped because the
// kernel skips edges it cannot index. A view that disagreed with the simulation
// about where things are would be worse than no view.
//
// `z` is the one place the two readings differ, and it differs because the kernel
// has no third dimension to put it in: `NodePos` is `{x, y}`. The view honours
// the declared `z` (so the geometry a model declares is what you see) and reports
// `usesZ` so the panel can say out loud that the path solver ignores it.

import type { ModelDocument } from '@logicpilot/editor';

/** DSL kinds that carry spatial meaning. The kernel matches these as
 *  library `core`, block `node` / `path`. */
export const SPATIAL_NODE_KIND = 'node';
export const SPATIAL_PATH_KIND = 'path';

/** Block parameter naming the destination node of a spatial step
 *  (`moveTo Ship { node = Bay }`). */
export const SPATIAL_DESTINATION_PARAM = 'node';

export interface SpatialNode {
  /** Model node id of the `node` block, so a 3D pick round-trips to the canvas. */
  id: string;
  name: string;
  /** Model-space coordinates, in the DSL's own units. */
  x: number;
  y: number;
  z: number;
}

export interface SpatialPath {
  id: string;
  name: string;
  /** Endpoint `SpatialNode.id`s; both are always present (see `issues`). */
  from: string;
  to: string;
  fromName: string;
  toName: string;
  /** Euclidean length in model units, computed in the X/Y plane - the kernel's
   *  edge weight, so this is the distance a `moveTo` actually travels. */
  length: number;
}

export interface SpatialAnchor {
  /** Model node id of the block carrying `node = <Name>` (e.g. a `moveTo`). */
  blockId: string;
  blockName: string;
  /** Model node id of the referenced `node` block. */
  nodeId: string;
  nodeName: string;
}

/** A spatial declaration that could not be used, with the reason. Dropped
 *  declarations are reported rather than silently swallowed: a path that
 *  disappears without explanation reads as a rendering bug. */
export interface SpatialIssue {
  id: string;
  name: string;
  detail: string;
}

export interface SpatialExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Model-space size of the board along each model axis. */
  width: number;
  depth: number;
}

export interface SpatialGraph {
  nodes: SpatialNode[];
  paths: SpatialPath[];
  anchors: SpatialAnchor[];
  extent: SpatialExtent;
  /** True when at least one node declares a non-zero `z`. The kernel's path
   *  solver is 2D, so this only affects what is drawn. */
  usesZ: boolean;
  issues: SpatialIssue[];
}

/** Numeric parameter coercion. The DSL guarantees a numeric constant for node
 *  coordinates, but a document can also arrive from the canvas or a hand-edited
 *  file, and a non-finite coordinate would poison every derived position, size
 *  and bound. Unreadable values fall back like a missing one. */
function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Identifier parameter coercion: `node1 = Dock` arrives as the bare name. */
function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 ? name : null;
}

/**
 * Reads the spatial graph out of a document, or returns null when the document
 * has no `node` blocks at all - the signal that this model is not spatial and the
 * structural projection is the right one.
 */
export function spatialGraphFromDocument(document: ModelDocument): SpatialGraph | null {
  const issues: SpatialIssue[] = [];

  // Node declarations first: a path can only be resolved once every name is
  // known, so the two passes cannot be merged.
  //
  // Duplicate names keep the LAST declaration, which is what the kernel does by
  // writing into `positions[name]`. Names are the addressing scheme for paths and
  // for `moveTo` destinations, so a view that picked the first occurrence could
  // route a trip differently from the simulation.
  const byName = new Map<string, SpatialNode>();
  const nodes: SpatialNode[] = [];
  for (const block of document.nodes) {
    if (block.kind !== SPATIAL_NODE_KIND) continue;
    const node: SpatialNode = {
      id: block.id,
      name: block.name,
      x: readNumber(block.params['x']),
      y: readNumber(block.params['y']),
      z: readNumber(block.params['z']),
    };
    const existing = byName.get(node.name);
    if (existing !== undefined) {
      issues.push({
        id: block.id,
        name: block.name,
        detail: `duplicate node name '${node.name}'; the later declaration is the one paths and moveTo resolve to`,
      });
      // Replace in place so the declaration order of the drawn network follows
      // the document rather than the last duplicate.
      const index = nodes.findIndex((entry) => entry.id === existing.id);
      if (index >= 0) nodes[index] = node;
    } else {
      nodes.push(node);
    }
    byName.set(node.name, node);
  }

  if (nodes.length === 0) return null;

  const paths: SpatialPath[] = [];
  for (const block of document.nodes) {
    if (block.kind !== SPATIAL_PATH_KIND) continue;
    const fromName = readName(block.params['node1']);
    const toName = readName(block.params['node2']);
    if (fromName === null || toName === null) {
      issues.push({
        id: block.id,
        name: block.name,
        detail: 'a path needs both node1 and node2',
      });
      continue;
    }
    const from = byName.get(fromName);
    const to = byName.get(toName);
    if (from === undefined || to === undefined) {
      const missing = from === undefined ? fromName : toName;
      issues.push({
        id: block.id,
        name: block.name,
        detail: `path references unknown node '${missing}'`,
      });
      continue;
    }
    if (from.id === to.id) {
      // A self-segment has no length and no direction: there is nothing to draw
      // and the kernel's weight for it is 0.
      issues.push({ id: block.id, name: block.name, detail: 'path joins a node to itself' });
      continue;
    }
    paths.push({
      id: block.id,
      name: block.name,
      from: from.id,
      to: to.id,
      fromName,
      toName,
      length: Math.hypot(to.x - from.x, to.y - from.y),
    });
  }

  // Blocks anchored to a place. `moveTo` is the only kind that uses it today, but
  // the rule is written against the parameter rather than the kind: the kernel
  // resolves `node` generically, and a future block inherits the behaviour.
  const anchors: SpatialAnchor[] = [];
  for (const block of document.nodes) {
    if (block.kind === SPATIAL_NODE_KIND || block.kind === SPATIAL_PATH_KIND) continue;
    const target = readName(block.params[SPATIAL_DESTINATION_PARAM]);
    if (target === null) continue;
    const node = byName.get(target);
    if (node === undefined) {
      issues.push({
        id: block.id,
        name: block.name,
        detail: `'${block.name}' targets unknown node '${target}'`,
      });
      continue;
    }
    anchors.push({
      blockId: block.id,
      blockName: block.name,
      nodeId: node.id,
      nodeName: target,
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let usesZ = false;
  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
    if (node.z !== 0) usesZ = true;
  }

  return {
    nodes,
    paths,
    anchors,
    extent: { minX, maxX, minY, maxY, width: maxX - minX, depth: maxY - minY },
    usesZ,
    issues,
  };
}

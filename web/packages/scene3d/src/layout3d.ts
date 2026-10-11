// Where each model node goes in the 3D scene.
//
// The model already has a meaningful 2D arrangement (the SVG canvas's x/y), so
// the 3D view does not invent a new layout: it lifts the existing one and uses
// the one axis the 2D canvas cannot express — container nesting — as height.
//
// The mapping, stated once here so it stays a decision rather than an accident:
//
//     world.x = model.x * scale
//     world.z = model.y * scale        (model "down" becomes away from the camera)
//     world.y = containerDepth * LEVEL_HEIGHT
//
// Y is up. A node inside a container sits one level above it, so nesting is
// visible at a glance and the model's own reading order is preserved.

import type { ModelDocument, ModelNode } from '@logicpilot/editor';
import { vec3, type Bounds3, type Vec3 } from './math3d.js';

/** Model coordinates are canvas pixels; 50 of them make one world unit. Chosen
 *  so a typical model (a few hundred px wide) lands in a scene a few units
 *  across, where the default camera distance reads well. */
export const MODEL_UNITS_PER_WORLD_UNIT = 50;
export const LAYOUT_SCALE = 1 / MODEL_UNITS_PER_WORLD_UNIT;

/** Vertical gap between nesting levels, in world units. */
export const LEVEL_HEIGHT = 5;

/** Footprint and height of a node's box, in world units. */
export const NODE_FOOTPRINT = 3.2;
export const NODE_HEIGHT = 1.4;

/** Bounds the parent walk. A malformed document (a containerId cycle) must not
 *  hang the renderer, and the layout is not the place to report that as an
 *  error — it just stops descending. */
export const MAX_CONTAINER_DEPTH = 64;

export interface NodeLayout {
  position: Vec3;
  size: Vec3;
  depth: number;
}

function indexById(document: ModelDocument): Map<string, ModelNode> {
  const byId = new Map<string, ModelNode>();
  for (const node of document.nodes) {
    byId.set(node.id, node);
  }
  return byId;
}

/** Nesting level of a node: 0 at model level, +1 per containing node.
 *
 * Missing parents count as depth 0 rather than an error, because a document can
 * legitimately reference a container that was just deleted. Cycles terminate at
 * `MAX_CONTAINER_DEPTH`.
 */
export function containerDepth(byId: ReadonlyMap<string, ModelNode>, nodeId: string): number {
  let depth = 0;
  const visited = new Set<string>([nodeId]);
  let current = byId.get(nodeId)?.containerId;
  while (current !== undefined && depth < MAX_CONTAINER_DEPTH) {
    if (visited.has(current)) break;
    visited.add(current);
    const parent = byId.get(current);
    if (parent === undefined) break;
    depth += 1;
    current = parent.containerId;
  }
  return depth;
}

export function layoutDocument(document: ModelDocument): Map<string, NodeLayout> {
  const byId = indexById(document);
  const layout = new Map<string, NodeLayout>();
  for (const node of document.nodes) {
    const depth = containerDepth(byId, node.id);
    layout.set(node.id, {
      position: vec3(node.x * LAYOUT_SCALE, depth * LEVEL_HEIGHT, node.y * LAYOUT_SCALE),
      size: vec3(NODE_FOOTPRINT, NODE_HEIGHT, NODE_FOOTPRINT),
      depth,
    });
  }
  return layout;
}

/** Axis-aligned box a placed node occupies. */
export function nodeVisualBounds(position: Vec3, size: Vec3): Bounds3 {
  const halfX = size.x / 2;
  const halfY = size.y / 2;
  const halfZ = size.z / 2;
  return {
    min: vec3(position.x - halfX, position.y - halfY, position.z - halfZ),
    max: vec3(position.x + halfX, position.y + halfY, position.z + halfZ),
  };
}

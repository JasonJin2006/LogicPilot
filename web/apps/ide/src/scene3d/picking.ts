// Screen point -> scene object id.
//
// Routed through the pure projection in `@logicpilot/scene3d` where possible,
// but picking needs the engine's ray casting: it has to respect the actual mesh
// transforms, and reimplementing that against the description would be a second
// source of truth for where things are.

import { Raycaster, Vector2, type Camera, type Object3D } from 'three';

export interface PickRequest {
  /** Pointer position in CSS pixels relative to the canvas top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Returns the scene id under the pointer, or null for empty space. */
export function pickSceneId(
  raycaster: Raycaster,
  camera: Camera,
  targets: readonly Object3D[],
  request: PickRequest,
): string | null {
  if (request.width <= 0 || request.height <= 0) return null;
  const ndc = new Vector2(
    (request.x / request.width) * 2 - 1,
    -((request.y / request.height) * 2 - 1),
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...targets], false);
  for (const hit of hits) {
    const id = hit.object.userData.sceneId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

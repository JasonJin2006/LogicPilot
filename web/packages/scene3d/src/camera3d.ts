// Orbit camera math for the 3D scene view.
//
// Deliberately a separate model from `@logicpilot/canvas`'s `Camera`
// ({scale, panX, panY}). That one is a 2D pan/zoom camera consumed by
// ModelCanvas and SysMLCanvas; widening it to carry rotation and perspective
// would either break those call sites or leave a type where half the fields are
// meaningless for half the users. A 3D camera needs position/orientation, which
// a scale+pan model cannot express at all.
//
// Conventions (also documented in the package README, because an implicit
// convention here becomes a silent bug later):
//
//   * The world is **Y-up**.
//   * `azimuth` rotates about +Y; azimuth = 0 puts the camera on +Z looking
//     toward -Z. It is kept normalised into [-PI, PI) so a long drag cannot
//     accumulate unbounded magnitude.
//   * `elevation` is the angle above the XZ plane, clamped away from +/-PI/2
//     because the up vector degenerates when the camera looks straight down.
//   * `fov` is the **vertical** field of view in degrees; horizontal follows
//     from the viewport aspect ratio.

import {
  addVec3,
  boundsCenter,
  boundsRadius,
  crossVec3,
  dotVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  vec3,
  type Bounds3,
  type Vec3,
} from './math3d.js';

export interface Camera3D {
  target: Vec3;
  distance: number;
  azimuth: number;
  elevation: number;
  fov: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Projected {
  /** Screen pixels from the left edge. */
  x: number;
  /** Screen pixels from the top edge. */
  y: number;
  /** Distance in front of the camera along its forward axis. */
  depth: number;
}

/** Just short of straight up/down: at exactly +/-PI/2 the forward vector is
 *  parallel to the world up vector and the basis collapses. */
export const MIN_ELEVATION = -Math.PI / 2 + 0.02;
export const MAX_ELEVATION = Math.PI / 2 - 0.02;
export const MIN_DISTANCE = 0.5;
export const MAX_DISTANCE = 10_000;
export const MIN_FOV = 10;
export const MAX_FOV = 110;

export const DEFAULT_CAMERA: Camera3D = {
  target: vec3(0, 0, 0),
  distance: 26,
  azimuth: Math.PI / 4,
  elevation: Math.PI / 6,
  fov: 50,
};

const WORLD_UP = vec3(0, 1, 0);

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Wraps an angle into [-PI, PI). */
export function normalizeAngle(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const twoPi = Math.PI * 2;
  let wrapped = (radians + Math.PI) % twoPi;
  if (wrapped < 0) wrapped += twoPi;
  return wrapped - Math.PI;
}

function sanitize(camera: Camera3D): Camera3D {
  return {
    target: {
      x: Number.isFinite(camera.target.x) ? camera.target.x : 0,
      y: Number.isFinite(camera.target.y) ? camera.target.y : 0,
      z: Number.isFinite(camera.target.z) ? camera.target.z : 0,
    },
    distance: clamp(camera.distance, MIN_DISTANCE, MAX_DISTANCE),
    azimuth: normalizeAngle(camera.azimuth),
    elevation: clamp(camera.elevation, MIN_ELEVATION, MAX_ELEVATION),
    fov: clamp(camera.fov, MIN_FOV, MAX_FOV),
  };
}

/** Unit vector from the target toward the camera. */
export function cameraOffsetDirection(camera: Camera3D): Vec3 {
  const cosElevation = Math.cos(camera.elevation);
  return {
    x: cosElevation * Math.sin(camera.azimuth),
    y: Math.sin(camera.elevation),
    z: cosElevation * Math.cos(camera.azimuth),
  };
}

export function cameraPosition(camera: Camera3D): Vec3 {
  return addVec3(camera.target, scaleVec3(cameraOffsetDirection(camera), camera.distance));
}

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/** Orthonormal camera basis. Always defined: `distance >= MIN_DISTANCE` and the
 *  elevation clamp together guarantee a non-degenerate forward vector. */
export function cameraBasis(camera: Camera3D): CameraBasis {
  const raw = subVec3(camera.target, cameraPosition(camera));
  const forward = normalizeVec3(raw) ?? vec3(0, 0, -1);
  const right = normalizeVec3(crossVec3(forward, WORLD_UP)) ?? vec3(1, 0, 0);
  const up = normalizeVec3(crossVec3(right, forward)) ?? WORLD_UP;
  return { forward, right, up };
}

export function aspectOf(viewport: Viewport): number {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return 1;
  if (viewport.height <= 0) return 1;
  const aspect = viewport.width / viewport.height;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/** Rotates the camera around its target. */
export function orbit(camera: Camera3D, deltaAzimuth: number, deltaElevation: number): Camera3D {
  return sanitize({
    ...camera,
    azimuth: camera.azimuth + (Number.isFinite(deltaAzimuth) ? deltaAzimuth : 0),
    elevation: camera.elevation + (Number.isFinite(deltaElevation) ? deltaElevation : 0),
  });
}

/** Moves the camera toward or away from its target. `factor < 1` moves closer. */
export function dolly(camera: Camera3D, factor: number): Camera3D {
  const safe = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return sanitize({ ...camera, distance: camera.distance * safe });
}

/** World units covered by one screen pixel, at the target's depth. */
export function worldUnitsPerPixel(camera: Camera3D, viewport: Viewport): { x: number; y: number } {
  const visibleHeight = 2 * camera.distance * Math.tan((camera.fov * Math.PI) / 360);
  const perPixelY = viewport.height > 0 ? visibleHeight / viewport.height : visibleHeight;
  // Pixels are square, so the horizontal scale matches the vertical one; the
  // viewport aspect is already accounted for by `visibleHeight`.
  return { x: perPixelY, y: perPixelY };
}

/** Pans the target so the scene follows the cursor ("grab and drag").
 *
 * The invariant this is written to satisfy, and which the tests pin: the world
 * point under the cursor before the pan is still under the cursor after it.
 */
export function panTarget(
  camera: Camera3D,
  deltaXPixels: number,
  deltaYPixels: number,
  viewport: Viewport,
): Camera3D {
  const perPixel = worldUnitsPerPixel(camera, viewport);
  const basis = cameraBasis(camera);
  const dx = Number.isFinite(deltaXPixels) ? deltaXPixels : 0;
  const dy = Number.isFinite(deltaYPixels) ? deltaYPixels : 0;
  // Screen +y points down while the basis `up` points up, hence the sign flip.
  const offset = addVec3(
    scaleVec3(basis.right, -dx * perPixel.x),
    scaleVec3(basis.up, dy * perPixel.y),
  );
  return sanitize({ ...camera, target: addVec3(camera.target, offset) });
}

/** Frames `bounds` in the viewport, keeping the current orientation. */
export function fitBounds(
  bounds: Bounds3,
  viewport: Viewport,
  options: { padding?: number; fov?: number; azimuth?: number; elevation?: number } = {},
): Camera3D {
  const padding = options.padding !== undefined && options.padding > 0 ? options.padding : 1.15;
  const fov = clamp(options.fov ?? DEFAULT_CAMERA.fov, MIN_FOV, MAX_FOV);
  // A degenerate extent (single node, or every node at one point) still needs a
  // usable distance, so the sphere never goes below 1 world unit.
  const radius = Math.max(boundsRadius(bounds), 1);
  const fovY = (fov * Math.PI) / 180;
  const aspect = aspectOf(viewport);
  // Horizontal fov follows from the vertical one, and the bounding sphere has
  // to fit in both, so the tighter (larger) distance wins.
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const distanceY = radius / Math.sin(fovY / 2);
  const distanceX = radius / Math.sin(fovX / 2);
  return sanitize({
    target: boundsCenter(bounds),
    distance: Math.max(distanceX, distanceY) * padding,
    azimuth: options.azimuth ?? DEFAULT_CAMERA.azimuth,
    elevation: options.elevation ?? DEFAULT_CAMERA.elevation,
    fov,
  });
}

/** Projects a world point to screen pixels.
 *
 * `null` means "not in front of the camera": the perspective divide would place
 * it at a mirrored screen position, which is worse than not drawing it. The
 * renderer uses this for picking and for label placement.
 */
export function projectToScreen(
  camera: Camera3D,
  point: Vec3,
  viewport: Viewport,
): Projected | null {
  const position = cameraPosition(camera);
  const basis = cameraBasis(camera);
  const relative = subVec3(point, position);
  const depth = dotVec3(relative, basis.forward);
  if (!Number.isFinite(depth) || depth <= 1e-6) return null;
  const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
  const aspect = aspectOf(viewport);
  const ndcY = (dotVec3(relative, basis.up) * f) / depth;
  const ndcX = (dotVec3(relative, basis.right) * (f / aspect)) / depth;
  return {
    x: (ndcX * 0.5 + 0.5) * viewport.width,
    y: (1 - (ndcY * 0.5 + 0.5)) * viewport.height,
    depth,
  };
}

/** True when the camera state is finite and within its clamps. Used by the
 *  store to reject a corrupted persisted camera instead of rendering a blank
 *  frame with no explanation. */
export function isUsableCamera(camera: Camera3D): boolean {
  return (
    Number.isFinite(camera.target.x) &&
    Number.isFinite(camera.target.y) &&
    Number.isFinite(camera.target.z) &&
    Number.isFinite(camera.distance) &&
    camera.distance >= MIN_DISTANCE &&
    camera.distance <= MAX_DISTANCE &&
    Number.isFinite(camera.azimuth) &&
    camera.elevation >= MIN_ELEVATION &&
    camera.elevation <= MAX_ELEVATION &&
    camera.fov >= MIN_FOV &&
    camera.fov <= MAX_FOV
  );
}

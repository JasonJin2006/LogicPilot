// Minimal 3D value types.
//
// Deliberately not three.js vectors: this package is the renderer-free half of
// the 3D view, so it must stay testable in plain Node and must not force a
// ~150KB engine into every consumer (including a future worker-side layout or a
// headless projector). The renderer converts these to its own types at the
// boundary.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthVec3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Unit vector, or `null` for a zero-length input.
 *
 * Returning null rather than a zero vector keeps the degenerate case visible at
 * the call site: a camera basis built from a zero vector silently collapses the
 * whole projection instead of failing.
 */
export function normalizeVec3(v: Vec3): Vec3 | null {
  const length = lengthVec3(v);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Axis-aligned bounds of the given points. Empty input yields a unit box at
 *  the origin so downstream code never has to special-case "no content". */
export function boundsOf(points: readonly Vec3[]): Bounds3 {
  if (points.length === 0) {
    return { min: { x: -0.5, y: -0.5, z: -0.5 }, max: { x: 0.5, y: 0.5, z: 0.5 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.z < minZ) minZ = point.z;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

export function boundsCenter(bounds: Bounds3): Vec3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

export function boundsSize(bounds: Bounds3): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
}

/** Radius of the bounding sphere around `bounds`. */
export function boundsRadius(bounds: Bounds3): number {
  const size = boundsSize(bounds);
  return Math.hypot(size.x, size.y, size.z) / 2;
}

/** Grows bounds by `margin` on every axis. Non-finite margins are ignored, so a
 *  bad caller cannot produce NaN bounds that poison the camera fit. */
export function expandBounds(bounds: Bounds3, margin: number): Bounds3 {
  const by = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  return {
    min: { x: bounds.min.x - by, y: bounds.min.y - by, z: bounds.min.z - by },
    max: { x: bounds.max.x + by, y: bounds.max.y + by, z: bounds.max.z + by },
  };
}

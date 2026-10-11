import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  MAX_DISTANCE,
  MAX_ELEVATION,
  MIN_DISTANCE,
  MIN_ELEVATION,
  aspectOf,
  cameraBasis,
  cameraPosition,
  dolly,
  fitBounds,
  isUsableCamera,
  normalizeAngle,
  orbit,
  panTarget,
  projectToScreen,
  worldUnitsPerPixel,
  type Camera3D,
  type Viewport,
} from '../src/camera3d';
import { addVec3, dotVec3, scaleVec3, subVec3, vec3 } from '../src/math3d';

const viewport: Viewport = { width: 800, height: 600 };

describe('orbit camera', () => {
  it('places the camera on +Z when azimuth and elevation are zero', () => {
    const camera: Camera3D = { ...DEFAULT_CAMERA, azimuth: 0, elevation: 0, distance: 10 };
    const position = cameraPosition(camera);
    expect(position.x).toBeCloseTo(0, 10);
    expect(position.y).toBeCloseTo(0, 10);
    expect(position.z).toBeCloseTo(10, 10);
  });

  it('keeps the target distance invariant under orbit', () => {
    let camera: Camera3D = { ...DEFAULT_CAMERA, distance: 12 };
    for (const [dAz, dEl] of [
      [0.3, 0.1],
      [-1.2, -0.4],
      [2.0, 0.6],
    ] as const) {
      camera = orbit(camera, dAz, dEl);
      const position = cameraPosition(camera);
      const distance = Math.hypot(
        position.x - camera.target.x,
        position.y - camera.target.y,
        position.z - camera.target.z,
      );
      expect(distance).toBeCloseTo(12, 8);
    }
  });

  it('clamps elevation away from the poles so the basis never collapses', () => {
    const up = orbit(DEFAULT_CAMERA, 0, 100);
    expect(up.elevation).toBe(MAX_ELEVATION);
    const down = orbit(DEFAULT_CAMERA, 0, -100);
    expect(down.elevation).toBe(MIN_ELEVATION);
  });

  it('keeps azimuth bounded across a long drag', () => {
    let camera = DEFAULT_CAMERA;
    for (let index = 0; index < 200; index += 1) camera = orbit(camera, 0.7, 0);
    expect(camera.azimuth).toBeGreaterThanOrEqual(-Math.PI);
    expect(camera.azimuth).toBeLessThan(Math.PI);
    expect(Number.isFinite(camera.azimuth)).toBe(true);
  });

  it('normalizes angles into [-PI, PI)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });

  it('dollies within limits and ignores a non-positive factor', () => {
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, 2).distance).toBeCloseTo(20, 10);
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, 0.5).distance).toBeCloseTo(5, 10);
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, 0.0001).distance).toBe(MIN_DISTANCE);
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, 100000).distance).toBe(MAX_DISTANCE);
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, 0).distance).toBe(10);
    expect(dolly({ ...DEFAULT_CAMERA, distance: 10 }, -3).distance).toBe(10);
  });
});

describe('projection', () => {
  it('projects the target to the viewport centre', () => {
    const projected = projectToScreen(DEFAULT_CAMERA, DEFAULT_CAMERA.target, viewport);
    expect(projected).not.toBeNull();
    if (!projected) return;
    expect(projected.x).toBeCloseTo(viewport.width / 2, 6);
    expect(projected.y).toBeCloseTo(viewport.height / 2, 6);
    expect(projected.depth).toBeCloseTo(DEFAULT_CAMERA.distance, 6);
  });

  it('returns null for a point behind the camera instead of mirroring it', () => {
    const camera: Camera3D = { ...DEFAULT_CAMERA, azimuth: 0, elevation: 0, distance: 10 };
    // The camera sits at +Z looking toward -Z, so a point further out on +Z is
    // behind it.
    expect(projectToScreen(camera, vec3(0, 0, 40), viewport)).toBeNull();
    expect(projectToScreen(camera, vec3(0, 0, 0), viewport)).not.toBeNull();
  });

  it('puts higher world Y further up the screen', () => {
    const low = projectToScreen(DEFAULT_CAMERA, vec3(0, -1, 0), viewport);
    const high = projectToScreen(DEFAULT_CAMERA, vec3(0, 1, 0), viewport);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    if (!low || !high) return;
    // Screen y grows downward.
    expect(high.y).toBeLessThan(low.y);
  });

  it('scales one world unit to fewer pixels as the camera pulls back', () => {
    const near = worldUnitsPerPixel({ ...DEFAULT_CAMERA, distance: 5 }, viewport);
    const far = worldUnitsPerPixel({ ...DEFAULT_CAMERA, distance: 50 }, viewport);
    expect(far.y).toBeGreaterThan(near.y);
    // Square pixels: the horizontal and vertical scales agree.
    expect(near.x).toBeCloseTo(near.y, 12);
  });

  it('treats a degenerate viewport as square rather than dividing by zero', () => {
    expect(aspectOf({ width: 100, height: 0 })).toBe(1);
    expect(aspectOf({ width: Number.NaN, height: 100 })).toBe(1);
    expect(aspectOf({ width: 1600, height: 800 })).toBeCloseTo(2, 12);
  });
});

describe('panTarget', () => {
  // The pan is written to satisfy this: whatever was under the cursor stays under
  // the cursor. It can only hold exactly for a point at the target's depth —
  // points nearer or further shift by parallax, which is correct perspective
  // behaviour rather than an error — so the grabbed point is built in the
  // camera's screen plane.
  it('keeps the grabbed world point under the cursor', () => {
    const camera = { ...DEFAULT_CAMERA, distance: 20 };
    const basis = cameraBasis(camera);
    const grabbed = addVec3(
      addVec3(camera.target, scaleVec3(basis.right, 3)),
      scaleVec3(basis.up, 2),
    );
    const before = projectToScreen(camera, grabbed, viewport);
    expect(before).not.toBeNull();
    if (!before) return;

    const deltaX = 37;
    const deltaY = -19;
    const panned = panTarget(camera, deltaX, deltaY, viewport);
    const after = projectToScreen(panned, grabbed, viewport);
    expect(after).not.toBeNull();
    if (!after) return;

    expect(after.x - before.x).toBeCloseTo(deltaX, 3);
    expect(after.y - before.y).toBeCloseTo(deltaY, 3);
  });

  it('leaves the camera at the same distance from its target', () => {
    const basis = cameraBasis(DEFAULT_CAMERA);
    const panned = panTarget(DEFAULT_CAMERA, 25, 15, viewport);
    const offset = subVec3(panned.target, DEFAULT_CAMERA.target);
    // The pan is a translation in the screen plane, so it has no component
    // toward or away from the camera.
    expect(dotVec3(offset, basis.forward)).toBeCloseTo(0, 8);
  });

  it('ignores non-finite deltas', () => {
    const panned = panTarget(DEFAULT_CAMERA, Number.NaN, Number.NaN, viewport);
    expect(panned.target.x).toBeCloseTo(DEFAULT_CAMERA.target.x, 12);
    expect(panned.target.z).toBeCloseTo(DEFAULT_CAMERA.target.z, 12);
  });
});

describe('fitBounds', () => {
  it('centres on the content', () => {
    const camera = fitBounds({ min: vec3(-10, 0, -5), max: vec3(10, 4, 5) }, viewport, {
      azimuth: 0,
      elevation: 0,
    });
    expect(camera.target.x).toBeCloseTo(0, 10);
    expect(camera.target.y).toBeCloseTo(2, 10);
    expect(camera.target.z).toBeCloseTo(0, 10);
  });

  it('frames every corner of the bounds inside the viewport', () => {
    const bounds = { min: vec3(-8, -1, -3), max: vec3(12, 6, 7) };
    const camera = fitBounds(bounds, { width: 1200, height: 700 });
    const corners = [
      vec3(bounds.min.x, bounds.min.y, bounds.min.z),
      vec3(bounds.min.x, bounds.min.y, bounds.max.z),
      vec3(bounds.min.x, bounds.max.y, bounds.min.z),
      vec3(bounds.min.x, bounds.max.y, bounds.max.z),
      vec3(bounds.max.x, bounds.min.y, bounds.min.z),
      vec3(bounds.max.x, bounds.min.y, bounds.max.z),
      vec3(bounds.max.x, bounds.max.y, bounds.min.z),
      vec3(bounds.max.x, bounds.max.y, bounds.max.z),
    ];
    for (const corner of corners) {
      const projected = projectToScreen(camera, corner, { width: 1200, height: 700 });
      expect(projected).not.toBeNull();
      if (!projected) continue;
      expect(projected.x).toBeGreaterThanOrEqual(0);
      expect(projected.x).toBeLessThanOrEqual(1200);
      expect(projected.y).toBeGreaterThanOrEqual(0);
      expect(projected.y).toBeLessThanOrEqual(700);
    }
  });

  it('still produces a usable camera for degenerate content', () => {
    // A single node: no extent at all. The distance must stay finite and in
    // range so the first frame is not a blank void.
    const camera = fitBounds({ min: vec3(3, 1, 2), max: vec3(3, 1, 2) }, viewport);
    expect(isUsableCamera(camera)).toBe(true);
    expect(camera.distance).toBeGreaterThanOrEqual(MIN_DISTANCE);
  });

  it('pulls back only when the viewport is narrower than the fov already covers', () => {
    const bounds = { min: vec3(-10, -10, -10), max: vec3(10, 10, 10) };
    // Vertical fov is fixed, so for any aspect >= 1 the vertical constraint is
    // the binding one and the aspect drops out of the result entirely. Only an
    // aspect below 1 squeezes the horizontal field enough to force the camera
    // back.
    const wide = fitBounds(bounds, { width: 1600, height: 400 });
    const square = fitBounds(bounds, { width: 800, height: 800 });
    const tall = fitBounds(bounds, { width: 400, height: 1600 });
    expect(wide.distance).toBeCloseTo(square.distance, 10);
    expect(tall.distance).toBeGreaterThan(square.distance);
  });
});

describe('isUsableCamera', () => {
  it('accepts a fitted camera and rejects corrupted state', () => {
    expect(isUsableCamera(DEFAULT_CAMERA)).toBe(true);
    expect(isUsableCamera({ ...DEFAULT_CAMERA, distance: Number.NaN })).toBe(false);
    expect(isUsableCamera({ ...DEFAULT_CAMERA, distance: 0 })).toBe(false);
    expect(isUsableCamera({ ...DEFAULT_CAMERA, elevation: 10 })).toBe(false);
    expect(isUsableCamera({ ...DEFAULT_CAMERA, fov: 400 })).toBe(false);
    expect(isUsableCamera({ ...DEFAULT_CAMERA, target: vec3(0, Number.NaN, 0) })).toBe(false);
  });
});

// Scene (3D) view state: camera, display toggles and the hover mirror.
//
// The model document stays in `useModelStore`; this store holds only what is
// specific to looking at it in 3D. Selection is NOT duplicated here - the model
// store owns it, and the host reads it, so there is exactly one source of truth
// for "what is selected".
//
// Deliberately not persisted. The model document itself is session-only
// ("every launch starts from a fresh blank model"), so a camera restored from a
// previous session would be pointing at content that no longer exists. A stale
// camera also fails silently: the panel renders a valid but empty-looking frame
// with nothing to explain why.

import { create } from 'zustand';
import {
  DEFAULT_CAMERA,
  fitBounds as fitCameraToBounds,
  isUsableCamera,
  orbit as orbitCamera,
  dolly as dollyCamera,
  panTarget as panCamera,
  type Bounds3,
  type Camera3D,
  type Viewport,
} from '@logicpilot/scene3d';

/** Radians of rotation per pixel of drag. Chosen so a full viewport-width drag
 *  turns the model roughly a quarter turn. */
export const ORBIT_RADIANS_PER_PIXEL = 0.008;

export interface SceneState {
  camera: Camera3D;
  showLabels: boolean;
  showLinks: boolean;
  hoveredId: string | null;
  /** Incremented whenever the camera changes, so the host knows to redraw
   *  without diffing the whole camera object. */
  cameraRevision: number;
  orbitByPixels: (deltaX: number, deltaY: number) => void;
  dollyBy: (factor: number) => void;
  panByPixels: (deltaX: number, deltaY: number, viewport: Viewport) => void;
  frameBounds: (bounds: Bounds3, viewport: Viewport) => void;
  setCamera: (camera: Camera3D) => void;
  resetCamera: () => void;
  toggleLabels: () => void;
  toggleLinks: () => void;
  setHovered: (id: string | null) => void;
}

export const useSceneStore = create<SceneState>((set) => ({
  camera: DEFAULT_CAMERA,
  showLabels: true,
  showLinks: true,
  hoveredId: null,
  cameraRevision: 0,

  orbitByPixels: (deltaX, deltaY) =>
    set((state) => ({
      camera: orbitCamera(
        state.camera,
        -deltaX * ORBIT_RADIANS_PER_PIXEL,
        -deltaY * ORBIT_RADIANS_PER_PIXEL,
      ),
      cameraRevision: state.cameraRevision + 1,
    })),

  dollyBy: (factor) =>
    set((state) => ({
      camera: dollyCamera(state.camera, factor),
      cameraRevision: state.cameraRevision + 1,
    })),

  panByPixels: (deltaX, deltaY, viewport) =>
    set((state) => ({
      camera: panCamera(state.camera, deltaX, deltaY, viewport),
      cameraRevision: state.cameraRevision + 1,
    })),

  frameBounds: (bounds, viewport) =>
    set((state) => {
      // Keep the user's current orientation; only the framing distance changes,
      // so pressing Fit does not spin the view somewhere unexpected.
      const fitted = fitCameraToBounds(bounds, viewport, {
        azimuth: state.camera.azimuth,
        elevation: state.camera.elevation,
        fov: state.camera.fov,
      });
      return { camera: fitted, cameraRevision: state.cameraRevision + 1 };
    }),

  // A camera arriving from outside (a restored value, a plugin) is validated
  // rather than trusted: one NaN would render a blank frame with no error.
  setCamera: (camera) =>
    set((state) => ({
      camera: isUsableCamera(camera) ? camera : DEFAULT_CAMERA,
      cameraRevision: state.cameraRevision + 1,
    })),

  resetCamera: () =>
    set((state) => ({ camera: DEFAULT_CAMERA, cameraRevision: state.cameraRevision + 1 })),

  toggleLabels: () => set((state) => ({ showLabels: !state.showLabels })),
  toggleLinks: () => set((state) => ({ showLinks: !state.showLinks })),
  setHovered: (id) => set((state) => (state.hoveredId === id ? state : { hoveredId: id })),
}));

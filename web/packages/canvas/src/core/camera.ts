// Pure camera math shared by every paradigm canvas. The React component
// owns the camera state; these helpers produce the next value so zoom and
// fit behavior stay identical across canvases (audit: two canvases used to
// drift here).

import type { Camera, Size } from './types.js';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Multiply the scale around a focal point (screen coordinates), keeping
 *  that point pinned to the same world position. */
export function zoomAtPoint(
  camera: Camera,
  factor: number,
  focalX: number,
  focalY: number,
  minScale: number,
  maxScale: number,
): Camera {
  const scale = clamp(camera.scale * factor, minScale, maxScale);
  const worldX = (focalX - camera.panX) / camera.scale;
  const worldY = (focalY - camera.panY) / camera.scale;
  return { scale, panX: focalX - worldX * scale, panY: focalY - worldY * scale };
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Center-and-fit a world bounds rectangle inside the viewport. Returns
 *  null when there is nothing to fit or the viewport has no size yet. */
export function fitBounds(
  bounds: WorldBounds | null,
  viewport: Size,
  options: {
    minScale: number;
    maxScale: number;
    padding?: number;
    contentFallback?: { width: number; height: number };
  },
): Camera | null {
  if (
    bounds === null ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    bounds.maxX < bounds.minX ||
    bounds.maxY < bounds.minY
  ) {
    return null;
  }
  const pad = options.padding ?? 0;
  const fallback = options.contentFallback ?? { width: 140, height: 120 };
  const contentWidth = Math.max(fallback.width, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(fallback.height, bounds.maxY - bounds.minY);
  const scale = clamp(
    Math.min((viewport.width - pad) / contentWidth, (viewport.height - pad) / contentHeight),
    options.minScale,
    options.maxScale,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    panX: viewport.width / 2 - centerX * scale,
    panY: viewport.height / 2 - centerY * scale,
  };
}

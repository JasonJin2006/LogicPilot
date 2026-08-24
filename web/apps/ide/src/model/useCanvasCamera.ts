// Per-view camera control for the model canvas (canvas-platform S3 layer
// split): pan/zoom state cached per container tab, wheel-about-cursor,
// zoom-at-center and fit-to-content. Extracted verbatim from ModelCanvas so
// viewport policy lives in one place; math parity is covered by the kernel's
// camera tests plus the browser E2E run flows.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface ModelCameraView {
  scale: number;
  panX: number;
  panY: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
/** World-space margin applied when a fresh canvas opens at scale 1. */
const VIEW_MARGIN = 48;
/** Screen padding kept around fitted content. */
const FIT_PADDING_PX = 96;
const FIT_CONTENT_MIN = { width: 140, height: 120 };
const FIT_WORLD_MARGIN_X = 70;
const FIT_WORLD_MARGIN_Y = 60;
const FIT_MAX_SCALE = 1.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface CanvasWorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface UseCanvasCameraOptions {
  viewKey: string;
  /** The scrollable viewport element (wheel + resize attach here). */
  elementRef: RefObject<HTMLElement | null>;
  /** Bounds of the currently visible content; null while empty. */
  getVisibleBounds: () => CanvasWorldBounds | null;
  /** Bump when the visible content changes so a never-fitted view fits once. */
  contentVersion: number;
}

export function useCanvasCamera({
  viewKey,
  elementRef,
  getVisibleBounds,
  contentVersion,
}: UseCanvasCameraOptions) {
  // Pan/zoom is remembered per canvas view (the root + each open container
  // tab), like editor tabs keep their scroll position across switches.
  const cameraCache = useRef<Map<string, ModelCameraView>>(new Map());
  const defaultView: ModelCameraView = { scale: 1, panX: VIEW_MARGIN, panY: VIEW_MARGIN };
  const [view, setViewState] = useState<ModelCameraView>(
    () => cameraCache.current.get(viewKey) ?? defaultView,
  );
  useEffect(() => {
    setViewState(cameraCache.current.get(viewKey) ?? defaultView);
    // viewKey is the cache slot being switched to.
  }, [viewKey]);
  const setView = (updater: ModelCameraView | ((current: ModelCameraView) => ModelCameraView)) => {
    setViewState((current) => {
      const next =
        typeof updater === 'function'
          ? (updater as (current: ModelCameraView) => ModelCameraView)(current)
          : updater;
      cameraCache.current.set(viewKey, next);
      return next;
    });
  };

  // Track the viewport size so the grid SVG and line math match the element.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef]);

  const zoomAtCenter = (factor: number) => {
    const centerX = size.width / 2;
    const centerY = size.height / 2;
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (centerX - current.panX) / current.scale;
      const worldY = (centerY - current.panY) / current.scale;
      return {
        scale,
        panX: centerX - worldX * scale,
        panY: centerY - worldY * scale,
      };
    });
  };

  const fitVisibleModel = () => {
    const bounds = getVisibleBounds();
    if (!bounds || size.width === 0 || size.height === 0) {
      setView(defaultView);
      return;
    }
    const minX = bounds.minX - FIT_WORLD_MARGIN_X;
    const maxX = bounds.maxX + FIT_WORLD_MARGIN_X;
    const minY = bounds.minY - FIT_WORLD_MARGIN_Y;
    const maxY = bounds.maxY + FIT_WORLD_MARGIN_Y;
    const scale = clamp(
      Math.min(
        (size.width - FIT_PADDING_PX) / Math.max(FIT_CONTENT_MIN.width, maxX - minX),
        (size.height - FIT_PADDING_PX) / Math.max(FIT_CONTENT_MIN.height, maxY - minY),
      ),
      MIN_SCALE,
      FIT_MAX_SCALE,
    );
    setView({
      scale,
      panX: (size.width - (minX + maxX) * scale) / 2,
      panY: (size.height - (minY + maxY) * scale) / 2,
    });
  };

  // A newly opened canvas should reveal the complete model once. After a
  // camera is stored, subsequent model edits preserve the user's view.
  const latest = useRef({ getVisibleBounds, contentVersion });
  latest.current = { getVisibleBounds, contentVersion };
  useEffect(() => {
    if (
      size.width > 0 &&
      size.height > 0 &&
      latest.current.contentVersion > 0 &&
      !cameraCache.current.has(viewKey)
    ) {
      fitVisibleModel();
    }
    // Deliberately narrow: reruns on viewport/view/content-version changes;
    // the guard makes later renders no-ops.
  }, [size.height, size.width, viewKey]);

  // Wheel = zoom about the cursor (native listener so preventDefault works).
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      setView((current) => {
        const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const worldX = (mx - current.panX) / current.scale;
        const worldY = (my - current.panY) / current.scale;
        return { scale, panX: mx - worldX * scale, panY: my - worldY * scale };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // elementRef is stable for the surface lifetime.
  }, []);

  return { view, setView, size, zoomAtCenter, fitVisibleModel, defaultView };
}

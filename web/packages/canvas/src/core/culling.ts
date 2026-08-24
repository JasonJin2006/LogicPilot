import type { GraphicTransform } from '@logicpilot/editor';

export interface WorldViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function worldViewportFromCamera(
  panX: number,
  panY: number,
  scale: number,
  width: number,
  height: number,
  overscanPx = 160,
): WorldViewport {
  return {
    left: (-panX - overscanPx) / scale,
    top: (-panY - overscanPx) / scale,
    right: (width - panX + overscanPx) / scale,
    bottom: (height - panY + overscanPx) / scale,
  };
}

/** Conservative rotated AABB check used to keep off-screen presentation
 * nodes out of the SVG/React tree. Overscan in the viewport prevents visible
 * popping while panning and leaves room for selection handles and shadows. */
export function graphicIntersectsViewport(
  transform: GraphicTransform,
  viewport: WorldViewport,
): boolean {
  const halfWidth = (Math.abs(transform.width * transform.scaleX) || 1) / 2;
  const halfHeight = (Math.abs(transform.height * transform.scaleY) || 1) / 2;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const skewX = Math.abs(Math.tan((transform.skewX * Math.PI) / 180));
  const skewY = Math.abs(Math.tan((transform.skewY * Math.PI) / 180));
  const extentX = cos * (halfWidth + skewX * halfHeight) + sin * halfHeight;
  const extentY = sin * halfWidth + cos * (halfHeight + skewY * halfWidth);
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  return !(
    centerX + extentX < viewport.left ||
    centerX - extentX > viewport.right ||
    centerY + extentY < viewport.top ||
    centerY - extentY > viewport.bottom
  );
}

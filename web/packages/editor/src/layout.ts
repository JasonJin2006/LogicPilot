// Frame layout: compute where a frame's children sit and how big the frame
// is. Auto layout (direction/gap/padding) places children in a row/column;
// without it, child constraints (left/right/center/scale) position them
// relative to the frame's baseSize as the frame resizes (Figma-style).
// Pure and testable - the renderer calls this instead of using the stored
// x/y directly.

import type { GraphicNode } from './presentation.js';

export interface FramePlacement {
  child: GraphicNode;
  x: number;
  y: number;
  /** Override size (constraint 'scale' grows the child with the frame). */
  width?: number;
  height?: number;
}

function applyConstraints(
  child: GraphicNode,
  base: { width: number; height: number },
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width?: number; height?: number } {
  const constraints = child.constraints;
  if (!constraints) {
    return { x: child.transform.x, y: child.transform.y };
  }
  const width = child.transform.width;
  const height = child.transform.height;
  let x = child.transform.x;
  let y = child.transform.y;
  let nextWidth: number | undefined;
  let nextHeight: number | undefined;
  const hScale = base.width > 0 ? frameWidth / base.width : 1;
  const vScale = base.height > 0 ? frameHeight / base.height : 1;
  const baseRight = base.width - (child.transform.x + width);
  const baseBottom = base.height - (child.transform.y + height);
  switch (constraints.horizontal) {
    case 'right':
      x = frameWidth - baseRight - width;
      break;
    case 'center':
      x = (frameWidth - base.width) / 2 + child.transform.x;
      break;
    case 'scale':
      x = child.transform.x * hScale;
      nextWidth = width * hScale;
      break;
    default:
      break; // 'left'
  }
  switch (constraints.vertical) {
    case 'bottom':
      y = frameHeight - baseBottom - height;
      break;
    case 'center':
      y = (frameHeight - base.height) / 2 + child.transform.y;
      break;
    case 'scale':
      y = child.transform.y * vScale;
      nextHeight = height * vScale;
      break;
    default:
      break; // 'top'
  }
  return { x, y, width: nextWidth, height: nextHeight };
}

export function computeFrameLayout(frame: GraphicNode): {
  width: number;
  height: number;
  placements: FramePlacement[];
} {
  const layout = frame.layout;
  const children = frame.children ?? [];
  const base = frame.baseSize ?? {
    width: frame.transform.width,
    height: frame.transform.height,
  };
  if (!layout) {
    return {
      width: frame.transform.width,
      height: frame.transform.height,
      placements: children.map((child) => {
        const applied = applyConstraints(
          child,
          base,
          frame.transform.width,
          frame.transform.height,
        );
        return {
          child,
          x: applied.x,
          y: applied.y,
          width: applied.width,
          height: applied.height,
        };
      }),
    };
  }
  const { direction, gap, padding } = layout;
  let cursor = padding;
  let cross = padding;
  const placements: FramePlacement[] = [];
  for (const child of children) {
    const w = child.transform.width;
    const h = child.transform.height;
    if (direction === 'horizontal') {
      placements.push({ child, x: cursor, y: padding });
      cursor += w + gap;
      cross = Math.max(cross, padding + h);
    } else {
      placements.push({ child, x: padding, y: cursor });
      cursor += h + gap;
      cross = Math.max(cross, padding + w);
    }
  }
  const content = Math.max(0, cursor - gap);
  return {
    width: direction === 'horizontal' ? content + padding : cross + padding,
    height: direction === 'vertical' ? content + padding : cross + padding,
    placements,
  };
}

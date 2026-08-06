// Frame auto-layout: compute where a frame's children sit and how big the
// frame grows to fit them (Figma-style). Pure and testable - the renderer
// calls this to position children instead of their stored x/y.

import type { GraphicNode } from './presentation.js';

export interface FramePlacement {
  child: GraphicNode;
  x: number;
  y: number;
}

export function computeFrameLayout(frame: GraphicNode): {
  width: number;
  height: number;
  placements: FramePlacement[];
} {
  const layout = frame.layout;
  const children = frame.children ?? [];
  if (!layout) {
    return {
      width: frame.transform.width,
      height: frame.transform.height,
      placements: children.map((child) => ({
        child,
        x: child.transform.x,
        y: child.transform.y,
      })),
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

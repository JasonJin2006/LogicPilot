// Selection chrome for the selected presentation object: a dashed bounding
// box, 8 resize handles (corners + edge midpoints) and a rotation handle
// above the top edge. Handles live in the object's unrotated local frame
// inside a group that shares the shape's transform, so the box rotates with
// the object. Drag math lives in ModelCanvas (it owns the view transform).

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PresentationObject } from '@logicpilot/editor';

export type ResizeHandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 10;
const ROTATE_OFFSET = 30;

const HANDLES: Array<{ name: ResizeHandleName; x: number; y: number }> = [
  { name: 'nw', x: 0, y: 0 },
  { name: 'n', x: 0.5, y: 0 },
  { name: 'ne', x: 1, y: 0 },
  { name: 'e', x: 1, y: 0.5 },
  { name: 'se', x: 1, y: 1 },
  { name: 's', x: 0.5, y: 1 },
  { name: 'sw', x: 0, y: 1 },
  { name: 'w', x: 0, y: 0.5 },
];

export const RESIZE_CURSOR: Record<ResizeHandleName, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

interface TransformHandlesProps {
  object: PresentationObject;
  ox: number;
  oy: number;
  onResizeStart: (handle: ResizeHandleName, event: ReactPointerEvent<SVGRectElement>) => void;
  onRotateStart: (event: ReactPointerEvent<SVGGElement>) => void;
}

export function TransformHandles({
  object,
  ox,
  oy,
  onResizeStart,
  onRotateStart,
}: TransformHandlesProps) {
  const t = object.transform;
  const w = t.width;
  const h = t.height;
  return (
    <g
      className="shape-transform"
      transform={`translate(${t.x - ox},${t.y - oy}) rotate(${t.rotation} ${w / 2} ${h / 2}) scale(${t.scaleX},${t.scaleY})`}
      pointerEvents="all"
    >
      <rect
        x={-HANDLE_SIZE / 2}
        y={-HANDLE_SIZE / 2}
        width={w + HANDLE_SIZE}
        height={h + HANDLE_SIZE}
        className="shape-selection-box"
      />
      {HANDLES.map((handle) => (
        <rect
          key={handle.name}
          className={`shape-handle handle-${handle.name}`}
          x={handle.x * w - HANDLE_SIZE / 2}
          y={handle.y * h - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          style={{ cursor: RESIZE_CURSOR[handle.name] }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart(handle.name, event);
          }}
        />
      ))}
      <g
        className="shape-rotate"
        style={{ cursor: 'crosshair' }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onRotateStart(event);
        }}
      >
        <line x1={w / 2} y1={-ROTATE_OFFSET} x2={w / 2} y2={-HANDLE_SIZE / 2} />
        <circle cx={w / 2} cy={-ROTATE_OFFSET - 6} r={5} />
      </g>
    </g>
  );
}

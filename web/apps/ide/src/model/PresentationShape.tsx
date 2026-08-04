// Presentation library shapes: AnyLogic-style drawing elements rendered as
// real SVG shapes on the modeling canvas (annotations, not process blocks).

import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ModelNode } from '@logicpilot/editor';

interface PresentationShapeProps {
  node: ModelNode;
  ox: number;
  oy: number;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerCancel: () => void;
}

const handlers = (
  props: PresentationShapeProps,
): {
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGGElement>) => void;
  onPointerCancel: () => void;
} => ({
  onPointerDown: props.onPointerDown,
  onPointerMove: props.onPointerMove,
  onPointerUp: props.onPointerUp,
  onPointerCancel: props.onPointerCancel,
});

export function PresentationShape(props: PresentationShapeProps) {
  const { node, ox, oy, selected } = props;
  const x = node.x - ox;
  const y = node.y - oy;
  const className = `model-shape kind-${node.kind}${selected ? ' selected' : ''}`;
  const kind = node.kind as string; // presentation kinds are not BlockKind

  switch (kind) {
    case 'rect':
      return (
        <g className={className} {...handlers(props)}>
          <rect x={x - 60} y={y - 40} width={120} height={80} />
        </g>
      );
    case 'roundedRect':
      return (
        <g className={className} {...handlers(props)}>
          <rect x={x - 60} y={y - 40} width={120} height={80} rx={12} />
        </g>
      );
    case 'oval':
      return (
        <g className={className} {...handlers(props)}>
          <ellipse cx={x} cy={y} rx={60} ry={40} />
        </g>
      );
    case 'line':
      return (
        <g className={className} {...handlers(props)}>
          <line x1={x - 60} y1={y} x2={x + 60} y2={y} />
        </g>
      );
    case 'polyline':
      return (
        <g className={className} {...handlers(props)}>
          <polyline points={`${x - 60},${y - 20} ${x - 20},${y + 20} ${x + 30},${y - 10} ${x + 60},${y + 20}`} />
        </g>
      );
    case 'arc':
      return (
        <g className={className} {...handlers(props)}>
          <path d={`M ${x - 60} ${y} A 60 40 0 1 1 ${x + 60} ${y}`} />
        </g>
      );
    case 'curve':
      return (
        <g className={className} {...handlers(props)}>
          <path d={`M ${x - 60} ${y + 20} C ${x - 20} ${y - 20}, ${x + 20} ${y + 20}, ${x + 60} ${y - 20}`} />
        </g>
      );
    case 'text':
      return (
        <g className={className} {...handlers(props)}>
          <text x={x} y={y + 4} textAnchor="middle">
            {node.name}
          </text>
        </g>
      );
    case 'image':
      return (
        <g className={className} {...handlers(props)}>
          <rect x={x - 50} y={y - 35} width={100} height={70} rx={4} />
          <path d={`M ${x - 40} ${y + 20} l 18 -24 14 18 10 -12 14 18`} />
        </g>
      );
    case 'group':
      return (
        <g className={className} {...handlers(props)}>
          <rect x={x - 60} y={y - 40} width={120} height={80} rx={6} strokeDasharray="6 4" />
        </g>
      );
    default:
      return null;
  }
}

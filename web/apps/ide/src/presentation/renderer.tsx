// Presentation scene-graph renderer: draws a PresentationObject as a real
// SVG shape inside the canvas shapes layer. Coordinates are world-based;
// `ox`/`oy` are the layer origin so shapes render inside the bounds-fitted
// svg that ModelCanvas mounts.

import type { ReactNode } from 'react';
import type { PresentationObject } from '@logicpilot/editor';

interface RendererProps {
  object: PresentationObject;
  ox: number;
  oy: number;
  className?: string;
}

function shapeFor(object: PresentationObject): ReactNode {
  const t = object.transform;
  const s = object.style;
  const w = t.width;
  const h = t.height;
  const stroke = {
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: s.dash,
    fill: s.fill,
    opacity: s.opacity,
  };
  switch (object.type) {
    case 'rect':
      return <rect x={0} y={0} width={w} height={h} {...stroke} />;
    case 'roundedRect':
      return <rect x={0} y={0} width={w} height={h} rx={Math.min(12, w / 2, h / 2)} {...stroke} />;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...stroke} />;
    case 'line':
      return (
        <line
          x1={0}
          y1={0}
          x2={w}
          y2={0}
          stroke={s.stroke}
          strokeWidth={s.strokeWidth}
          strokeDasharray={s.dash}
          opacity={s.opacity}
        />
      );
    case 'polyline':
      return (
        <polyline
          points={`${0},${h * 0.25} ${w * 0.33},${h * 0.75} ${w * 0.66},${h * 0.4} ${w},${h}`}
          {...stroke}
        />
      );
    case 'arc':
      return <path d={`M 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2}`} {...stroke} />;
    case 'curve':
      return (
        <path
          d={`M 0 ${h * 0.75} C ${w * 0.33} ${h * 0.25}, ${w * 0.66} ${h * 0.75}, ${w} ${h * 0.25}`}
          {...stroke}
        />
      );
    case 'text': {
      const ts = object.textStyle;
      const anchor = ts?.align === 'left' ? 'start' : ts?.align === 'right' ? 'end' : 'middle';
      return (
        <text
          x={ts?.align === 'left' ? 0 : w / 2}
          y={h / 2}
          textAnchor={anchor}
          dominantBaseline="central"
          fill={s.fill}
          stroke={s.strokeWidth > 0 ? s.stroke : 'none'}
          strokeWidth={s.strokeWidth}
          fontFamily={ts?.fontFamily}
          fontSize={ts?.fontSize}
          fontWeight={ts?.fontWeight}
          opacity={s.opacity}
        >
          {object.text ?? ''}
        </text>
      );
    }
    case 'image': {
      if (object.image?.src) {
        return (
          <image
            href={object.image.src}
            x={0}
            y={0}
            width={object.image.width || w}
            height={object.image.height || h}
            opacity={s.opacity}
          />
        );
      }
      return (
        <>
          <rect x={0} y={0} width={w} height={h} rx={4} {...stroke} />
          <path
            d={`M ${w * 0.15} ${h * 0.78} l ${w * 0.25} -${h * 0.42} ${w * 0.18} ${h * 0.26} ${w * 0.12} -${h * 0.18} ${w * 0.18} ${h * 0.34}`}
            {...stroke}
          />
        </>
      );
    }
    case 'group':
      return (
        <>
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            rx={6}
            {...stroke}
            strokeDasharray={s.dash ?? '6 4'}
          />
          {object.children?.map((child, index) => (
            <g key={index} transform={`translate(${child.transform.x},${child.transform.y})`}>
              {shapeFor(child)}
            </g>
          ))}
        </>
      );
    default:
      return null;
  }
}

export function PresentationRenderer({ object, ox, oy, className }: RendererProps) {
  const t = object.transform;
  const x = t.x - ox;
  const y = t.y - oy;
  return (
    <g
      className={className}
      transform={`translate(${x},${y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2}) scale(${t.scaleX},${t.scaleY})`}
    >
      {shapeFor(object)}
    </g>
  );
}

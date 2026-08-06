// Vector graphics scene-graph renderer. Draws a GraphicNode (shape with
// geometry, path, text, image or group) as real SVG inside the canvas shapes
// layer. Coordinates are world-based; `ox`/`oy` are the layer origin.

import type { ReactNode } from 'react';
import type { GraphicNode, GraphicStyle } from '@logicpilot/editor';

interface RendererProps {
  object: GraphicNode;
  ox: number;
  oy: number;
  className?: string;
  /** Stable id for gradient/filter element ids (pass the node id). */
  uid?: string;
}

function fillPaint(style: GraphicStyle, uid: string | undefined): string {
  const fill = style.fill;
  if (fill.kind === 'solid') {
    return fill.color;
  }
  if (fill.kind === 'image') {
    return `url(#pattern-${uid})`;
  }
  return `url(#grad-${uid})`;
}

function shapeFor(object: GraphicNode, uid: string | undefined): ReactNode {
  const t = object.transform;
  const s = object.style;
  const w = t.width;
  const h = t.height;
  const stroke = {
    stroke: s.stroke.color,
    strokeWidth: s.stroke.width,
    strokeDasharray: s.stroke.dash.length > 0 ? s.stroke.dash.join(' ') : undefined,
    strokeLinejoin: s.stroke.join,
    strokeLinecap: s.stroke.cap,
  };
  const fill = fillPaint(s, uid);
  switch (object.type) {
    case 'shape': {
      const g = object.geometry;
      if (g?.shapeType === 'ellipse') {
        return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={fill} {...stroke} />;
      }
      if (g?.shapeType === 'polygon') {
        const points = (g.points ?? []).map((p) => `${p.x * w},${p.y * h}`).join(' ');
        return <polygon points={points} fill={fill} {...stroke} />;
      }
      if (g?.shapeType === 'line') {
        return (
          <line
            x1={0}
            y1={0}
            x2={w}
            y2={0}
            stroke={s.stroke.color}
            strokeWidth={s.stroke.width}
            strokeDasharray={stroke.strokeDasharray}
            opacity={s.opacity}
          />
        );
      }
      const radius = Math.min(g?.radius ?? 0, w / 2, h / 2);
      return <rect x={0} y={0} width={w} height={h} rx={radius} fill={fill} {...stroke} />;
    }
    case 'path': {
      const d = object.path?.commands.join(' ') ?? '';
      return <path d={d} fill={fill} {...stroke} />;
    }
    case 'text': {
      const ts = object.textStyle;
      const anchor = ts?.align === 'left' ? 'start' : ts?.align === 'right' ? 'end' : 'middle';
      return (
        <text
          x={ts?.align === 'left' ? 0 : w / 2}
          y={h / 2}
          textAnchor={anchor}
          dominantBaseline="central"
          fill={s.fill.kind === 'solid' ? s.fill.color : s.stroke.color}
          stroke={s.stroke.width > 0 ? s.stroke.color : 'none'}
          strokeWidth={s.stroke.width}
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
          <rect x={0} y={0} width={w} height={h} rx={4} fill={fill} {...stroke} />
          <path
            d={`M ${w * 0.15} ${h * 0.78} l ${w * 0.25} -${h * 0.42} ${w * 0.18} ${h * 0.26} ${w * 0.12} -${h * 0.18} ${w * 0.18} ${h * 0.34}`}
            fill="none"
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
            fill="none"
            {...stroke}
            strokeDasharray={s.stroke.dash.length > 0 ? s.stroke.dash.join(' ') : '6 4'}
          />
          {object.children?.map((child, index) => (
            <PresentationRenderer
              key={index}
              object={child}
              ox={0}
              oy={0}
              uid={uid ? `${uid}-c${index}` : undefined}
            />
          ))}
        </>
      );
    default:
      return null;
  }
}

/** SVG defs for gradients, patterns, shadows and blur, keyed by uid. */
function shapeDefs(object: GraphicNode, uid: string | undefined): ReactNode {
  if (!uid) {
    return null;
  }
  const s = object.style;
  const t = object.transform;
  const defs: ReactNode[] = [];
  if (s.fill.kind === 'gradient') {
    defs.push(
      <linearGradient key="grad" id={`grad-${uid}`} gradientTransform={`rotate(${s.fill.angle})`}>
        {s.fill.stops.map((stop, index) => (
          <stop key={index} offset={`${stop.offset * 100}%`} stopColor={stop.color} />
        ))}
      </linearGradient>,
    );
  }
  if (s.fill.kind === 'image' && s.fill.src) {
    defs.push(
      <pattern
        key="pattern"
        id={`pattern-${uid}`}
        width={t.width}
        height={t.height}
        patternUnits="userSpaceOnUse"
      >
        <image href={s.fill.src} width={t.width} height={t.height} />
      </pattern>,
    );
  }
  if (s.shadow || s.blur) {
    defs.push(
      <filter key="fx" id={`fx-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
        {s.shadow && (
          <feDropShadow
            dx={s.shadow.x}
            dy={s.shadow.y}
            stdDeviation={s.shadow.blur}
            floodColor={s.shadow.color}
          />
        )}
        {s.blur ? <feGaussianBlur stdDeviation={s.blur} /> : null}
      </filter>,
    );
  }
  return defs.length > 0 ? <defs>{defs}</defs> : null;
}

export function PresentationRenderer({ object, ox, oy, className, uid }: RendererProps) {
  const t = object.transform;
  const x = t.x - ox;
  const y = t.y - oy;
  const filter = object.style.shadow || object.style.blur ? `url(#fx-${uid})` : undefined;
  return (
    <g
      className={className}
      transform={`translate(${x},${y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2}) scale(${t.scaleX},${t.scaleY}) skewX(${t.skewX}) skewY(${t.skewY})`}
      filter={filter}
    >
      {shapeDefs(object, uid)}
      {shapeFor(object, uid)}
    </g>
  );
}

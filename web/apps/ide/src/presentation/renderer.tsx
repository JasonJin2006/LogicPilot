// Vector graphics scene-graph renderer. Draws a GraphicNode (shape with
// geometry, path, text, image or group) as real SVG inside the canvas shapes
// layer. Coordinates are world-based; `ox`/`oy` are the layer origin.

import type { ReactNode } from 'react';
import type { GraphicNode, GraphicStyle } from '@logicpilot/editor';
import { computeFrameLayout, resolveGraphicBindings } from '@logicpilot/editor';

interface RendererProps {
  object: GraphicNode;
  ox: number;
  oy: number;
  className?: string;
  /** Stable id for gradient/filter element ids (pass the node id). */
  uid?: string;
  /** Live simulation variables (queueLength, busy, ...) to resolve bindings. */
  runtime?: Record<string, number>;
  /** Layout override: render at this position instead of transform.x/y
   *  (used by frame auto-layout for children). */
  offsetX?: number;
  offsetY?: number;
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

function shapeFor(
  object: GraphicNode,
  uid: string | undefined,
  runtime?: Record<string, number>,
): ReactNode {
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
  const markers = {
    markerStart:
      uid && s.stroke.startArrow && s.stroke.startArrow !== 'none'
        ? `url(#marker-start-${uid})`
        : undefined,
    markerEnd:
      uid && s.stroke.endArrow && s.stroke.endArrow !== 'none'
        ? `url(#marker-end-${uid})`
        : undefined,
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
      if (g?.shapeType === 'polyline') {
        const points = (g.points ?? []).map((p) => `${p.x * w},${p.y * h}`).join(' ');
        return <polyline points={points} fill="none" {...stroke} {...markers} />;
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
            {...markers}
          />
        );
      }
      const radius = Math.min(g?.radius ?? 0, w / 2, h / 2);
      return <rect x={0} y={0} width={w} height={h} rx={radius} fill={fill} {...stroke} />;
    }
    case 'path': {
      const d = object.path?.commands.join(' ') ?? '';
      return <path d={d} fill={fill} {...stroke} {...markers} />;
    }
    case 'text': {
      const ts = object.textStyle;
      const anchor = ts?.align === 'left' ? 'start' : ts?.align === 'right' ? 'end' : 'middle';
      const lines = (object.text ?? '').split('\n');
      const lineHeight = (ts?.lineHeight ?? 1.2) * (ts?.fontSize ?? 16);
      const textHeight = Math.max(1, lines.length) * lineHeight;
      const firstBaseline =
        ts?.verticalAlign === 'top'
          ? 0
          : ts?.verticalAlign === 'bottom'
            ? h - textHeight
            : (h - textHeight) / 2;
      const textX = ts?.align === 'left' ? 0 : ts?.align === 'right' ? w : w / 2;
      return (
        <text
          x={textX}
          y={firstBaseline}
          textAnchor={anchor}
          dominantBaseline="hanging"
          fill={s.fill.kind === 'solid' ? s.fill.color : s.stroke.color}
          stroke={s.stroke.width > 0 ? s.stroke.color : 'none'}
          strokeWidth={s.stroke.width}
          fontFamily={ts?.fontFamily}
          fontSize={ts?.fontSize}
          fontWeight={ts?.fontWeight}
          fontStyle={ts?.fontStyle}
          textDecoration={ts?.textDecoration}
          letterSpacing={ts?.letterSpacing}
          opacity={s.opacity}
        >
          {lines.map((line, index) => (
            <tspan key={index} x={textX} dy={index === 0 ? 0 : lineHeight}>
              {line || ' '}
            </tspan>
          ))}
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
              runtime={runtime}
            />
          ))}
        </>
      );
    case 'frame': {
      const { width: frameWidth, height: frameHeight, placements } = computeFrameLayout(object);
      return (
        <>
          <rect
            x={0}
            y={0}
            width={frameWidth}
            height={frameHeight}
            rx={6}
            fill={fill}
            {...stroke}
          />
          {object.clip && (
            <clipPath id={`clip-${uid}`}>
              <rect x={0} y={0} width={frameWidth} height={frameHeight} rx={6} />
            </clipPath>
          )}
          <g clipPath={object.clip ? `url(#clip-${uid})` : undefined}>
            {placements.map(({ child, x, y, width, height }, index) => (
              <PresentationRenderer
                key={index}
                object={
                  width !== undefined || height !== undefined
                    ? {
                        ...child,
                        transform: {
                          ...child.transform,
                          width: width ?? child.transform.width,
                          height: height ?? child.transform.height,
                        },
                      }
                    : child
                }
                ox={0}
                oy={0}
                uid={uid ? `${uid}-c${index}` : undefined}
                runtime={runtime}
                offsetX={x}
                offsetY={y}
              />
            ))}
          </g>
        </>
      );
    }
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
  const marker = (position: 'start' | 'end', kind: NonNullable<typeof s.stroke.startArrow>) => {
    const id = `marker-${position}-${uid}`;
    const common = {
      id,
      markerWidth: 8,
      markerHeight: 8,
      refX: 5,
      refY: 5,
      orient: 'auto-start-reverse' as const,
      markerUnits: 'strokeWidth' as const,
      viewBox: '0 0 10 10',
    };
    if (kind === 'circle') {
      return (
        <marker key={id} {...common}>
          <circle cx="5" cy="5" r="3" fill={s.stroke.color} />
        </marker>
      );
    }
    if (kind === 'diamond') {
      return (
        <marker key={id} {...common}>
          <path d="M 5 1 L 9 5 L 5 9 L 1 5 Z" fill={s.stroke.color} />
        </marker>
      );
    }
    return (
      <marker key={id} {...common} refX={8}>
        <path d="M 1 1 L 9 5 L 1 9 Z" fill={s.stroke.color} />
      </marker>
    );
  };
  if (s.stroke.startArrow && s.stroke.startArrow !== 'none') {
    defs.push(marker('start', s.stroke.startArrow));
  }
  if (s.stroke.endArrow && s.stroke.endArrow !== 'none') {
    defs.push(marker('end', s.stroke.endArrow));
  }
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

export function PresentationRenderer({
  object,
  ox,
  oy,
  className,
  uid,
  runtime,
  offsetX,
  offsetY,
}: RendererProps) {
  const resolved = runtime && object.binding ? resolveGraphicBindings(object, runtime) : object;
  if (resolved.visible === false) {
    return null;
  }
  const t = resolved.transform;
  const x = (offsetX ?? t.x) - ox;
  const y = (offsetY ?? t.y) - oy;
  const filter = resolved.style.shadow || resolved.style.blur ? `url(#fx-${uid})` : undefined;
  return (
    <g
      className={className}
      transform={`translate(${x},${y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2}) scale(${t.scaleX},${t.scaleY}) skewX(${t.skewX}) skewY(${t.skewY})`}
      filter={filter}
    >
      {shapeDefs(resolved, uid)}
      {shapeFor(resolved, uid, runtime)}
    </g>
  );
}

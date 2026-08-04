// Presentation shape primitives (AnyLogic presentation-shapes analog).
// Small SVG building blocks that element presentations compose into scenes.

import type { ReactNode } from 'react';

export interface RectProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
  opacity?: number;
}

export function Rect({
  x,
  y,
  width,
  height,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = 1,
  rx = 0,
  opacity = 1,
}: RectProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      rx={rx}
      opacity={opacity}
    />
  );
}

export function RoundedRect(props: RectProps) {
  return <Rect {...props} rx={props.rx ?? 8} />;
}

export interface OvalProps {
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export function Oval({
  cx,
  cy,
  r,
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = 1,
}: OvalProps) {
  return <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

export interface LineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
}

export function Line({
  x1,
  y1,
  x2,
  y2,
  stroke = 'currentColor',
  strokeWidth = 1,
  dashed = false,
  opacity = 1,
}: LineProps) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dashed ? '4 3' : undefined}
      opacity={opacity}
    />
  );
}

export interface TextProps {
  x: number;
  y: number;
  children: ReactNode;
  fill?: string;
  fontSize?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export function Text({
  x,
  y,
  children,
  fill = 'currentColor',
  fontSize = 11,
  anchor = 'start',
}: TextProps) {
  return (
    <text x={x} y={y} fill={fill} fontSize={fontSize} textAnchor={anchor}>
      {children}
    </text>
  );
}

/** A group of shapes (AnyLogic Canvas/Group). */
export function Group({ children }: { children: ReactNode }) {
  return <g>{children}</g>;
}

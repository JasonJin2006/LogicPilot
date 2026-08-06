// Vector Graphics Engine object model (Figma-style). A GraphicNode is a
// scene-graph node: `type` is one of shape / text / image / group / path.
// Shapes carry a `geometry` (rectangle with corner radius, ellipse, polygon
// or line) - rounded corners are a property of a rectangle, not a separate
// component type. Every node carries a transform (position/size/rotation/
// scale/skew) and a style (solid or gradient fill, stroke with dash/join/cap,
// opacity, shadow, blur).
//
// `normalizeGraphicNode` upgrades the legacy v3 canvas objects (type 'rect',
// 'roundedRect', 'ellipse', ...) to the unified model so existing projects
// keep rendering.

export type GraphicType = 'shape' | 'text' | 'image' | 'group' | 'path' | 'frame';
export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'line';

export interface Point {
  x: number;
  y: number;
}

export interface ShapeGeometry {
  shapeType: ShapeType;
  width: number;
  height: number;
  /** Corner radius for rectangles. */
  radius?: number;
  /** Polygon vertices as fractions of width/height (0..1). */
  points?: Point[];
}

export interface GraphicTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the object's centre. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

export type GraphicFill =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; angle: number; stops: Array<{ offset: number; color: string }> }
  | { kind: 'image'; src: string };

export interface GraphicStroke {
  color: string;
  width: number;
  dash: number[];
  join: 'miter' | 'round' | 'bevel';
  cap: 'butt' | 'round' | 'square';
}

export interface GraphicShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface GraphicStyle {
  fill: GraphicFill;
  stroke: GraphicStroke;
  opacity: number;
  shadow?: GraphicShadow;
  blur?: number;
}

export interface GraphicTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
}

export interface GraphicPath {
  commands: string[];
}

export interface GraphicNode {
  /** Present on top-level nodes via ModelNode.id; group children may be
   *  anonymous until ungrouped. */
  id?: string;
  type: GraphicType;
  transform: GraphicTransform;
  style: GraphicStyle;
  geometry?: ShapeGeometry;
  text?: string;
  textStyle?: GraphicTextStyle;
  image?: { src: string; width: number; height: number };
  path?: GraphicPath;
  children?: GraphicNode[];
  /** Simulation binding: live transform/style property -> expression over
   *  runtime variables (queueLength, busy, servers, downServers, tick). */
  binding?: { properties: Record<string, string> };
  /** Frame container options (type 'frame'): auto-layout + clipping. */
  layout?: { direction: 'horizontal' | 'vertical'; gap: number; padding: number };
  /** Clip children to the frame bounds. */
  clip?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultGraphicStyle(): GraphicStyle {
  return {
    fill: { kind: 'solid', color: '#ffffff' },
    stroke: { color: '#333333', width: 1.5, dash: [], join: 'miter', cap: 'butt' },
    opacity: 1,
  };
}

export function defaultGraphicTransform(
  x: number,
  y: number,
  width: number,
  height: number,
): GraphicTransform {
  return { x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
}

/** Build a shape node from its geometry. */
export function shapeNode(
  shapeType: ShapeType,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 0,
): GraphicNode {
  return {
    type: 'shape',
    transform: defaultGraphicTransform(x, y, width, height),
    style: defaultGraphicStyle(),
    geometry: { shapeType, width, height, radius: radius || undefined },
  };
}

export function textNode(x: number, y: number): GraphicNode {
  return {
    type: 'text',
    transform: defaultGraphicTransform(x, y, 120, 24),
    style: defaultGraphicStyle(),
    text: 'Text',
    textStyle: { fontFamily: 'Arial', fontSize: 16, fontWeight: 400, align: 'center' },
  };
}

export function imageNode(x: number, y: number): GraphicNode {
  return {
    type: 'image',
    transform: defaultGraphicTransform(x, y, 120, 80),
    style: defaultGraphicStyle(),
  };
}

export function groupNode(x: number, y: number, children: GraphicNode[] = []): GraphicNode {
  return {
    type: 'group',
    transform: defaultGraphicTransform(x, y, 120, 80),
    style: defaultGraphicStyle(),
    children,
  };
}

export function frameNode(
  x: number,
  y: number,
  children: GraphicNode[] = [
    shapeNode('rectangle', 0, 0, 80, 48, 6),
    shapeNode('ellipse', 0, 0, 48, 48),
    shapeNode('rectangle', 0, 0, 96, 40, 6),
  ],
): GraphicNode {
  return {
    type: 'frame',
    transform: defaultGraphicTransform(x, y, 280, 64),
    style: defaultGraphicStyle(),
    layout: { direction: 'horizontal', gap: 12, padding: 16 },
    clip: false,
    children,
  };
}

export function pathNode(
  x: number,
  y: number,
  commands: string[],
  width: number,
  height: number,
): GraphicNode {
  return {
    type: 'path',
    transform: defaultGraphicTransform(x, y, width, height),
    style: defaultGraphicStyle(),
    path: { commands },
  };
}

/** Palette kind -> a fresh GraphicNode with the matching geometry. */
export function createGraphicNode(kind: string, x: number, y: number): GraphicNode {
  switch (kind) {
    case 'rect':
      return shapeNode('rectangle', x, y, 120, 80);
    case 'roundedRect':
      return shapeNode('rectangle', x, y, 120, 80, 12);
    case 'oval':
      return shapeNode('ellipse', x, y, 120, 80);
    case 'line':
      return shapeNode('line', x, y, 120, 0);
    case 'polyline':
      return {
        ...shapeNode('polygon', x, y, 120, 64),
        geometry: {
          shapeType: 'polygon',
          width: 120,
          height: 64,
          points: [
            { x: 0, y: 0.25 },
            { x: 0.33, y: 0.75 },
            { x: 0.66, y: 0.4 },
            { x: 1, y: 1 },
          ],
        },
      };
    case 'arc':
      return pathNode(x, y, ['M 0 32 A 60 32 0 1 1 120 32'], 120, 64);
    case 'curve':
      return pathNode(x, y, ['M 0 48 C 40 16, 80 48, 120 16'], 120, 64);
    case 'text':
      return textNode(x, y);
    case 'image':
      return imageNode(x, y);
    case 'group':
      return groupNode(x, y);
    case 'frame':
      return frameNode(x, y);
    default:
      return shapeNode('rectangle', x, y, 120, 80);
  }
}

// ---------------------------------------------------------------------------
// Legacy migration (canvas v3 objects saved with the old model)
// ---------------------------------------------------------------------------

function normalizeTransform(value: unknown): GraphicTransform | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const number = (key: string, fallback: number) =>
    typeof raw[key] === 'number' ? (raw[key] as number) : fallback;
  return {
    x: number('x', 0),
    y: number('y', 0),
    width: number('width', 120),
    height: number('height', 80),
    rotation: number('rotation', 0),
    scaleX: number('scaleX', 1),
    scaleY: number('scaleY', 1),
    skewX: number('skewX', 0),
    skewY: number('skewY', 0),
  };
}

function normalizeStyle(value: unknown): GraphicStyle {
  const base = defaultGraphicStyle();
  if (!value || typeof value !== 'object') {
    return base;
  }
  const raw = value as Record<string, unknown>;
  const fill = raw.fill as unknown;
  if (fill && typeof fill === 'object' && 'kind' in (fill as object)) {
    base.fill = fill as GraphicStyle['fill'];
  } else if (typeof fill === 'string') {
    base.fill = { kind: 'solid', color: fill };
  }
  const stroke = raw.stroke as unknown;
  if (stroke && typeof stroke === 'object' && 'color' in (stroke as object)) {
    base.stroke = stroke as GraphicStyle['stroke'];
  } else if (typeof stroke === 'string') {
    base.stroke = { ...base.stroke, color: stroke };
  }
  if (typeof raw.strokeWidth === 'number') {
    base.stroke.width = raw.strokeWidth;
  }
  if (typeof raw.dash === 'string') {
    base.stroke.dash = raw.dash
      .split(/\s+/)
      .map(Number)
      .filter((entry) => Number.isFinite(entry));
  }
  if (typeof raw.opacity === 'number') {
    base.opacity = raw.opacity;
  }
  return base;
}

/** Legacy shape types -> unified ShapeGeometry. */
function legacyGeometry(type: string, t: GraphicTransform): ShapeGeometry | undefined {
  if (type === 'rect') {
    return { shapeType: 'rectangle', width: t.width, height: t.height };
  }
  if (type === 'roundedRect') {
    return {
      shapeType: 'rectangle',
      width: t.width,
      height: t.height,
      radius: Math.min(12, t.width / 2, t.height / 2),
    };
  }
  if (type === 'ellipse' || type === 'oval') {
    return { shapeType: 'ellipse', width: t.width, height: t.height };
  }
  if (type === 'line') {
    return { shapeType: 'line', width: t.width, height: t.height };
  }
  if (type === 'polyline') {
    return {
      shapeType: 'polygon',
      width: t.width,
      height: t.height,
      points: [
        { x: 0, y: 0.25 },
        { x: 0.33, y: 0.75 },
        { x: 0.66, y: 0.4 },
        { x: 1, y: 1 },
      ],
    };
  }
  return undefined;
}

function legacyPath(type: string, t: GraphicTransform): GraphicPath {
  if (type === 'arc') {
    return {
      commands: [
        `M 0 ${t.height / 2} A ${t.width / 2} ${t.height / 2} 0 1 1 ${t.width} ${t.height / 2}`,
      ],
    };
  }
  return {
    commands: [
      `M 0 ${t.height * 0.75} C ${t.width * 0.33} ${t.height * 0.25}, ${t.width * 0.66} ${t.height * 0.75}, ${t.width} ${t.height * 0.25}`,
    ],
  };
}

/** Upgrade a legacy or new-style presentation object to a GraphicNode.
 *  Returns null when the payload is not a presentation object. */
export function normalizeGraphicNode(value: unknown): GraphicNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const transform = normalizeTransform(raw.transform);
  if (!transform) {
    return null;
  }
  const style = normalizeStyle(raw.style);
  const legacyType = typeof raw.type === 'string' ? raw.type : 'shape';
  const node: GraphicNode = {
    type: legacyType as GraphicType,
    transform,
    style,
  };
  if (
    legacyType === 'rect' ||
    legacyType === 'roundedRect' ||
    legacyType === 'ellipse' ||
    legacyType === 'oval' ||
    legacyType === 'line' ||
    legacyType === 'polyline'
  ) {
    node.type = 'shape';
    node.geometry = legacyGeometry(legacyType, transform);
  } else if (legacyType === 'arc' || legacyType === 'curve') {
    node.type = 'path';
    node.path = legacyPath(legacyType, transform);
  }
  if (typeof raw.text === 'string') {
    node.text = raw.text;
  }
  if (raw.textStyle && typeof raw.textStyle === 'object') {
    node.textStyle = raw.textStyle as GraphicTextStyle;
  }
  if (raw.image && typeof raw.image === 'object') {
    node.image = raw.image as GraphicNode['image'];
  }
  if (raw.path && typeof raw.path === 'object') {
    node.path = raw.path as GraphicPath;
  }
  if (raw.geometry && typeof raw.geometry === 'object') {
    node.geometry = { ...(raw.geometry as ShapeGeometry) };
  }
  if (Array.isArray(raw.children)) {
    node.children = raw.children
      .map((child) => normalizeGraphicNode(child))
      .filter((child): child is GraphicNode => child !== null);
  }
  if (raw.binding && typeof raw.binding === 'object') {
    node.binding = raw.binding as GraphicNode['binding'];
  }
  if (raw.layout && typeof raw.layout === 'object') {
    node.layout = raw.layout as GraphicNode['layout'];
  }
  if (typeof raw.clip === 'boolean') {
    node.clip = raw.clip;
  }
  return node;
}

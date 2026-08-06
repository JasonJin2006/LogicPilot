// Boolean path operations (Figma-style Union / Subtract / Intersect /
// Exclude) over shape nodes. Shapes are converted to polygons (rectangles
// by corners, ellipses sampled, polygons as-is) and combined with the
// martinez-based polygon-clipping library; the result becomes a `path` node
// whose commands describe the resulting rings.

import polygonClipping from 'polygon-clipping';
import { defaultGraphicStyle, type GraphicNode } from './presentation.js';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

type Point2 = [number, number];

function nodeToPolygon(node: GraphicNode): Point2[][] | null {
  const t = node.transform;
  if (node.type !== 'shape') {
    return null;
  }
  const g = node.geometry;
  if (g?.shapeType === 'rectangle') {
    return [
      [
        [t.x, t.y],
        [t.x + t.width, t.y],
        [t.x + t.width, t.y + t.height],
        [t.x, t.y + t.height],
      ],
    ];
  }
  if (g?.shapeType === 'ellipse') {
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const rx = t.width / 2;
    const ry = t.height / 2;
    const points: Point2[] = [];
    const segments = 32;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    }
    return [points];
  }
  if (g?.shapeType === 'polygon' && g.points && g.points.length >= 3) {
    return [g.points.map((p): Point2 => [t.x + p.x * t.width, t.y + p.y * t.height])];
  }
  return null;
}

function ringsToCommands(rings: Point2[][]): string[] {
  const commands: string[] = [];
  for (const ring of rings) {
    if (ring.length === 0) {
      continue;
    }
    commands.push(`M ${ring[0]![0]} ${ring[0]![1]}`);
    for (let i = 1; i < ring.length; i++) {
      commands.push(`L ${ring[i]![0]} ${ring[i]![1]}`);
    }
    commands.push('Z');
  }
  return commands;
}

export function booleanShapes(nodes: GraphicNode[], op: BooleanOp): GraphicNode | null {
  const polygons = nodes
    .map(nodeToPolygon)
    .filter((polygon): polygon is Point2[][] => polygon !== null);
  if (polygons.length < 2) {
    return null;
  }
  const [first, second, ...rest] = polygons;
  if (!first || !second) {
    return null;
  }
  let result: Point2[][][];
  try {
    if (op === 'union') {
      result = polygonClipping.union(first, second, ...rest);
    } else if (op === 'subtract') {
      result = polygonClipping.difference(first, ...polygons.slice(1));
    } else if (op === 'intersect') {
      result = polygonClipping.intersection(first, second, ...rest);
    } else {
      result = polygonClipping.xor(first, second, ...rest);
    }
  } catch {
    return null;
  }
  const rings: Point2[][] = result.flat();
  if (rings.length === 0) {
    return null;
  }
  const flat = rings.flat();
  const xs = flat.map((point) => point[0]);
  const ys = flat.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    type: 'path',
    transform: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
    },
    style: nodes[0]!.style
      ? { ...nodes[0]!.style, stroke: { ...nodes[0]!.style.stroke } }
      : defaultGraphicStyle(),
    path: { commands: ringsToCommands(rings) },
  };
}

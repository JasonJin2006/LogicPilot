import { describe, expect, it } from 'vitest';
import { booleanShapes, createGraphicNode, shapeNode, type GraphicNode } from '../src/index.js';

function area(node: GraphicNode | null): number {
  if (!node || node.type !== 'path') {
    return 0;
  }
  const points: number[][] = [];
  for (const command of node.path?.commands ?? []) {
    const match = /^([ML])\s+(-?[0-9.]+)\s+(-?[0-9.]+)$/.exec(command.trim());
    if (match) {
      points.push([parseFloat(match[2]!), parseFloat(match[3]!)]);
    }
  }
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

const rectA = () => shapeNode('rectangle', 0, 0, 10, 10);
const rectB = () => shapeNode('rectangle', 5, 5, 10, 10);

describe('boolean shapes', () => {
  it('unions two overlapping rectangles', () => {
    const result = booleanShapes([rectA(), rectB()], 'union');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('path');
    expect(area(result)).toBeCloseTo(175, 5);
  });

  it('subtracts the second from the first', () => {
    expect(area(booleanShapes([rectA(), rectB()], 'subtract'))).toBeCloseTo(75, 5);
  });

  it('intersects to the overlap', () => {
    expect(area(booleanShapes([rectA(), rectB()], 'intersect'))).toBeCloseTo(25, 5);
  });

  it('excludes the overlap', () => {
    expect(area(booleanShapes([rectA(), rectB()], 'exclude'))).toBeCloseTo(150, 5);
  });

  it('requires two shape nodes', () => {
    const text = createGraphicNode('text', 0, 0);
    expect(booleanShapes([rectA()], 'union')).toBeNull();
    expect(booleanShapes([text, rectB()], 'union')).toBeNull();
  });
});

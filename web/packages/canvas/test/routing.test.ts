import { describe, expect, it } from 'vitest';
import { defaultGraphicTransform } from '@logicpilot/editor';
import { routeOrthogonal } from '../src/core/routing';

describe('orthogonal connector routing', () => {
  it('leaves a horizontal source from its facing edge', () => {
    const route = routeOrthogonal(
      defaultGraphicTransform(0, 0, 40, 20),
      defaultGraphicTransform(100, 40, 30, 20),
    );
    expect(route.transform.x).toBe(40);
    expect(route.points[0]).toEqual({ x: 0, y: 0 });
    expect(route.points.at(-1)).toEqual({ x: 1, y: 1 });
    expect(route.points).toHaveLength(4);
  });

  it('uses vertical facing edges when vertical distance dominates', () => {
    const route = routeOrthogonal(
      defaultGraphicTransform(20, 0, 20, 20),
      defaultGraphicTransform(0, 100, 20, 20),
    );
    expect(route.transform.y).toBe(20);
    expect(route.points[0]?.y).toBe(0);
    expect(route.points.at(-1)?.y).toBe(1);
  });
});

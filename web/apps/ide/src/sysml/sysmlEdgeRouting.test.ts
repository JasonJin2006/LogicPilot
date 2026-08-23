import { describe, expect, it } from 'vitest';
import {
  orthogonalRoute,
  polylineLabelPoint,
  routePathData,
} from './sysmlEdgeRouting';

const rect = (x: number, y: number, width = 196, height = 62) => ({ x, y, width, height });

describe('sysmlEdgeRouting (orthogonal Manhattan routes)', () => {
  it('routes horizontally separated boxes through one vertical channel', () => {
    const route = orthogonalRoute(rect(0, 0), rect(400, 120));
    expect(route).toHaveLength(4);
    // Exits the source's right border and enters the target's left border.
    expect(route[0]).toEqual({ x: 196, y: 31 });
    expect(route[3]).toEqual({ x: 400, y: 151 });
    const [channelX] = [route[1]!.x];
    expect(channelX).toBe((196 + 400) / 2);
    expect(route[1]!.y).toBe(31);
    expect(route[2]!.x).toBe(channelX);
    expect(route[2]!.y).toBe(151);
    // x never moves backwards along the channel.
    expect(route.map((pt) => pt.x)).toEqual([196, 298, 298, 400]);
  });

  it('keeps a straight two-point line when both centers align', () => {
    const route = orthogonalRoute(rect(0, 100), rect(400, 100));
    expect(route).toEqual([
      { x: 196, y: 131 },
      { x: 400, y: 131 },
    ]);
  });

  it('mirrors the channel when the target lies to the left', () => {
    const route = orthogonalRoute(rect(500, 0), rect(0, 200));
    expect(route[0]).toEqual({ x: 500, y: 31 });
    expect(route[3]).toEqual({ x: 196, y: 231 });
    expect(route[1]!.x).toBe((500 + 196) / 2);
  });

  it('routes vertically separated boxes through a horizontal channel', () => {
    const route = orthogonalRoute(rect(0, 0), rect(60, 300));
    expect(route).toHaveLength(4);
    expect(route[0]).toEqual({ x: 98, y: 62 });
    expect(route[3]).toEqual({ x: 158, y: 300 });
    const channelY = route[1]!.y;
    expect(channelY).toBe((62 + 300) / 2);
    expect(route[2]).toEqual({ x: 158, y: channelY });
  });

  it('escapes around the right side when boxes overlap on both axes', () => {
    const route = orthogonalRoute(rect(0, 0), rect(50, 20));
    expect(route).toHaveLength(4);
    // The escape channel sits beyond BOTH right borders.
    const channelX = Math.max(196, 246) + 48;
    expect(route[1]!.x).toBe(channelX);
    expect(route[2]!.x).toBe(channelX);
    // Starts on the source's right border, ends on the target's left.
    expect(route[0]).toEqual({ x: 196, y: 31 });
    expect(route[3]).toEqual({ x: 50, y: 51 });
  });

  it('places labels at half the polyline arc length', () => {
    // H-V-H with legs 102/0/… : midpoint of total length lands mid-channel.
    const route = orthogonalRoute(rect(0, 0), rect(400, 120));
    const label = polylineLabelPoint(route);
    expect(label.x).toBe(298);
    // Total length 102+120+102=324; half is 162 → down the vertical leg by
    // 162-102=60 from y=31.
    expect(label.y).toBe(91);
  });

  it('emits compact SVG path data', () => {
    const d = routePathData([
      { x: 1.5, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(d).toBe('M1.5 2 L3 4');
  });
});

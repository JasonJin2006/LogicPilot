import { describe, expect, it } from 'vitest';
import { snapRect } from '../src/core/snapping';

describe('canvas snapping', () => {
  const peer = { id: 'peer', x: 100, y: 80, width: 40, height: 30 };

  it('snaps matching edges and emits both smart guides', () => {
    const result = snapRect({ id: 'moving', x: 96, y: 76, width: 20, height: 30 }, [peer], 5);
    expect(result.x).toBe(100);
    expect(result.y).toBe(80);
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x', 'y']);
  });

  it('snaps centre anchors as well as edges', () => {
    const result = snapRect({ id: 'moving', x: 109, y: 84, width: 20, height: 20 }, [peer], 2);
    expect(result.x).toBe(110);
    expect(result.y).toBe(85);
  });

  it('leaves the object untouched outside the threshold', () => {
    expect(snapRect({ id: 'moving', x: 20, y: 20, width: 20, height: 20 }, [peer], 5)).toEqual({
      x: 20,
      y: 20,
      guides: [],
    });
  });

  it('chooses the closest candidate deterministically', () => {
    const result = snapRect(
      { id: 'moving', x: 150, y: 0, width: 10, height: 10 },
      [peer, { id: 'closer', x: 147, y: 200, width: 10, height: 10 }],
      12,
    );
    expect(result.x).toBe(152);
  });
});

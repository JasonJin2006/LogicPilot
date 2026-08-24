import { describe, expect, it } from 'vitest';
import { PressGesture } from '../src/core/gestures';

describe('PressGesture', () => {
  it('classifies a still press as a click (never crossed)', () => {
    const g = new PressGesture();
    g.begin({ x: 10, y: 10 });
    g.update({ x: 11, y: 11 });
    g.update({ x: 12, y: 12 });
    expect(g.moved).toBe(false);
  });

  it('fires the drag-start edge exactly once when crossing the slop', () => {
    const g = new PressGesture();
    g.begin({ x: 0, y: 0 });
    expect(g.update({ x: 1, y: 1 })).toBe(false); // ~1.4 < 3
    expect(g.update({ x: 2.5, y: 2.5 })).toBe(true); // crosses
    expect(g.update({ x: 40, y: 40 })).toBe(false); // already fired
    expect(g.moved).toBe(true);
  });

  it('honors a custom slop radius', () => {
    const g = new PressGesture();
    g.begin({ x: 0, y: 0 }, 4);
    expect(g.update({ x: 3, y: 2 })).toBe(false); // 3.6 < 4
    expect(g.update({ x: 4, y: 0 })).toBe(true); // exactly 4
  });

  it('end() resets so the instance can be reused', () => {
    const g = new PressGesture();
    g.begin({ x: 0, y: 0 }, 2);
    g.update({ x: 9, y: 9 });
    expect(g.moved).toBe(true);
    g.end();
    expect(g.active).toBe(false);
    expect(g.moved).toBe(false);
    g.begin({ x: 0, y: 0 }, 2);
    g.update({ x: 1, y: 1 });
    expect(g.moved).toBe(false); // fresh press
  });

  it('rejects non-positive slop radius', () => {
    const g = new PressGesture();
    expect(() => g.begin({ x: 0, y: 0 }, 0)).toThrow(RangeError);
  });

  it('exposes the press origin as a copy and nulls it after end()', () => {
    const g = new PressGesture();
    expect(g.origin).toBeNull();
    g.begin({ x: 5, y: 7 });
    const origin = g.origin!;
    expect(origin).toEqual({ x: 5, y: 7 });
    g.end();
    expect(g.origin).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  parsePathCommands,
  pathPointList,
  removePathPoint,
  updatePathPoint,
} from '../src/index.js';

const SAMPLE = ['M 10 20', 'L 30 40', 'L 50 60', 'C 0 0 5 5 70 80', 'Z'];

describe('path command helpers', () => {
  it('parses commands and their numeric args', () => {
    const parsed = parsePathCommands(SAMPLE);
    expect(parsed.map((cmd) => cmd.command)).toEqual(['M', 'L', 'L', 'C', 'Z']);
    expect(parsed[1]!.args).toEqual([30, 40]);
    expect(parsed[3]!.args).toEqual([0, 0, 5, 5, 70, 80]);
  });

  it('lists every coordinate pair as an editable point', () => {
    const points = pathPointList(SAMPLE);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ commandIndex: 0, argIndex: 0, x: 10, y: 20 });
    expect(points[5]).toEqual({ commandIndex: 3, argIndex: 4, x: 70, y: 80 });
  });

  it('moves a point by rewriting only its coordinate pair', () => {
    const next = updatePathPoint(SAMPLE, { commandIndex: 1, argIndex: 0, x: 99, y: 88 }, 99, 88);
    expect(next[1]).toBe('L 99 88');
    expect(next[0]).toBe('M 10 20');
  });

  it('removes a non-anchor command and keeps the first M', () => {
    const next = removePathPoint(SAMPLE, { commandIndex: 2, argIndex: 0, x: 0, y: 0 });
    expect(next).toHaveLength(4);
    expect(next[0]).toBe('M 10 20');
    expect(next).not.toContain('L 50 60');
    // The first M cannot be deleted.
    expect(removePathPoint(SAMPLE, { commandIndex: 0, argIndex: 0, x: 0, y: 0 })).toEqual(SAMPLE);
  });
});

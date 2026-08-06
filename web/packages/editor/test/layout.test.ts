import { describe, expect, it } from 'vitest';
import { computeFrameLayout, frameNode, shapeNode } from '../src/index.js';

describe('frame auto layout', () => {
  it('places children horizontally with padding and gap', () => {
    const frame = frameNode(0, 0, [
      shapeNode('rectangle', 0, 0, 80, 40),
      shapeNode('rectangle', 0, 0, 48, 40),
    ]);
    frame.layout = { direction: 'horizontal', gap: 12, padding: 16 };
    const { width, height, placements } = computeFrameLayout(frame);
    expect(placements.map((p) => p.x)).toEqual([16, 108]);
    expect(placements[0]!.y).toBe(16);
    expect(width).toBe(172);
    expect(height).toBe(72);
  });

  it('stacks children vertically', () => {
    const frame = frameNode(0, 0, [
      shapeNode('rectangle', 0, 0, 40, 20),
      shapeNode('rectangle', 0, 0, 40, 30),
    ]);
    frame.layout = { direction: 'vertical', gap: 8, padding: 10 };
    const { height, placements } = computeFrameLayout(frame);
    expect(placements.map((p) => p.y)).toEqual([10, 38]);
    expect(height).toBe(78);
  });

  it('uses child positions when no auto layout is set', () => {
    const child = shapeNode('rectangle', 30, 40, 50, 20);
    const frame = frameNode(0, 0, [child]);
    frame.layout = undefined;
    const { placements, width } = computeFrameLayout(frame);
    expect(placements[0]!.x).toBe(30);
    expect(placements[0]!.y).toBe(40);
    expect(width).toBe(frame.transform.width);
  });

  it('applies child constraints when the frame resizes', () => {
    const child = shapeNode('rectangle', 10, 10, 50, 30);
    child.constraints = { horizontal: 'right', vertical: 'bottom' };
    const frame = frameNode(0, 0, [child]);
    frame.layout = undefined;
    frame.baseSize = { width: 200, height: 100 };
    frame.transform.width = 300;
    frame.transform.height = 150;
    const { placements } = computeFrameLayout(frame);
    expect(placements[0]!.x).toBe(110);
    expect(placements[0]!.y).toBe(60);
  });

  it('scales children with the frame', () => {
    const child = shapeNode('rectangle', 10, 10, 50, 30);
    child.constraints = { horizontal: 'scale', vertical: 'scale' };
    const frame = frameNode(0, 0, [child]);
    frame.layout = undefined;
    frame.baseSize = { width: 200, height: 100 };
    frame.transform.width = 400;
    frame.transform.height = 200;
    const { placements } = computeFrameLayout(frame);
    expect(placements[0]!.x).toBe(20);
    expect(placements[0]!.y).toBe(20);
    expect(placements[0]!.width).toBe(100);
    expect(placements[0]!.height).toBe(60);
  });

  it('keeps constrained children centred on resize', () => {
    const child = shapeNode('rectangle', 10, 10, 50, 30);
    child.constraints = { horizontal: 'center', vertical: 'center' };
    const frame = frameNode(0, 0, [child]);
    frame.layout = undefined;
    frame.baseSize = { width: 200, height: 100 };
    frame.transform.width = 300;
    frame.transform.height = 150;
    const { placements } = computeFrameLayout(frame);
    expect(placements[0]!.x).toBe(60);
    expect(placements[0]!.y).toBe(35);
  });
});

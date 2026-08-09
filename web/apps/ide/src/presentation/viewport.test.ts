import { describe, expect, it } from 'vitest';
import { defaultGraphicTransform } from '@logicpilot/editor';
import { graphicIntersectsViewport, worldViewportFromCamera } from './viewport';

describe('presentation viewport culling', () => {
  it('maps the screen viewport into world coordinates with overscan', () => {
    expect(worldViewportFromCamera(50, 20, 2, 800, 600, 100)).toEqual({
      left: -75,
      top: -60,
      right: 425,
      bottom: 340,
    });
  });

  it('keeps intersecting and rotated shapes while rejecting distant shapes', () => {
    const viewport = { left: 0, top: 0, right: 500, bottom: 400 };
    expect(graphicIntersectsViewport(defaultGraphicTransform(460, 360, 80, 80), viewport)).toBe(
      true,
    );
    const rotated = { ...defaultGraphicTransform(488, 120, 120, 20), rotation: 45 };
    expect(graphicIntersectsViewport(rotated, viewport)).toBe(true);
    expect(graphicIntersectsViewport(defaultGraphicTransform(1000, 1000, 80, 80), viewport)).toBe(
      false,
    );
  });
});

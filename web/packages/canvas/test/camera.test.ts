import { describe, expect, it } from 'vitest';
import { fitBounds, zoomAtPoint, type Camera } from '../src/core/camera';

const camera: Camera = { scale: 1, panX: 0, panY: 0 };

describe('camera math', () => {
  it('zoomAtPoint keeps the focal world position pinned', () => {
    const view = zoomAtPoint({ scale: 1, panX: -100, panY: -50 }, 2, 300, 200, 0.1, 5);
    // The world point under the focal screen position must not move.
    const beforeX = (300 - -100) / 1;
    const afterX = (300 - view.panX) / view.scale;
    expect(afterX).toBeCloseTo(beforeX, 10);
    expect(view.scale).toBe(2);
  });

  it('zoomAtPoint clamps to the configured scale range', () => {
    expect(zoomAtPoint(camera, 100, 0, 0, 0.1, 5).scale).toBe(5);
    expect(zoomAtPoint({ scale: 4, panX: 0, panY: 0 }, 0.001, 0, 0, 0.1, 5).scale).toBe(0.1);
  });

  it('fitBounds centers and scales content inside the viewport', () => {
    const view = fitBounds(
      { minX: 0, minY: 0, maxX: 800, maxY: 400 },
      { width: 896, height: 496 },
      { minScale: 0.1, maxScale: 1.4, padding: 96 },
    );
    expect(view).not.toBeNull();
    if (!view) return;
    // Content is 800x400 into 896-96=800 x 496-96=400 -> scale exactly 1.
    expect(view.scale).toBe(1);
    expect(view.panX).toBeCloseTo(896 / 2 - 400 * view.scale, 6);
    // Vertical centering: content center y=200 maps to viewport middle.
    expect(view.panY + 200 * view.scale).toBeCloseTo(496 / 2, 6);
  });

  it('fitBounds returns null without content or viewport', () => {
    expect(fitBounds(null, { width: 800, height: 600 }, { minScale: 0.1, maxScale: 1 })).toBeNull();
    expect(
      fitBounds(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { width: 0, height: 0 },
        { minScale: 0.1, maxScale: 1 },
      ),
    ).toBeNull();
  });
});

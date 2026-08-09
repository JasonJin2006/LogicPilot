import { describe, expect, it } from 'vitest';
import { usePaletteStore } from './paletteStore';

describe('palette drawing mode', () => {
  it('arms and cancels a drawable presentation item', () => {
    usePaletteStore.getState().stopDrawing();
    usePaletteStore.getState().startDrawing('polyline');
    expect(usePaletteStore.getState().drawingKind).toBe('polyline');

    usePaletteStore.getState().stopDrawing();
    expect(usePaletteStore.getState().drawingKind).toBeNull();
  });
});

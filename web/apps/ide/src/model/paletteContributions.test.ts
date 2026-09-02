import { describe, expect, it } from 'vitest';
import { PALETTE_CONTRIBUTIONS } from '../workbench/palette';
import { registerModelPaletteContributions } from './paletteContributions';

describe('model palette plugin contribution', () => {
  it('rolls back earlier library registrations when a later one conflicts', () => {
    const disposeConflict = PALETTE_CONTRIBUTIONS.register({
      id: 'logicpilot.presentation',
      library: { id: 'conflict', name: 'Conflict' },
      items: [],
    });
    try {
      expect(() => registerModelPaletteContributions()).toThrow(/already registered/);
      expect(PALETTE_CONTRIBUTIONS.itemsFor('process')).toEqual([]);
      expect(PALETTE_CONTRIBUTIONS.list().map((entry) => entry.id)).toEqual([
        'logicpilot.presentation',
      ]);
    } finally {
      disposeConflict();
    }
  });
});

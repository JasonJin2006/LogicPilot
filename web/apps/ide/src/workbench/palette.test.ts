import { describe, expect, it } from 'vitest';
import { PALETTE_CONTRIBUTIONS, type PaletteContribution } from './palette';
// Registers the built-in LogicPilot libraries.
import '../plugins/des';

describe('palette provider registry', () => {
  it('exposes the built-in library tabs through the seam', () => {
    const ids = PALETTE_CONTRIBUTIONS.libraries().map((library) => library.id);
    expect(ids).toEqual([
      'process',
      'presentation',
      'statechart',
      'action',
      'agent',
      'analysis',
      'controls',
    ]);
  });

  it('hides catalog-only process kinds that the compiler would reject', () => {
    const items = PALETTE_CONTRIBUTIONS.itemsFor('process');
    expect(items.length).toBeGreaterThan(0);
    // Every visible process item must be executable (kernel-registered).
    expect(items.every((item) => item.kind !== 'assemblerFake')).toBe(true);
    // The panel's in/out flags derive from ports, not a separate union.
    for (const item of items) {
      expect(Array.isArray(item.inPorts)).toBe(true);
      expect(Array.isArray(item.outPorts)).toBe(true);
    }
  });

  it('keeps contributions isolated and rejects duplicate ids', () => {
    expect(() =>
      PALETTE_CONTRIBUTIONS.register({
        id: 'logicpilot.process',
        library: { id: 'process', name: 'process' },
        items: [],
      }),
    ).toThrow(/already registered/);
    const scratch: PaletteContribution = {
      id: 'test.palette',
      library: { id: 'test-lib', name: 'Test Lib' },
      items: [{ kind: 'widget', library: 'test-lib', name: 'Widget' }],
    };
    const dispose = PALETTE_CONTRIBUTIONS.register(scratch);
    expect(PALETTE_CONTRIBUTIONS.itemsFor('test-lib')).toHaveLength(1);
    expect(PALETTE_CONTRIBUTIONS.libraries().some((l) => l.id === 'test-lib')).toBe(true);
    dispose();
    expect(PALETTE_CONTRIBUTIONS.itemsFor('test-lib')).toEqual([]);
    // The tab disappears with the contribution.
    expect(PALETTE_CONTRIBUTIONS.libraries().some((l) => l.id === 'test-lib')).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PALETTE_CONTRIBUTIONS, type PaletteContribution } from './palette';
import { startIdePluginHost, stopIdePluginHost } from '../plugins/host';

beforeAll(() => startIdePluginHost());
afterAll(() => stopIdePluginHost());

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
      'sysml',
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

  it('filters contributions by the active document type (palette follows the canvas)', () => {
    // Plain files get no paradigm libraries at all.
    expect(PALETTE_CONTRIBUTIONS.forDocumentType(undefined)).toEqual([]);
    // The .lp model document: process libraries apply, sysml does not.
    const dsl = PALETTE_CONTRIBUTIONS.forDocumentType('dsl').map((entry) => entry.library.id);
    expect(dsl).toContain('process');
    expect(dsl).not.toContain('sysml');
    // The SysML document: only the sysml library applies.
    const sysml = PALETTE_CONTRIBUTIONS.forDocumentType('sysml').map((entry) => entry.library.id);
    expect(sysml).toEqual(['sysml']);
    // A declared context is authoritative; legacy (undeclared) contributions
    // appear for any known document type.
    const legacy: PaletteContribution = {
      id: 'test.legacy-palette',
      library: { id: 'legacy-lib', name: 'Legacy Lib' },
      items: [{ kind: 'legacy', library: 'legacy-lib', name: 'Legacy' }],
    };
    const disposeLegacy = PALETTE_CONTRIBUTIONS.register(legacy);
    expect(
      PALETTE_CONTRIBUTIONS.forDocumentType('dsl').some((e) => e.id === 'test.legacy-palette'),
    ).toBe(true);
    expect(
      PALETTE_CONTRIBUTIONS.forDocumentType('sysml').some((e) => e.id === 'test.legacy-palette'),
    ).toBe(true);
    expect(PALETTE_CONTRIBUTIONS.forDocumentType(undefined)).toEqual([]);
    disposeLegacy();
  });
});

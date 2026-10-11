// The palette must only offer process blocks the kernel can actually
// compile and run: catalog-only kinds (restrictedArea*, pickup/dropoff,
// resourceTask*, downtime, ...) fail DSL compilation with LP2004.
import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS, LIBRARIES, portGlyphPoint } from './blockDefs';
import { EXECUTABLE_PROCESS_KINDS } from './blockCatalog';

describe('library declaration', () => {
  it('lists exactly the libraries the catalog uses, in selector order', () => {
    expect(LIBRARIES.map((library) => library.id)).toEqual([
      'process',
      'presentation',
      'statechart',
      'action',
      'agent',
      'analysis',
      'controls',
    ]);
    const used = new Set(BLOCK_DEFS.map((block) => block.library));
    expect([...used].sort()).toEqual(LIBRARIES.map((library) => library.id).sort());
    for (const library of LIBRARIES) {
      expect(
        BLOCK_DEFS.some((block) => block.library === library.id),
        `declared library '${library.id}' has no blocks`,
      ).toBe(true);
    }
  });
});

describe('process library executable matrix', () => {
  it('every process block shown in the palette is executable', () => {
    const paletteProcess = BLOCK_DEFS.filter((block) => block.library === 'process');
    expect(paletteProcess.length).toBeGreaterThan(0);
    for (const block of paletteProcess) {
      expect(
        block.executable,
        `process block '${block.kind}' must be executable to appear in the palette`,
      ).toBe(true);
    }
  });

  it('the executable set matches the embedded stdlib registry size', () => {
    expect(EXECUTABLE_PROCESS_KINDS.size).toBe(26);
  });

  it('catalog-only kinds are not executable yet', () => {
    for (const kind of [
      'restrictedAreaStart',
      'restrictedAreaEnd',
      'pickup',
      'dropoff',
      'resourceTaskStart',
      'resourceTaskEnd',
      'resourceSendTo',
      'resourceAttach',
      'resourceDetach',
      'downtime',
      'pMLSettings',
      'plainTransfer',
    ]) {
      expect(EXECUTABLE_PROCESS_KINDS.has(kind), `${kind} must stay hidden`).toBe(false);
    }
  });
});

describe('visual library contracts', () => {
  it('uses rectangle radius instead of a duplicate rounded rectangle component', () => {
    const presentationKinds = BLOCK_DEFS.filter((block) => block.library === 'presentation').map(
      (block) => block.kind,
    );
    expect(presentationKinds).toContain('rect');
    expect(presentationKinds).not.toContain('roundedRect');
    expect(presentationKinds).toEqual(expect.arrayContaining(['triangle', 'polygon', 'star']));
  });

  it('lays out statechart and action flow ports from top to bottom', () => {
    for (const kind of ['state', 'action', 'localVariable']) {
      const input = portGlyphPoint(kind, 'in', 'in');
      const output = portGlyphPoint(kind, 'out', 'out');
      expect(input[0]).toBe(output[0]);
      expect(input[1]).toBeLessThan(output[1]);
    }
    expect(portGlyphPoint('decision', 'true', 'out')[1]).toBeGreaterThan(
      portGlyphPoint('decision', 'in', 'in')[1],
    );
  });
});

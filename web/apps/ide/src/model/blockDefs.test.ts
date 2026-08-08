// The palette must only offer process blocks the kernel can actually
// compile and run: catalog-only kinds (restrictedArea*, pickup/dropoff,
// resourceTask*, downtime, ...) fail DSL compilation with LP2004.
import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS } from './blockDefs';
import { EXECUTABLE_PROCESS_KINDS } from './blockCatalog';

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

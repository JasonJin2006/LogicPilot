// Registers the built-in LogicPilot element libraries into the Workbench
// palette registry. The catalog data stays in blockDefs (generated from
// libraries/pml-catalog.json); this module only adapts it to the provider
// contract, so the Palette panel never imports the catalog union directly.

import { PALETTE_CONTRIBUTIONS, type PaletteItem } from '../workbench/palette';
import { BLOCK_DEFS, LIBRARIES, type BlockDef } from './blockDefs';

function paletteItem(def: BlockDef): PaletteItem {
  return {
    kind: def.kind,
    library: def.library,
    name: def.name,
    hint: def.hint,
    in: def.ports.some((port) => port.direction === 'in'),
    out: def.ports.some((port) => port.direction === 'out'),
    inPorts: def.ports.filter((port) => port.direction === 'in').map((port) => port.name),
    outPorts: def.ports.filter((port) => port.direction === 'out').map((port) => port.name),
  };
}

for (const library of LIBRARIES) {
  PALETTE_CONTRIBUTIONS.register({
    id: `logicpilot.${library.id}`,
    library: { id: library.id, name: library.name },
    // Catalog-only process kinds have no kernel registry entry yet; hiding
    // them here keeps the palette honest (dragging one would fail DSL
    // compile with LP2004).
    items: BLOCK_DEFS.filter(
      (block) => block.library === library.id && !(library.id === 'process' && !block.executable),
    ).map(paletteItem),
  });
}

// Registers the built-in LogicPilot element libraries into the Workbench
// palette registry. The catalog data stays in blockDefs (generated from
// libraries/pml-catalog.json); this module only adapts it to the provider
// contract, so the Palette panel never imports the catalog union directly.

import { PALETTE_CONTRIBUTIONS, type PaletteItem } from '../workbench/palette';
import { BLOCK_DEFS, LIBRARIES, portGlyphPoint, type BlockDef } from './blockDefs';
import { BlockIcon } from './BlockIcon';
import { insertBlockAt } from './canvasInsert';

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

/** Register the model libraries for one plugin activation. Nothing is
 *  registered at module evaluation time: a zero-plugin host must leave the
 *  palette empty, and plugin deactivation must remove every contribution. */
export function registerModelPaletteContributions(): () => void {
  const disposers: Array<() => void> = [];
  try {
    for (const library of LIBRARIES) {
      disposers.push(
        PALETTE_CONTRIBUTIONS.register({
          id: `logicpilot.${library.id}`,
          library: { id: library.id, name: library.name },
          // Catalog-only process kinds have no kernel registry entry yet;
          // hiding them keeps the palette honest (dragging one would fail
          // DSL compile with LP2004).
          items: BLOCK_DEFS.filter(
            (block) =>
              library.id === block.library && !(library.id === 'process' && !block.executable),
          ).map(paletteItem),
          iconFor: (item) => {
            return function PaletteBlockIcon() {
              return BlockIcon({ kind: item.kind });
            };
          },
          insert: (item, position) => {
            insertBlockAt(item.kind, library.id, position);
          },
          portGlyphFor: (item, port, direction) => portGlyphPoint(item.kind, port, direction),
        }),
      );
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

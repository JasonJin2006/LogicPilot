// Side panel (Palette view): the process-library blocks as AnyLogic-style
// icons (each flow block shows its in/out ports on the chip edges),
// draggable onto the modeling canvas.

import { setDraggedKind } from '../model/paletteDnd';
import { BLOCK_DEFS } from '../model/blockDefs';
import { BlockIcon } from '../model/BlockIcon';

export function PalettePanel() {
  return (
    <div className="side-panel-body">
      <ul className="palette-list">
        {BLOCK_DEFS.map((block) => (
          <li
            key={block.kind}
            className="palette-item"
            draggable
            title={`${block.kind} — ${block.hint}`}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', block.kind);
              event.dataTransfer.effectAllowed = 'copy';
              setDraggedKind(block.kind);
            }}
          >
            <span className="palette-chip">
              <span className="palette-chip-icon">
                <BlockIcon kind={block.kind} />
                {block.in && <span className="palette-port port-in" aria-hidden />}
                {block.out && <span className="palette-port port-out" aria-hidden />}
              </span>
            </span>
            <span className="palette-name">{block.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

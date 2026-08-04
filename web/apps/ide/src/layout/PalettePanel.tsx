// Side panel (Palette view): the process-library blocks as AnyLogic-style
// icons in a compact grid (each flow block shows its in/out ports on the
// chip edges), draggable onto the modeling canvas. The drag ghost is the
// icon itself, not the whole grid cell.

import type { DragEvent } from 'react';
import { setDraggedKind } from '../model/paletteDnd';
import { BLOCK_DEFS } from '../model/blockDefs';
import { BlockIcon } from '../model/BlockIcon';

const DRAG_IMAGE_CLASS = 'palette-drag-image';
const DRAG_IMAGE_SIZE = 34;

// Browsers render the drag ghost from a live element: append an offscreen
// clone of the icon (currentColor inherits, so it follows the theme) and
// center it under the cursor.
function installIconDragImage(event: DragEvent, svg: Element | null): void {
  if (!svg) return;
  const wrap = document.createElement('span');
  wrap.className = DRAG_IMAGE_CLASS;
  wrap.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:34px;height:34px;color:var(--text);display:block;';
  wrap.appendChild(svg.cloneNode(true));
  document.body.appendChild(wrap);
  event.dataTransfer.setDragImage(wrap, DRAG_IMAGE_SIZE / 2, DRAG_IMAGE_SIZE / 2);
}

function removeDragImages(): void {
  document.querySelectorAll(`.${DRAG_IMAGE_CLASS}`).forEach((element) => element.remove());
}

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
              event.currentTarget.classList.add('dragging');
              installIconDragImage(event, event.currentTarget.querySelector('.palette-chip-icon svg'));
            }}
            onDragEnd={(event) => {
              event.currentTarget.classList.remove('dragging');
              removeDragImages();
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

// Side panel (Palette view): a library selector bar (All / Recent / the
// process library / imported libraries + an import button, wheel-scrollable)
// over the block grid. Custom libraries are imported from a JSON .lplib file.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Plus } from 'lucide-react';
import { setDraggedKind } from '../model/paletteDnd';
import { BLOCK_DEFS, LIBRARIES } from '../model/blockDefs';
import { BlockIcon } from '../model/BlockIcon';
import { usePaletteStore } from '../state/paletteStore';

const DRAG_IMAGE_CLASS = 'palette-drag-image';
const DRAG_IMAGE_SIZE = 34;

interface PaletteBlock {
  kind: string;
  library?: string;
  name: string;
  hint?: string;
  in?: boolean;
  out?: boolean;
}

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
  const library = usePaletteStore((state) => state.library);
  const customLibraries = usePaletteStore((state) => state.customLibraries);
  const recentKinds = usePaletteStore((state) => state.recentKinds);
  const setLibrary = usePaletteStore((state) => state.setLibrary);
  const importLibrary = usePaletteStore((state) => state.importLibrary);
  const [importError, setImportError] = useState('');
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The mouse wheel scrolls the library bar horizontally.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      bar.scrollLeft += event.deltaY + event.deltaX;
    };
    bar.addEventListener('wheel', onWheel, { passive: false });
    return () => bar.removeEventListener('wheel', onWheel);
  }, []);

  const defs = new Map<string, PaletteBlock>();
  for (const block of BLOCK_DEFS) {
    defs.set(block.kind, {
      kind: block.kind,
      library: block.library,
      name: block.name,
      hint: block.hint,
      in: block.in,
      out: block.out,
    });
  }
  for (const custom of Object.values(customLibraries)) {
    for (const block of custom.blocks) {
      defs.set(block.kind, block);
    }
  }

  let visible: PaletteBlock[] = [];
  if (library === 'all') {
    visible = [...defs.values()];
  } else if (library === 'recent') {
    visible = recentKinds
      .map((kind) => defs.get(kind))
      .filter((block): block is PaletteBlock => block !== undefined);
  } else if (library === 'process') {
    visible = BLOCK_DEFS.filter((block) => block.library === 'process');
  } else if (library === 'presentation' || library === 'statechart' || library === 'action') {
    visible = BLOCK_DEFS.filter((block) => block.library === library);
  } else {
    visible = customLibraries[library]?.blocks ?? [];
  }

  const onImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((source) => {
      const result = importLibrary(source, file.name);
      setImportError(result.ok ? '' : (result.error ?? 'import failed'));
    });
  };

  const tabs: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'recent', label: 'Recent' },
    ...LIBRARIES.map((entry) => ({ id: entry.id, label: entry.name })),
  ];
  const customTabs = Object.values(customLibraries).map((custom) => ({
    id: custom.name,
    label: custom.name,
  }));

  return (
    <div className="side-panel-body palette-body">
      <div className="palette-library-bar" ref={barRef}>
        {[...tabs, ...customTabs].map((tab) => (
          <button
            key={tab.id}
            className={`palette-library-tab${library === tab.id ? ' active' : ''}`}
            onClick={() => setLibrary(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button
          className="palette-library-add"
          title="Import a library (.json / .lplib)"
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={12} />
        </button>
        <input ref={fileRef} type="file" accept=".json,.lplib" hidden onChange={onImportFile} />
      </div>
      {importError !== '' && <p className="palette-import-error">{importError}</p>}
      <ul className="palette-list">
        {visible.map((block) => (
          <li
            key={block.kind}
            className="palette-item"
            draggable
            title={block.hint ? `${block.kind} - ${block.hint}` : block.kind}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', block.kind);
              event.dataTransfer.setData('application/x-logicpilot-library', block.library ?? 'process');
              event.dataTransfer.effectAllowed = 'copy';
              setDraggedKind(block.kind, block.library ?? 'process');
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
            <span className="palette-name">{block.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

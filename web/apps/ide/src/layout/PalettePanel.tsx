// Side panel (Palette view): a library selector bar (All / Recent / the
// process library / imported libraries + an import button, wheel-scrollable)
// over the block grid. Custom libraries are imported from a JSON .lplib file.
//
// Blocks are added to the canvas two ways: double-click (insert at the
// active canvas) and pointer-based drag (a custom ghost follows the cursor;
// releasing over the canvas inserts at that point). Pointer events work in
// every WebView2/Chromium host, unlike HTML5 drag-and-drop which WebView2
// rejects with a no-drop cursor.
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { BLOCK_DEFS, LIBRARIES, portGlyphPoint } from '../model/blockDefs';
import { insertBlockAt } from '../model/canvasInsert';
import { BlockIcon } from '../model/BlockIcon';
import { useCanvasView } from '../state/canvasView';
import { usePaletteStore } from '../state/paletteStore';
import { ScrollArea } from '../components/ScrollArea';

interface PaletteBlock {
  kind: string;
  library?: string;
  name: string;
  hint?: string;
  in?: boolean;
  out?: boolean;
  /** Port names by direction, for the palette grid's connection dots. */
  inPorts?: string[];
  outPorts?: string[];
}

interface DragSession {
  kind: string;
  library: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function PalettePanel() {
  const library = usePaletteStore((state) => state.library);
  const customLibraries = usePaletteStore((state) => state.customLibraries);
  const recentKinds = usePaletteStore((state) => state.recentKinds);
  const setLibrary = usePaletteStore((state) => state.setLibrary);
  const importLibrary = usePaletteStore((state) => state.importLibrary);
  const recordUse = usePaletteStore((state) => state.recordUse);
  const [importError, setImportError] = useState('');
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; kind: string } | null>(null);

  // The mouse wheel scrolls the library bar horizontally.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      bar.scrollLeft += event.deltaY;
    };
    bar.addEventListener('wheel', onWheel, { passive: false });
    return () => bar.removeEventListener('wheel', onWheel);
  }, []);

  const defs = new Map<string, PaletteBlock>();
  for (const block of BLOCK_DEFS) {
    // Catalog-only process kinds have no kernel registry entry yet; hiding
    // them keeps the palette honest (dragging one would fail DSL compile).
    if (block.library === 'process' && !block.executable) {
      continue;
    }
    defs.set(block.kind, {
      kind: block.kind,
      library: block.library,
      name: block.name,
      hint: block.hint,
      in: block.ports.some((port) => port.direction === 'in'),
      out: block.ports.some((port) => port.direction === 'out'),
      inPorts: block.ports.filter((port) => port.direction === 'in').map((port) => port.name),
      outPorts: block.ports.filter((port) => port.direction === 'out').map((port) => port.name),
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
    // Resolve through the defs map so library views render the same port
    // indicators as the All view (BLOCK_DEFS carries ports, not the
    // palette's in/out flags).
    visible = BLOCK_DEFS.filter((block) => block.library === 'process')
      .map((block) => defs.get(block.kind))
      .filter((block): block is PaletteBlock => block !== undefined);
  } else if (
    library === 'presentation' ||
    library === 'statechart' ||
    library === 'action' ||
    library === 'agent' ||
    library === 'analysis' ||
    library === 'controls'
  ) {
    visible = BLOCK_DEFS.filter((block) => block.library === library)
      .map((block) => defs.get(block.kind))
      .filter((block): block is PaletteBlock => block !== undefined);
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

  // Finish a pointer drag: if released over the model canvas, map the
  // screen point to world coordinates (camera synced by ModelCanvas) and
  // insert the block there.
  const endDrag = (event: ReactPointerEvent<HTMLLIElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!drag || !drag.moved) {
      return;
    }
    const canvas = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('.model-canvas');
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const viewport = useCanvasView.getState().viewport;
    const scale = viewport?.scale ?? 1;
    const panX = viewport?.panX ?? 48;
    const panY = viewport?.panY ?? 48;
    insertBlockAt(drag.kind, drag.library, {
      x: (event.clientX - rect.left - panX) / scale,
      y: (event.clientY - rect.top - panY) / scale,
    });
    recordUse(drag.kind);
  };

  return (
    <div className="side-panel-body palette-body">
      <ScrollArea axis="x" className="palette-bar-scroll" scrollRef={barRef}>
        <div className="palette-library-bar scroll-hidden" ref={barRef}>
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
      </ScrollArea>
      {importError !== '' && <p className="palette-import-error">{importError}</p>}
      <ScrollArea className="palette-list-scroll">
        <ul className="palette-list">
          {visible.map((block) => (
            <li
              key={block.kind}
              className={`palette-item${ghost?.kind === block.kind ? ' dragging' : ''}`}
              title={block.hint ? `${block.kind} - ${block.hint}` : block.kind}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragRef.current = {
                  kind: block.kind,
                  library: block.library ?? 'process',
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  moved: false,
                };
                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                setGhost({ x: event.clientX, y: event.clientY, kind: block.kind });
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (
                  !drag.moved &&
                  Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4
                ) {
                  drag.moved = true;
                }
                if (drag.moved) {
                  setGhost({ x: event.clientX, y: event.clientY, kind: block.kind });
                }
              }}
              onPointerUp={endDrag}
              onPointerCancel={() => {
                dragRef.current = null;
                setGhost(null);
              }}
              onDoubleClick={() => {
                insertBlockAt(block.kind, block.library ?? 'process');
                recordUse(block.kind);
              }}
            >
              <span className="palette-chip">
                <span className="palette-chip-icon">
                  <BlockIcon kind={block.kind} />
                  {(() => {
                    // Port dots at the glyph's real port anchors (AnyLogic
                    // green-dot positions), scaled to the 30px chip icon
                    // (icon centre at (15,15), scale 0.75). Custom-library
                    // blocks keep the old in/out edge dots via the fallback.
                    const inPorts = block.inPorts?.length ? block.inPorts : block.in ? ['in'] : [];
                    const outPorts = block.outPorts?.length
                      ? block.outPorts
                      : block.out
                        ? ['out']
                        : [];
                    return [...inPorts, ...outPorts].map((name) => {
                      const direction = inPorts.includes(name) ? 'in' : 'out';
                      const [px, py] = portGlyphPoint(block.kind, name, direction);
                      return (
                        <span
                          key={name}
                          className={`palette-port port-${direction}`}
                          style={{ left: 15 + (px - 20) * 0.75, top: 15 + (py - 20) * 0.75 }}
                          aria-hidden
                        />
                      );
                    });
                  })()}
                </span>
              </span>
              <span className="palette-name">{block.name}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
      {ghost && (
        <span className="palette-drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          <BlockIcon kind={ghost.kind} />
        </span>
      )}
    </div>
  );
}

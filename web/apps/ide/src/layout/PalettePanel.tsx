// Side panel (Palette view): a library selector bar (All / Recent / the
// process library / imported libraries + an import button, wheel-scrollable)
// over the block grid. Custom libraries are imported from a JSON .lplib file.
//
// Blocks are added to the canvas two ways: double-click (insert at the
// active canvas) and pointer-based drag (a custom ghost follows the cursor;
// releasing over the canvas inserts at that point). Pointer events work in
// every WebView2/Chromium host, unlike HTML5 drag-and-drop which WebView2
// rejects with a no-drop cursor.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChangeEvent, ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import { PencilLine, Plus } from 'lucide-react';
import { portGlyphPoint } from '../model/blockDefs';
import { PALETTE_CONTRIBUTIONS } from '../workbench/palette';
import type { PaletteItem as CatalogItem } from '../workbench/palette';
import { documentContributionFor } from '../workbench/documentTypes';
import { insertBlockAt } from '../model/canvasInsert';
import { BlockIcon } from '../model/BlockIcon';
import { useCanvasView } from '../state/canvasView';
import { usePaletteStore } from '../state/paletteStore';
import { useUiStore } from '../state/uiStore';
import { insertFromPalette } from '../sysml/sysmlEditBridge';
import { ScrollArea } from '../components/ScrollArea';
import {
  pluginRegistryGeneration,
  structuredPaletteItems,
  subscribePluginRegistry,
} from '../plugins/registry';

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

type PaletteBlockMap = Map<string, PaletteBlock>;

function toBlock(item: CatalogItem): PaletteBlock {
  return {
    kind: item.kind,
    library: item.library,
    name: item.name,
    hint: item.hint,
    in: item.in,
    out: item.out,
    inPorts: item.inPorts,
    outPorts: item.outPorts,
  };
}

/** Registered contributions + imported custom libraries -> one block map
 *  keyed by kind (custom entries override built-ins of the same kind). */
function blockIndex(customLibraries: Record<string, { blocks: PaletteBlock[] }>): PaletteBlockMap {
  const defs: PaletteBlockMap = new Map();
  for (const item of PALETTE_CONTRIBUTIONS.allItems()) {
    defs.set(item.kind, toBlock(item));
  }
  for (const custom of Object.values(customLibraries)) {
    for (const block of custom.blocks) {
      defs.set(block.kind, block);
    }
  }
  return defs;
}

interface DragSession {
  kind: string;
  /** Owning library id when the block came from a registered catalog. */
  library?: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** A SysML palette item carries its declaration form in the kind
 *  (`part:def`); model-library kinds never contain a colon. */
function splitSysmlItem(kind: string): { baseKind: string; declaration: 'def' | 'usage' } | null {
  const colon = kind.indexOf(':');
  if (colon === -1) return null;
  return {
    baseKind: kind.slice(0, colon),
    declaration: kind.slice(colon + 1) === 'def' ? 'def' : 'usage',
  };
}

const DRAWABLE_PRESENTATION_KINDS = new Set(['line', 'polyline', 'curve']);

/** The icon renderer a library contribution provides, if any. */
function iconForItem(item: PaletteBlock): ComponentType<{ size?: number }> | undefined {
  const contribution = PALETTE_CONTRIBUTIONS.list().find(
    (entry) => entry.library.id === item.library,
  );
  return contribution?.iconFor?.({
    kind: item.kind,
    library: item.library ?? 'process',
    name: item.name,
  });
}

export function PalettePanel() {
  const library = usePaletteStore((state) => state.library);
  const customLibraries = usePaletteStore((state) => state.customLibraries);
  useSyncExternalStore(subscribePluginRegistry, pluginRegistryGeneration);
  const recentKinds = usePaletteStore((state) => state.recentKinds);
  const setLibrary = usePaletteStore((state) => state.setLibrary);
  const importLibrary = usePaletteStore((state) => state.importLibrary);
  const recordUse = usePaletteStore((state) => state.recordUse);
  const drawingKind = usePaletteStore((state) => state.drawingKind);
  const startDrawing = usePaletteStore((state) => state.startDrawing);
  const [importError, setImportError] = useState('');
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    kind: string;
    library?: string;
  } | null>(null);

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

  // The registry owns the catalog: built-in libraries come from palette
  // contributions, custom imports override by kind.
  const defs = blockIndex(customLibraries);
  const structuredItems = structuredPaletteItems().map((item) => toBlock(item));
  for (const item of structuredItems) {
    if (!defs.has(item.kind)) defs.set(item.kind, item);
  }

  let visible: PaletteBlock[] = [];
  if (library === 'all') {
    visible = [...defs.values()];
  } else if (library === 'recent') {
    visible = recentKinds
      .map((kind) => defs.get(kind))
      .filter((block): block is PaletteBlock => block !== undefined);
  } else if (PALETTE_CONTRIBUTIONS.itemsFor(library).length > 0) {
    // Registered library view: resolve through the defs map so custom
    // overrides of a registered kind render identically.
    visible = PALETTE_CONTRIBUTIONS.itemsFor(library)
      .map((item) => defs.get(item.kind))
      .filter((block): block is PaletteBlock => block !== undefined);
  } else {
    visible = structuredItems.filter((item) => item.library === library);
    if (visible.length === 0) visible = customLibraries[library]?.blocks ?? [];
  }

  const onImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then((source) => {
        const result = importLibrary(source, file.name);
        setImportError(result.ok ? '' : (result.error ?? 'import failed'));
      })
      .catch((error) => {
        setImportError(
          `cannot read '${file.name}': ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };

  const tabs: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'recent', label: 'Recent' },
    ...PALETTE_CONTRIBUTIONS.libraries().map((entry) => ({ id: entry.id, label: entry.name })),
    ...structuredPaletteItems()
      .map((item) => ({ id: item.library, label: item.library }))
      .filter((tab, index, all) => all.findIndex((candidate) => candidate.id === tab.id) === index),
  ];
  const customTabs = Object.values(customLibraries).map((custom) => ({
    id: custom.name,
    label: custom.name,
  }));

  // Finish a pointer drag: over the model canvas the block inserts at the
  // mapped world point; over the SysML canvas (while a .sysml document is
  // active) a declaration is written into the source instead.
  const endDrag = (event: ReactPointerEvent<HTMLLIElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!drag || !drag.moved) {
      return;
    }
    const activeFile = useUiStore.getState().activeFile;
    const sysmlItem =
      activeFile !== null && documentContributionFor(activeFile)?.id === 'sysml'
        ? splitSysmlItem(drag.kind)
        : null;
    if (sysmlItem !== null) {
      const overCanvas = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('.sysml-canvas');
      if (overCanvas) {
        const result = insertFromPalette(sysmlItem.baseKind, sysmlItem.declaration);
        if (result.ok) recordUse(drag.kind);
      }
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
    insertBlockAt(drag.kind, drag.library ?? 'process', {
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
          {visible.map((block) => {
            const ContributedIcon = iconForItem(block);
            return (
              <li
                key={block.kind}
                className={`palette-item${ghost?.kind === block.kind ? ' dragging' : ''}${drawingKind === block.kind ? ' drawing-active' : ''}`}
                title={
                  DRAWABLE_PRESENTATION_KINDS.has(block.kind)
                    ? `${block.name}: double-click to draw point by point; drag to insert a preset`
                    : block.hint
                      ? `${block.kind} - ${block.hint}`
                      : block.kind
                }
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
                  setGhost({
                    x: event.clientX,
                    y: event.clientY,
                    kind: block.kind,
                    library: block.library,
                  });
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
                    setGhost({
                      x: event.clientX,
                      y: event.clientY,
                      kind: block.kind,
                      library: block.library,
                    });
                  }
                }}
                onPointerUp={endDrag}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setGhost(null);
                }}
                onDoubleClick={() => {
                  const activeFile = useUiStore.getState().activeFile;
                  const sysmlItem =
                    activeFile !== null && documentContributionFor(activeFile)?.id === 'sysml'
                      ? splitSysmlItem(block.kind)
                      : null;
                  if (sysmlItem !== null) {
                    const result = insertFromPalette(sysmlItem.baseKind, sysmlItem.declaration);
                    if (result.ok) recordUse(block.kind);
                    return;
                  }
                  if (DRAWABLE_PRESENTATION_KINDS.has(block.kind)) {
                    startDrawing(block.kind as 'line' | 'polyline' | 'curve');
                    recordUse(block.kind);
                    return;
                  }
                  insertBlockAt(block.kind, block.library ?? 'process');
                  recordUse(block.kind);
                }}
              >
                <span className="palette-chip">
                  <span className="palette-chip-icon">
                    {ContributedIcon !== undefined ? (
                      <ContributedIcon size={26} />
                    ) : (
                      <BlockIcon kind={block.kind} />
                    )}
                    {(() => {
                      // Port dots at the glyph's real port anchors (AnyLogic
                      // green-dot positions), scaled to the 30px chip icon
                      // (icon centre at (15,15), scale 0.75). Custom-library
                      // blocks keep the old in/out edge dots via the fallback.
                      const inPorts = block.inPorts?.length
                        ? block.inPorts
                        : block.in
                          ? ['in']
                          : [];
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
                    {DRAWABLE_PRESENTATION_KINDS.has(block.kind) && (
                      <PencilLine className="palette-drawable-mark" size={11} aria-hidden />
                    )}
                  </span>
                </span>
                <span className="palette-name">{block.name}</span>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
      {ghost && (
        <span className="palette-drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {(() => {
            const GhostIcon = iconForItem({
              kind: ghost.kind,
              library: ghost.library ?? 'process',
              name: ghost.kind,
            });
            return GhostIcon !== undefined ? (
              <GhostIcon size={26} />
            ) : (
              <BlockIcon kind={ghost.kind} />
            );
          })()}
        </span>
      )}
    </div>
  );
}

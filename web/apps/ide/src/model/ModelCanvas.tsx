// Modeling canvas (P1-6): an infinite plane with a rigorous coordinate
// system. World coords (x right, y down) map to screen via
// screen = world * scale + pan. The grid step adapts to the zoom so lines
// stay readable (finer when zoomed in); the axes through the origin get
// arrowheads and numeric ticks. Blocks from the palette drop in world coords.

import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { useModelStore } from '../state/modelStore';
import { documentForView, useCanvasView } from '../state/canvasView';
import type { BlockKind, GraphicNode, GraphicTransform, ModelNode } from '@logicpilot/editor';
import {
  createGraphicNode,
  pathNode,
  pathPointList,
  removePathPoint,
  updatePathPoint,
  type PathPoint,
} from '@logicpilot/editor';
import { getDraggedKind, getDraggedLibrary, getDraggedScene } from './paletteDnd';
import { addInstanceLine, nextInstanceName, sceneContainerFromFile } from '../project/project';
import { useProjectStore } from '../state/projectStore';
import { syncCanvasFromProject } from '../state/projectSync';
import { BLOCK_DEFAULTS, blockPorts, portAnchor, PRESENTATION_KINDS } from './blockDefs';
import { BlockIcon } from './BlockIcon';
import { PresentationRenderer } from '../presentation/renderer';
import { TransformHandles, type ResizeHandleName } from '../presentation/TransformHandles';
import { useShapeSelection } from '../presentation/selectionStore';
import { insertBlockAt } from './canvasInsert';
import { vizState } from '../state/vizState';
import { usePaletteStore } from '../state/paletteStore';
import { CANVAS_CONTAINER_KINDS, type BlockPortDef } from './blockDefs';

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
// Desired on-screen distance between grid lines (px); the step in world
// units is the smallest "nice" value that lands near this spacing.
const GRID_TARGET_PX = 40;
const MAJOR_EVERY = 5; // every 5th line is major (carries axis ticks)
// Default view margin: the origin sits this far in from the canvas edges so
// the axes, arrowheads and tick labels are fully visible on first load.
const VIEW_MARGIN = 48;

// Cross-shape clipboard for Ctrl+C / Ctrl+V on presentation objects.
let shapeClipboard: { kind: string; object: GraphicNode } | null = null;

// Ports the canvas shows for a node: every catalog port, including the
// conditional ones (outTimeout / outPreempted / preparedUnits / wrapUp) at
// their AnyLogic green-dot positions, matching the palette preview. Wiring a
// conditional port auto-enables its gating option in modelStore so the DSL
// stays compilable (LP5003).
function visiblePorts(node: ModelNode): BlockPortDef[] {
  return blockPorts(node.kind);
}

/** Fallback port for edges without explicit ports: the primary in/out first,
 *  skipping conditional ports. */
function firstOutPort(node: ModelNode): string {
  const outs = blockPorts(node.kind).filter(
    (port) => !port.conditionalOn && port.direction === 'out',
  );
  return outs.find((port) => port.name === 'out')?.name ?? outs[0]?.name ?? 'out';
}

function firstInPort(node: ModelNode): string {
  const ins = blockPorts(node.kind).filter(
    (port) => !port.conditionalOn && (port.direction === 'in' || port.direction === 'inout'),
  );
  return ins.find((port) => port.name === 'in')?.name ?? ins[0]?.name ?? 'in';
}

// Nice grid steps (world units per cell): 1-2-2.5-5 decade ladder.
const GRID_STEPS = [
  0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500,
  5000, 10_000, 20_000, 25_000, 50_000, 100_000,
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function niceStep(raw: number): number {
  for (const step of GRID_STEPS) {
    if (step >= raw) return step;
  }
  const largest = GRID_STEPS[GRID_STEPS.length - 1]!;
  return largest * Math.ceil(raw / largest);
}

interface View {
  scale: number;
  panX: number;
  panY: number;
}

export function ModelCanvas() {
  const rawDocument = useModelStore((state) => state.document);
  // Defensive: the persisted document can transiently be incomplete (older
  // builds, hand-edited localStorage) and lack `nodes`/`edges`. The store
  // merge sanitizes it, but keep this belt-and-braces so a single bad shape
  // can never NPE the canvas render path.
  const document = {
    name: rawDocument?.name ?? 'Model',
    nodes: Array.isArray(rawDocument?.nodes) ? rawDocument.nodes : [],
    edges: Array.isArray(rawDocument?.edges) ? rawDocument.edges : [],
  };
  // The canvas can focus on one container Node's subgraph (e.g. process
  // Flow); null = the model root showing everything.
  const focusView = useCanvasView((state) => state.view);
  const setFocusView = useCanvasView((state) => state.setView);
  const setViewport = useCanvasView((state) => state.setViewport);
  const visibleDocument = documentForView(document, focusView);
  const visibleNodes = visibleDocument.nodes;
  const visibleEdges = visibleDocument.edges;
  const selectedId = useModelStore((state) => state.selectedId);
  const addBlock = useModelStore((state) => state.addBlock);
  const moveBlock = useModelStore((state) => state.moveBlock);
  const connectBlocks = useModelStore((state) => state.connectBlocks);
  const disconnectEdge = useModelStore((state) => state.disconnectEdge);
  const removeBlock = useModelStore((state) => state.removeBlock);
  const select = useModelStore((state) => state.select);
  const recordUse = usePaletteStore((state) => state.recordUse);
  const undo = useModelStore((state) => state.undo);
  const redo = useModelStore((state) => state.redo);
  const setPresentation = useModelStore((state) => state.setPresentation);

  const viewportRef = useRef<HTMLDivElement>(null);
  // Pan/zoom is remembered per canvas view (the root + each open container
  // tab), like editor tabs keep their scroll position across switches.
  const viewKey = focusView ? `${focusView.kind}:${focusView.name}` : '\u0000root';
  const cameraCache = useRef<Map<string, View>>(new Map());
  const defaultView: View = { scale: 1, panX: VIEW_MARGIN, panY: VIEW_MARGIN };
  const [view, setViewState] = useState<View>(
    () => cameraCache.current.get(viewKey) ?? defaultView,
  );
  useEffect(() => {
    setViewState(cameraCache.current.get(viewKey) ?? defaultView);
  }, [viewKey]);
  const setView = (updater: View | ((current: View) => View)) => {
    setViewState((current) => {
      const next =
        typeof updater === 'function' ? (updater as (current: View) => View)(current) : updater;
      cameraCache.current.set(viewKey, next);
      return next;
    });
  };
  // Keep the palette's pointer-drag drop in sync with the current camera.
  useEffect(() => {
    setViewport({ scale: view.scale, panX: view.panX, panY: view.panY });
  }, [view, setViewport]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Port-to-port wiring: a live wire from an out port to the cursor, plus
  // the in-port currently under it (highlighted as the drop target).
  const [draftWire, setDraftWire] = useState<{
    fromId: string;
    fromPort: string;
    x: number;
    y: number;
  } | null>(null);
  const [wireTarget, setWireTarget] = useState<{
    id: string;
    port: string;
  } | null>(null);
  const wireStart = useRef<{ x: number; y: number } | null>(null);
  // Active resize/rotate gesture on a selected presentation object.
  const [transformDrag, setTransformDrag] = useState<{
    id: string;
    kind: 'resize' | 'rotate';
    handle?: ResizeHandleName;
    startTransform: GraphicTransform;
  } | null>(null);
  // Presentation editing UI state: inline text editing, shift-click
  // multi-selection and the image file picker target.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const shapeIds = useShapeSelection((state) => state.ids);
  const [imageTargetId, setImageTargetId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Pen tool: click-to-add-points path drawing.
  const [tool, setTool] = useState<'select' | 'pen'>('select');
  const [penPoints, setPenPoints] = useState<Array<{ x: number; y: number }>>([]);
  // Active path-point drag on a selected path node.
  const [pathEdit, setPathEdit] = useState<{ id: string; point: PathPoint } | null>(null);

  // Delete/Backspace removes the selected block (unless typing in a field).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      event.preventDefault();
      removeBlock(selectedId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, removeBlock]);

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl+Y redo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (!mod) return;
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Presentation editing shortcuts: copy/paste/duplicate shapes, group/
  // ungroup, arrow-key nudge and Escape to clear the selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const doc = () => useModelStore.getState().document;

      if (tool === 'pen') {
        if (event.key === 'Enter') {
          event.preventDefault();
          finishPen();
          setTool('select');
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelPen();
          return;
        }
      }

      if (mod && key === 'c') {
        const node = doc().nodes.find((entry) => entry.id === selectedId);
        if (node?.presentation) {
          shapeClipboard = { kind: node.kind, object: node.presentation };
          event.preventDefault();
        }
        return;
      }
      if (mod && (key === 'v' || key === 'd')) {
        if (!shapeClipboard) return;
        event.preventDefault();
        const t = shapeClipboard.object.transform;
        addBlock({
          kind: shapeClipboard.kind,
          name: shapeClipboard.kind,
          x: t.x + 24,
          y: t.y + 24,
          params: {},
          library: 'presentation',
          presentation: {
            ...shapeClipboard.object,
            transform: { ...t, x: t.x + 24, y: t.y + 24 },
          },
        });
        return;
      }
      if (mod && key === 'g' && !event.shiftKey) {
        event.preventDefault();
        const ids = new Set(useShapeSelection.getState().ids);
        const current = doc().nodes.find((entry) => entry.id === selectedId);
        if (current?.presentation) {
          ids.add(current.id);
        }
        if (useModelStore.getState().groupShapes([...ids])) {
          useShapeSelection.getState().clear();
        }
        return;
      }
      if (mod && event.shiftKey && key === 'g') {
        event.preventDefault();
        const node = doc().nodes.find((entry) => entry.id === selectedId);
        if (node?.presentation?.type === 'group') {
          useModelStore.getState().ungroupShape(node.id);
        }
        return;
      }
      if (mod && (key === ']' || key === '[')) {
        if (!selectedId) return;
        event.preventDefault();
        const store = useModelStore.getState();
        if (key === ']') store.bringToFront(selectedId);
        else store.sendToBack(selectedId);
        return;
      }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (!selectedId) return;
        event.preventDefault();
        const node = doc().nodes.find((entry) => entry.id === selectedId);
        if (!node?.presentation) return;
        const step = event.shiftKey ? 10 : 1;
        const dx = key === 'arrowright' ? step : key === 'arrowleft' ? -step : 0;
        const dy = key === 'arrowdown' ? step : key === 'arrowup' ? -step : 0;
        moveBlock(node.id, node.x + dx, node.y + dy);
        return;
      }
      if (event.key === 'Escape') {
        setEditingTextId(null);
        useShapeSelection.getState().clear();
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, shapeIds, editingTextId, tool, penPoints, addBlock, moveBlock, select]);

  const drag = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const elementDrag = useRef<{
    id: string;
    startX: number;
    startY: number;
    worldX: number;
    worldY: number;
    moved: boolean;
  } | null>(null);

  // Track the viewport size so the grid SVG and line math match the element.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wheel = zoom about the cursor (native listener so preventDefault works).
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      setView((current) => {
        const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const worldX = (mx - current.panX) / current.scale;
        const worldY = (my - current.panY) / current.scale;
        return { scale, panX: mx - worldX * scale, panY: my - worldY * scale };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Drag on empty space pans the plane; a plain click deselects.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Blocks/shapes are dragged by their own handlers; the focus pill and
    // canvas controls are plain buttons (pointer capture would swallow
    // their click).
    if (
      (event.target as Element).closest(
        '.model-block, .model-shape, .canvas-view-pill, .model-canvas button',
      )
    ) {
      return;
    }
    if (tool === 'pen') {
      const world = clientToWorld(event.clientX, event.clientY);
      setPenPoints((points) => [...points, world]);
      return;
    }
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    setPanning(true);
    setView((current) => ({ ...current, panX: gesture.panX + dx, panY: gesture.panY + dy }));
  };

  const onPointerUp = () => {
    const gesture = drag.current;
    drag.current = null;
    setPanning(false);
    if (gesture && !gesture.moved) select(null);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    // A palette Scenes entry instances the referenced scene: add an
    // `instance <name> = "<scene-path>"` member to the model body, reload the
    // canvas and focus the new container so blocks can be dropped into it.
    const scenePath =
      event.dataTransfer.getData('application/x-logicpilot-scene') || getDraggedScene();
    if (scenePath) {
      const bundle = useProjectStore.getState().bundle;
      const mainSource = bundle ? bundle.files[bundle.manifest.model] : undefined;
      const sceneSource = bundle ? bundle.files[scenePath] : undefined;
      if (mainSource !== undefined && sceneSource !== undefined) {
        const container = sceneContainerFromFile(scenePath, sceneSource);
        const baseName =
          container?.name ?? scenePath.slice(scenePath.lastIndexOf('/') + 1).replace(/\.lp$/, '');
        const instanceName = nextInstanceName(mainSource, baseName);
        const nextMain = addInstanceLine(mainSource, scenePath, instanceName);
        useProjectStore.getState().updateFiles((files) => ({
          ...files,
          [bundle!.manifest.model]: nextMain,
        }));
        syncCanvasFromProject();
        if (container) {
          setFocusView({ kind: container.kind, name: instanceName });
        }
      }
      select(null);
      return;
    }
    const kind =
      (event.dataTransfer.getData('text/plain') as BlockKind) || (getDraggedKind() as BlockKind);
    const library =
      event.dataTransfer.getData('application/x-logicpilot-library') ||
      getDraggedLibrary() ||
      'process';
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - view.panX) / view.scale;
    const y = (event.clientY - rect.top - view.panY) / view.scale;
    insertBlockAt(kind, library, { x, y });
    recordUse(kind);
    select(null);
  };

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.panX) / view.scale,
      y: (clientY - rect.top - view.panY) / view.scale,
    };
  };

  // Nearest valid in-port (a different block) within a screen-space
  // tolerance, used as the wire's drop target.
  const findWireTarget = (
    world: { x: number; y: number },
    fromId: string,
  ): { id: string; port: string } | null => {
    const tolerance = 12 / view.scale;
    let best: { id: string; port: string } | null = null;
    let bestDistance = tolerance;
    for (const node of visibleNodes) {
      if (node.id === fromId) continue;
      for (const port of visiblePorts(node)) {
        if (port.direction === 'out') continue;
        const anchor = portAnchor(node, port.name);
        const distance = Math.hypot(anchor.x - world.x, anchor.y - world.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { id: node.id, port: port.name };
        }
      }
    }
    return best;
  };

  const startWire = (event: ReactPointerEvent<HTMLSpanElement>, node: ModelNode, port: string) => {
    event.stopPropagation();
    const anchor = portAnchor(node, port);
    wireStart.current = { x: event.clientX, y: event.clientY };
    setDraftWire({ fromId: node.id, fromPort: port, x: anchor.x, y: anchor.y });
    setWireTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWire = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!draftWire) return;
    const world = clientToWorld(event.clientX, event.clientY);
    setDraftWire((wire) => (wire ? { ...wire, x: world.x, y: world.y } : wire));
    setWireTarget(findWireTarget(world, draftWire.fromId));
  };

  const endWire = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!draftWire) return;
    const start = wireStart.current;
    const moved =
      start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4;
    if (moved) {
      const world = clientToWorld(event.clientX, event.clientY);
      const target = findWireTarget(world, draftWire.fromId);
      if (target) connectBlocks(draftWire.fromId, target.id, draftWire.fromPort, target.port);
    }
    wireStart.current = null;
    setDraftWire(null);
    setWireTarget(null);
  };

  const cancelWire = () => {
    wireStart.current = null;
    setDraftWire(null);
    setWireTarget(null);
  };

  // Resize / rotate gestures on the selected presentation object. The drag
  // runs on window pointer events; resize happens in the object's unrotated
  // local frame around its centre so rotation stays stable.
  const startShapeResize = (id: string, handle: ResizeHandleName, object: GraphicNode) =>
    setTransformDrag({ id, kind: 'resize', handle, startTransform: object.transform });
  const startShapeRotate = (id: string, object: GraphicNode) =>
    setTransformDrag({ id, kind: 'rotate', startTransform: object.transform });

  // Finish the pen draft as a path node (commands are local to the bounds).
  const finishPen = () => {
    if (penPoints.length === 0) {
      return;
    }
    const pts = penPoints;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const commands = pts.map((p, index) =>
      index === 0 ? `M ${p.x - minX} ${p.y - minY}` : `L ${p.x - minX} ${p.y - minY}`,
    );
    addBlock({
      kind: 'curve',
      name: 'path',
      x: minX,
      y: minY,
      params: {},
      library: 'presentation',
      presentation: pathNode(
        minX,
        minY,
        commands,
        Math.max(1, maxX - minX),
        Math.max(1, maxY - minY),
      ),
    });
    setPenPoints([]);
  };
  const cancelPen = () => {
    setPenPoints([]);
    setTool('select');
  };

  // Dragging a path point rewrites its command (window-level, undoable).
  useEffect(() => {
    if (!pathEdit) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      const world = clientToWorld(event.clientX, event.clientY);
      const node = visibleDocument.nodes.find((entry) => entry.id === pathEdit.id);
      const object = node?.presentation;
      if (!node?.presentation?.path || !object) {
        return;
      }
      const t = object.transform;
      const rad = (t.rotation * Math.PI) / 180;
      const sx = (world.x - t.x) / t.scaleX;
      const sy = (world.y - t.y) / t.scaleY;
      const cx = t.width / 2;
      const cy = t.height / 2;
      const rx = sx - cx;
      const ry = sy - cy;
      const localX = rx * Math.cos(-rad) - ry * Math.sin(-rad) + cx;
      const localY = rx * Math.sin(-rad) + ry * Math.cos(-rad) + cy;
      const commands = updatePathPoint(
        node.presentation.path.commands,
        pathEdit.point,
        localX,
        localY,
      );
      setPresentation(node.id, { ...object, path: { commands } });
    };
    const onUp = () => setPathEdit(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pathEdit, setPresentation, visibleDocument, view]);

  useEffect(() => {
    if (!transformDrag) return;
    const onMove = (event: PointerEvent) => {
      const drag = transformDrag;
      const node = visibleDocument.nodes.find((entry) => entry.id === drag.id);
      const object = node?.presentation;
      if (!node || !object) return;
      const world = clientToWorld(event.clientX, event.clientY);
      const t = drag.startTransform;
      const cx = t.x + t.width / 2;
      const cy = t.y + t.height / 2;
      if (drag.kind === 'rotate') {
        const angle = Math.atan2(world.y - cy, world.x - cx) * (180 / Math.PI);
        const rotation = (((angle + 90) % 360) + 360) % 360;
        setPresentation(drag.id, { ...object, transform: { ...t, rotation } });
        return;
      }
      const handle = drag.handle ?? 'se';
      const rad = (t.rotation * Math.PI) / 180;
      const dx = world.x - cx;
      const dy = world.y - cy;
      const localX = dx * Math.cos(-rad) - dy * Math.sin(-rad);
      const localY = dx * Math.sin(-rad) + dy * Math.cos(-rad);
      const min = 4;
      let width = t.width;
      let height = t.height;
      if (handle.includes('e')) width = Math.max(min, localX * 2);
      if (handle.includes('w')) width = Math.max(min, -localX * 2);
      if (handle.includes('s')) height = Math.max(min, localY * 2);
      if (handle.includes('n')) height = Math.max(min, -localY * 2);
      setPresentation(drag.id, {
        ...object,
        transform: { ...t, width, height, x: cx - width / 2, y: cy - height / 2 },
      });
    };
    const onUp = () => setTransformDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [transformDrag, setPresentation, visibleDocument, view]);

  // Escape cancels an in-flight wire.
  useEffect(() => {
    if (!draftWire) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelWire();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftWire]);

  // Lightweight poll on the 10 Hz viz state so live run badges re-render
  // without routing every frame through React.
  const [, setLiveVersion] = useState(vizState.tickVersion);
  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveVersion((version) =>
        version === vizState.tickVersion ? version : vizState.tickVersion,
      );
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  const live = vizState.tickVersion > 0;
  const queueLength = live ? vizState.queueLength : 0;

  // Drag a block card or presentation shape to move it in world coordinates;
  // a plain click (no movement) selects it instead.
  const onElementPointerDown = (
    event: ReactPointerEvent<HTMLElement | SVGElement>,
    node: ModelNode,
  ) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('.model-port')) return;
    event.stopPropagation();
    elementDrag.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      worldX: node.x,
      worldY: node.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(node.id);
  };

  const onElementPointerMove = (
    event: ReactPointerEvent<HTMLElement | SVGElement>,
    node: ModelNode,
  ) => {
    const gesture = elementDrag.current;
    if (!gesture || gesture.id !== node.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    moveBlock(gesture.id, gesture.worldX + dx / view.scale, gesture.worldY + dy / view.scale);
  };

  const onElementPointerUp = (
    event: ReactPointerEvent<HTMLElement | SVGElement>,
    node: ModelNode,
  ) => {
    const gesture = elementDrag.current;
    elementDrag.current = null;
    setDraggingId(null);
    if (gesture && gesture.id === node.id && !gesture.moved) {
      select(node.id);
    }
  };

  // Grid + axes, computed in screen space.
  const { scale, panX, panY } = view;
  const step = niceStep(GRID_TARGET_PX / scale);
  // Line indices whose raw screen positions fall inside the viewport. Note
  // the /scale: k is in world units (k*step), screen = k*step*scale + pan.
  const x0 = Math.floor(-panX / (step * scale));
  const x1 = Math.ceil((size.width - panX) / (step * scale));
  const y0 = Math.floor(-panY / (step * scale));
  const y1 = Math.ceil((size.height - panY) / (step * scale));
  // Snap lines to the pixel grid (+0.5 centers a 1px stroke on one pixel
  // row/column) so the grid stays crisp at any pan/zoom instead of rendering
  // as blurry 2px soft lines.
  const axisX = Math.round(panX) + 0.5;
  const axisY = Math.round(panY) + 0.5;
  const verticals = [];
  const horizontals = [];
  for (let k = x0; k <= x1; k++) {
    const sx = Math.round(k * step * scale + panX) + 0.5;
    // Skip lines that round to a half-visible sliver exactly on the edge.
    if (sx < 1 || sx > size.width - 1) continue;
    const major = k % MAJOR_EVERY === 0;
    verticals.push(
      <line
        key={`v${k}`}
        x1={sx}
        y1={0}
        x2={sx}
        y2={size.height}
        style={{ stroke: major ? 'var(--border-strong)' : 'var(--border)' }}
      />,
    );
  }
  for (let k = y0; k <= y1; k++) {
    const sy = Math.round(k * step * scale + panY) + 0.5;
    if (sy < 1 || sy > size.height - 1) continue;
    const major = k % MAJOR_EVERY === 0;
    horizontals.push(
      <line
        key={`h${k}`}
        x1={0}
        y1={sy}
        x2={size.width}
        y2={sy}
        style={{ stroke: major ? 'var(--border-strong)' : 'var(--border)' }}
      />,
    );
  }
  const xAxisVisible = panY >= 0 && panY <= size.height;
  const yAxisVisible = panX >= 0 && panX <= size.width;

  // Edges (out -> in) rendered in world coordinates, plus the live wire.
  const edgeSegments = visibleEdges.flatMap((edge) => {
    const from = visibleNodes.find((node) => node.id === edge.from);
    const to = visibleNodes.find((node) => node.id === edge.to);
    if (!from || !to) return [];
    const fromPort = edge.fromPort ?? firstOutPort(from);
    const toPort = edge.toPort ?? firstInPort(to);
    return [{ id: edge.id, a: portAnchor(from, fromPort), b: portAnchor(to, toPort) }];
  });
  const wirePoints: Array<{ x: number; y: number }> = [];
  if (draftWire) {
    const fromNode = visibleNodes.find((node) => node.id === draftWire.fromId);
    if (fromNode) {
      wirePoints.push(portAnchor(fromNode, draftWire.fromPort), { x: draftWire.x, y: draftWire.y });
    }
  }
  const allPoints = [...edgeSegments.flatMap((segment) => [segment.a, segment.b]), ...wirePoints];
  const edgeBounds =
    allPoints.length > 0
      ? {
          minX: Math.min(...allPoints.map((point) => point.x)) - 16,
          minY: Math.min(...allPoints.map((point) => point.y)) - 16,
          maxX: Math.max(...allPoints.map((point) => point.x)) + 16,
          maxY: Math.max(...allPoints.map((point) => point.y)) + 16,
        }
      : null;
  const [wireFrom, wireTo] = wirePoints;
  let edgesView: ReactElement | null = null;
  if (edgeBounds) {
    const ox = edgeBounds.minX;
    const oy = edgeBounds.minY;
    edgesView = (
      <svg
        className="model-edges"
        style={{
          left: ox,
          top: oy,
          width: edgeBounds.maxX - ox,
          height: edgeBounds.maxY - oy,
        }}
      >
        {edgeSegments.map((segment) => {
          const d = `M ${segment.a.x - ox} ${segment.a.y - oy} L ${segment.b.x - ox} ${segment.b.y - oy}`;
          return (
            <g
              key={segment.id}
              className="edge"
              onClick={() => disconnectEdge(segment.id)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <path className="edge-hit" d={d} strokeWidth={10 / view.scale} />
              <path className="edge-line" d={d} strokeWidth={1.5 / view.scale} />
            </g>
          );
        })}
        {draftWire && wireFrom && wireTo && (
          <path
            className="wire-line"
            d={`M ${wireFrom.x - ox} ${wireFrom.y - oy} L ${wireTo.x - ox} ${wireTo.y - oy}`}
            strokeWidth={1.5 / view.scale}
          />
        )}
      </svg>
    );
  }

  // Presentation shapes: rendered as real drawing shapes in a bounds-fitted
  // svg inside the world layer (canvas annotations, not process blocks).
  const shapeNodes = visibleNodes.filter((node) => PRESENTATION_KINDS.has(node.kind));
  const runtime = live
    ? {
        queueLength: vizState.queueLength,
        busy: vizState.busy ? 1 : 0,
        servers: vizState.servers,
        downServers: vizState.downServers,
        tick: vizState.tickVersion,
        throughput: vizState.throughput,
        meanWait: vizState.meanWait,
      }
    : undefined;
  let shapesView: ReactElement | null = null;
  if (shapeNodes.length > 0 || penPoints.length > 0) {
    const pad = 80;
    const allX = [...shapeNodes.map((node) => node.x), ...penPoints.map((point) => point.x)];
    const allY = [...shapeNodes.map((node) => node.y), ...penPoints.map((point) => point.y)];
    const minX = Math.min(...allX) - pad;
    const minY = Math.min(...allY) - pad;
    const maxX = Math.max(...allX) + pad;
    const maxY = Math.max(...allY) + pad;
    shapesView = (
      <svg
        className="model-shapes"
        style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY }}
      >
        {shapeNodes.map((node) => {
          const shapeObject = node.presentation ?? createGraphicNode(node.kind, node.x, node.y);
          const selected = node.id === selectedId;
          const multi = shapeIds.includes(node.id);
          const t = shapeObject.transform;
          return (
            <g
              key={node.id}
              className={`model-shape kind-${node.kind}${selected ? ' selected' : ''}${multi ? ' multi-selected' : ''}`}
              onPointerDown={(event) => {
                if (event.shiftKey) {
                  event.stopPropagation();
                  useShapeSelection.getState().toggle(node.id);
                  select(node.id);
                  return;
                }
                onElementPointerDown(event, node);
              }}
              onPointerMove={(event) => onElementPointerMove(event, node)}
              onPointerUp={(event) => onElementPointerUp(event, node)}
              onPointerCancel={() => {
                elementDrag.current = null;
                setDraggingId(null);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (node.kind === 'text') {
                  setEditingTextId(node.id);
                  select(node.id);
                } else if (node.kind === 'image') {
                  setImageTargetId(node.id);
                  imageInputRef.current?.click();
                }
              }}
            >
              <PresentationRenderer
                object={shapeObject}
                ox={minX}
                oy={minY}
                uid={node.id}
                runtime={runtime}
              />
              {node.id === editingTextId && shapeObject.type === 'text' && (
                <foreignObject
                  x={0}
                  y={-2}
                  width={Math.max(40, t.width)}
                  height={Math.max(20, t.height + 4)}
                >
                  <textarea
                    className="shape-text-editor"
                    value={shapeObject.text ?? ''}
                    autoFocus
                    style={{
                      fontFamily: shapeObject.textStyle?.fontFamily,
                      fontSize: shapeObject.textStyle?.fontSize,
                      fontWeight: shapeObject.textStyle?.fontWeight,
                    }}
                    onChange={(event) =>
                      setPresentation(node.id, { ...shapeObject, text: event.target.value })
                    }
                    onBlur={() => setEditingTextId(null)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Escape') setEditingTextId(null);
                    }}
                  />
                </foreignObject>
              )}
              {selected && (
                <TransformHandles
                  object={shapeObject}
                  ox={minX}
                  oy={minY}
                  onResizeStart={(handle, event) => {
                    event.stopPropagation();
                    startShapeResize(node.id, handle, shapeObject);
                  }}
                  onRotateStart={(event) => {
                    event.stopPropagation();
                    startShapeRotate(node.id, shapeObject);
                  }}
                />
              )}
              {selected && tool === 'select' && shapeObject.type === 'path' && (
                <g
                  className="shape-path-editor"
                  transform={`translate(${shapeObject.transform.x - minX},${shapeObject.transform.y - minY}) rotate(${shapeObject.transform.rotation} ${shapeObject.transform.width / 2} ${shapeObject.transform.height / 2}) scale(${shapeObject.transform.scaleX},${shapeObject.transform.scaleY})`}
                >
                  {pathPointList(shapeObject.path?.commands ?? []).map((point, index) => (
                    <circle
                      key={index}
                      className="shape-path-point"
                      cx={point.x}
                      cy={point.y}
                      r={4}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setPathEdit({ id: node.id, point });
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        setPresentation(node.id, {
                          ...shapeObject,
                          path: {
                            commands: removePathPoint(shapeObject.path?.commands ?? [], point),
                          },
                        });
                      }}
                    />
                  ))}
                </g>
              )}
            </g>
          );
        })}
        {penPoints.length > 0 && (
          <g className="pen-draft">
            <polyline
              points={penPoints.map((point) => `${point.x - minX},${point.y - minY}`).join(' ')}
            />
            {penPoints.map((point, index) => (
              <circle key={index} cx={point.x - minX} cy={point.y - minY} r={3} />
            ))}
          </g>
        )}
      </svg>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`model-canvas${panning ? ' panning' : ''}${draftWire ? ' wiring' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {focusView && (
        <div className="canvas-view-pill" title="Editing this container's subgraph">
          <button
            className="pill-root"
            title="Back to the model root"
            onClick={() => setFocusView(null)}
          >
            {document.name || 'Model'}
          </button>
          <span className="pill-sep">›</span>
          <span className="pill-current">{focusView.name}</span>
          <button
            aria-label="Show the whole model"
            title="Back to the whole model"
            onClick={() => setFocusView(null)}
          >
            ×
          </button>
        </div>
      )}
      <svg className="model-grid" width={size.width} height={size.height}>
        {verticals}
        {horizontals}
        {xAxisVisible && (
          <g className="model-axis">
            <line x1={0} y1={axisY} x2={size.width} y2={axisY} />
            <path
              d={`M ${size.width} ${axisY} L ${size.width - 9} ${axisY - 4} L ${size.width - 9} ${axisY + 4} Z`}
            />
            {axisY >= 12 && (
              <text x={size.width - 16} y={Math.round(axisY) - 8} textAnchor="end">
                x
              </text>
            )}
          </g>
        )}
        {yAxisVisible && (
          <g className="model-axis">
            <line x1={axisX} y1={0} x2={axisX} y2={size.height} />
            <path
              d={`M ${axisX} ${size.height} L ${axisX - 4} ${size.height - 9} L ${axisX + 4} ${size.height - 9} Z`}
            />
            {axisX <= size.width - 20 && (
              <text x={Math.round(axisX) + 8} y={size.height - 14}>
                y
              </text>
            )}
          </g>
        )}
      </svg>
      <div
        className="model-world"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${scale})` }}
      >
        {edgesView}
        {shapesView}
        {visibleNodes.map((node) => {
          if (PRESENTATION_KINDS.has(node.kind)) {
            return null; // rendered as a real shape above
          }
          if (CANVAS_CONTAINER_KINDS.has(node.kind)) {
            // A container Node: shown on the root canvas as a folder card.
            // Double-click drills into its subgraph canvas.
            const childCount = document.nodes.filter(
              (child) => child.container === node.name,
            ).length;
            return (
              <div
                key={node.id}
                className={`model-block kind-process${node.id === selectedId ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
                style={{ left: node.x, top: node.y }}
                onPointerDown={(event) => onElementPointerDown(event, node)}
                onPointerMove={(event) => onElementPointerMove(event, node)}
                onPointerUp={(event) => onElementPointerUp(event, node)}
                onPointerCancel={() => {
                  elementDrag.current = null;
                  setDraggingId(null);
                }}
                onDoubleClick={() => setFocusView({ kind: node.kind, name: node.name })}
                title={`Open ${node.name} (${childCount} blocks)`}
              >
                <span className="model-block-icon">
                  <BlockIcon kind={node.kind} />
                </span>
                <span className="model-block-name">{node.name}</span>
                {childCount > 0 && <span className="model-block-count">{childCount}</span>}
              </div>
            );
          }
          const ports = visiblePorts(node);
          return (
            <div
              key={node.id}
              className={`model-block kind-${node.kind}${node.id === selectedId ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onElementPointerDown(event, node)}
              onPointerMove={(event) => onElementPointerMove(event, node)}
              onPointerUp={(event) => onElementPointerUp(event, node)}
              onPointerCancel={() => {
                elementDrag.current = null;
                setDraggingId(null);
              }}
            >
              <span className="model-block-icon">
                <BlockIcon kind={node.kind} />
                {ports.map((port) => {
                  const anchor = portAnchor(node, port.name);
                  const isIn = port.direction === 'in' || port.direction === 'inout';
                  const targeted =
                    isIn &&
                    wireTarget !== null &&
                    wireTarget.id === node.id &&
                    wireTarget.port === port.name;
                  return (
                    <span
                      key={port.name}
                      className={`model-port ${isIn ? 'port-in' : 'port-out'}${targeted ? ' wire-target' : ''}`}
                      data-port={port.name}
                      title={port.name}
                      style={{
                        // portAnchor() is node-centre-relative; the icon span's
                        // origin is its top-left corner. The icon is a 34px
                        // square centred on the node, so its left edge sits at
                        // node.x - 17 and its top edge at node.y - 26.5 (the
                        // card is 34px icon + 4px gap + 15px name = 53px).
                        left: anchor.x - node.x + 17,
                        top: anchor.y - node.y + 26.5,
                      }}
                      onPointerDown={
                        isIn
                          ? (event) => event.stopPropagation()
                          : (event) => startWire(event, node, port.name)
                      }
                      onPointerMove={moveWire}
                      onPointerUp={endWire}
                      onPointerCancel={cancelWire}
                    />
                  );
                })}
              </span>
              <span className="model-block-name">{node.name}</span>
              {live && node.kind === 'queue' && queueLength > 0 && (
                <span className="model-block-badge">{queueLength}</span>
              )}
              {live && node.kind === 'service' && (
                <span
                  className={`model-block-status${vizState.busy ? ' busy' : ''}${vizState.downServers > 0 ? ' down' : ''}`}
                  title={vizState.downServers > 0 ? 'down' : vizState.busy ? 'busy' : 'idle'}
                />
              )}
            </div>
          );
        })}
      </div>
      {visibleNodes.length === 0 && (
        <div className="model-empty">Drag blocks from the palette to build a model.</div>
      )}
      <div className="canvas-tools">
        <button
          className={tool === 'select' ? 'active' : ''}
          onClick={() => {
            if (tool === 'pen') {
              finishPen();
            }
            setTool('select');
          }}
        >
          Select
        </button>
        <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}>
          Pen
        </button>
      </div>
      {tool === 'pen' && (
        <div className="canvas-tool-hint">
          Click to add points · Enter to finish · Esc to cancel
        </div>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || !imageTargetId) return;
          const node = visibleDocument.nodes.find((entry) => entry.id === imageTargetId);
          if (!node?.presentation) return;
          const base = node.presentation;
          const reader = new FileReader();
          reader.onload = () => {
            const src = String(reader.result ?? '');
            setPresentation(imageTargetId, {
              ...base,
              image: { src, width: base.transform.width, height: base.transform.height },
            });
          };
          reader.readAsDataURL(file);
          setImageTargetId(null);
        }}
      />
    </div>
  );
}

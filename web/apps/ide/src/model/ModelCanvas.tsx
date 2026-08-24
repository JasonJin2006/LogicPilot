// Modeling canvas (P1-6): an infinite plane with a rigorous coordinate
// system. World coords (x right, y down) map to screen via
// screen = world * scale + pan. The grid step adapts to the zoom so lines
// stay readable (finer when zoomed in); the axes through the origin get
// arrowheads and numeric ticks. Blocks from the palette drop in world coords.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react';
import {
  Focus,
  LayoutGrid,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import { documentForView, useCanvasView } from '../state/canvasView';
import { autoArrangePositions } from './autoLayoutElk';
import { useCanvasCamera } from './useCanvasCamera';
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
import { refreshCanvasDocument } from '../state/projectSync';
import {
  blockPorts,
  CONTROL_KINDS,
  portAnchor,
  portGlyphPoint,
  PRESENTATION_KINDS,
  STATECHART_KINDS,
} from './blockDefs';
import { ChartWidget } from './ChartWidget';
import { ControlWidget } from './ControlWidget';
import { BlockIcon } from './BlockIcon';
import { PresentationRenderer } from '../presentation/renderer';
import { TransformHandles, type ResizeHandleName } from '../presentation/TransformHandles';
import { useShapeSelection } from '../presentation/selectionStore';
import { insertBlockAt } from './canvasInsert';
import { departedDelta, vizState } from '../state/vizState';
import { usePaletteStore } from '../state/paletteStore';
import { CANVAS_CONTAINER_KINDS, type BlockPortDef } from './blockDefs';
import { ContextMenu, type ContextAction } from '../layout/ContextMenu';
import { useRunStore } from '../state/runStore';
import { PressGesture, snapRect, type SnapGuide } from '@logicpilot/canvas';
import { graphicIntersectsViewport, worldViewportFromCamera } from '@logicpilot/canvas';
import { diagnoseDocument } from '../workbench/diagnostics';
// Side-effect import: registers the DES graph diagnostic provider for the
// DSL document type (the validator itself is not referenced here).
import './modelValidation';

// Desired on-screen distance between grid lines (px); the step in world
// units is the smallest "nice" value that lands near this spacing.
const GRID_TARGET_PX = 40;
const MAJOR_EVERY = 5; // every 5th line is major (carries axis ticks)
// Default view margin: the origin sits this far in from the canvas edges so
// the axes, arrowheads and tick labels are fully visible on first load.

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

/** World-space port anchor for statechart shape elements. State shapes are
 *  larger than the 34px block cards, so their in/out ports sit on the
 *  rounded-rectangle's left/right mid-edge instead of the icon rail. */
const STATECHART_BODY_SIZE = 52;
const STATECHART_TOTAL_HEIGHT = 69; // 52px body + 4px gap + 13px label

function statechartPortAnchor(node: ModelNode, port: string): { x: number; y: number } {
  const local = statechartPortLocal(node, port);
  return {
    x: node.x - STATECHART_BODY_SIZE / 2 + local.x,
    y: node.y - STATECHART_TOTAL_HEIGHT / 2 + local.y,
  };
}

/** Local (div-content-box) position of a statechart shape port. The shape
 *  div translates by half its own size, so these offsets are NOT the world
 *  anchor; they place the dot on the body's edge before that transform. */
function statechartPortLocal(node: ModelNode, port: string): { x: number; y: number } {
  const spec = blockPorts(node.kind).find((entry) => entry.name === port);
  const [x, y] = portGlyphPoint(node.kind, port, spec?.direction ?? 'out');
  return { x: (x / 40) * STATECHART_BODY_SIZE, y: (y / 40) * STATECHART_BODY_SIZE };
}

/** Ports the statechart linking tool exposes on shape elements. */
function statechartShapePorts(node: ModelNode): string[] {
  return blockPorts(node.kind).map((port) => port.name);
}

/** Analysis-library chart blocks render as live data widgets. */
const ANALYSIS_CHART_KINDS: ReadonlySet<string> = new Set([
  'timePlot',
  'plot',
  'barChart',
  'stackChart',
  'timeStackChart',
  'timeColorChart',
  'pieChart',
  'histogram',
  'histogram2D',
]);

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

/** A token animating along one coupling (world-coordinate endpoints). */
interface FlowToken {
  id: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
  born: number;
}

const FLOW_TOKEN_MS = 700;

// Nice grid steps (world units per cell): 1-2-2.5-5 decade ladder.
const GRID_STEPS = [
  0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500,
  5000, 10_000, 20_000, 25_000, 50_000, 100_000,
];

function niceStep(raw: number): number {
  for (const step of GRID_STEPS) {
    if (step >= raw) return step;
  }
  const largest = GRID_STEPS[GRID_STEPS.length - 1]!;
  return largest * Math.ceil(raw / largest);
}

export function ModelCanvas() {
  const runActive = useRunStore((state) => state.running);
  const rawDocument = useModelStore((state) => state.document);
  // Defensive: the persisted document can transiently be incomplete (older
  // builds, hand-edited localStorage) and lack `nodes`/`edges`. The store
  // merge sanitizes it, but keep this belt-and-braces so a single bad shape
  // can never NPE the canvas render path.
  const document = useMemo(
    () => ({
      name: rawDocument?.name ?? 'Model',
      nodes: Array.isArray(rawDocument?.nodes) ? rawDocument.nodes : [],
      edges: Array.isArray(rawDocument?.edges) ? rawDocument.edges : [],
    }),
    [rawDocument],
  );
  const modelDiagnostics = useMemo(() => diagnoseDocument('dsl', document), [document]);
  const diagnosticsByNode = useMemo(() => {
    const grouped = new Map<string, typeof modelDiagnostics>();
    for (const diagnostic of modelDiagnostics) {
      if (!diagnostic.nodeId) continue;
      grouped.set(diagnostic.nodeId, [...(grouped.get(diagnostic.nodeId) ?? []), diagnostic]);
    }
    return grouped;
  }, [modelDiagnostics]);
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
  const { view, setView, size, zoomAtCenter, fitVisibleModel, defaultView } = useCanvasCamera({
    viewKey,
    elementRef: viewportRef,
    getVisibleBounds: () => {
      if (visibleNodes.length === 0) return null;
      const xs = visibleNodes.map((node) => node.x);
      const ys = visibleNodes.map((node) => node.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    },
    contentVersion: visibleNodes.length,
  });
  // Keep the palette's pointer-drag drop in sync with the current camera.
  useEffect(() => {
    setViewport({ scale: view.scale, panX: view.panX, panY: view.panY });
  }, [view, setViewport]);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  // ELK auto-arrange for the flow subgraph of the open view. Presentation
  // shapes keep their manual positions; one undo step covers the move.
  const [arranging, setArranging] = useState(false);
  const flowNodes = useMemo(
    () => visibleNodes.filter((node) => !node.presentation),
    [visibleNodes],
  );
  const flowNodeCount = flowNodes.length;
  const handleAutoArrange = async () => {
    if (arranging || flowNodes.length < 2) return;
    const ids = new Set(flowNodes.map((node) => node.id));
    const flowEdges = visibleEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    setArranging(true);
    try {
      const positions = await autoArrangePositions(flowNodes, flowEdges);
      if (Object.keys(positions).length > 0) {
        useModelStore.getState().arrangeNodes(positions);
      }
    } catch {
      // Layout is best-effort: keep the current arrangement on failure.
    } finally {
      setArranging(false);
    }
  };
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
  // Two-stage connect: a plain click (no drag) on an out port arms the
  // connection; the next click on an in port completes it. Esc, another
  // canvas click or re-clicking the armed port cancels.
  const [pendingConnect, setPendingConnect] = useState<{
    fromId: string;
    fromPort: string;
  } | null>(null);
  // Slop 4px matches the old inline hypot check at pointer-up.
  const wirePress = useRef<PressGesture | null>(null);

  // Live flow tokens: circles animated along a coupling when a block's
  // departed counter advances (generic process-flow telemetry). The
  // departed baseline lives in the shared vizState (not a local ref) so a
  // new run / model switch / reconnect resets it through resetVizState -
  // the canvas usually stays mounted across runs, so unmount cleanup alone
  // would leave the old baseline suppressing the next run's tokens.
  const [tokens, setTokens] = useState<FlowToken[]>([]);
  const tokenSeq = useRef(0);
  const flowNodesRef = useRef(visibleNodes);
  const flowEdgesRef = useRef(visibleEdges);
  flowNodesRef.current = visibleNodes;
  flowEdgesRef.current = visibleEdges;
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
  // Palette-driven point drawing. Drawable line items arm this mode on
  // double-click; the canvas toolbar remains dedicated to viewport controls.
  const drawingKind = usePaletteStore((state) => state.drawingKind);
  const stopDrawing = usePaletteStore((state) => state.stopDrawing);
  const tool = drawingKind ? 'pen' : 'select';
  const [penPoints, setPenPoints] = useState<Array<{ x: number; y: number }>>([]);
  // Active path-point drag on a selected path node.
  const [pathEdit, setPathEdit] = useState<{ id: string; point: PathPoint } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Delete/Backspace removes the selected block (unless typing in a field).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if ((event.target as HTMLElement).closest('input, textarea, select')) return;
      const selected = useModelStore
        .getState()
        .document.nodes.find((entry) => entry.id === selectedId);
      if (selected?.presentation?.locked) return;
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
        const node = doc().nodes.find((entry) => entry.id === selectedId);
        if (node?.presentation?.locked) return;
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
        if (!node?.presentation || node.presentation.locked) return;
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
  }, [
    selectedId,
    shapeIds,
    editingTextId,
    tool,
    drawingKind,
    penPoints,
    addBlock,
    moveBlock,
    select,
    stopDrawing,
  ]);

  const drag = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    press: PressGesture;
  } | null>(null);
  const elementDrag = useRef<{
    id: string;
    startX: number;
    startY: number;
    worldX: number;
    worldY: number;
    press: PressGesture;
  } | null>(null);

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
      const points = [...penPoints, world];
      if (drawingKind === 'line' && points.length >= 2) {
        finishPen(points);
      } else if (event.detail >= 2 && points.length >= 2) {
        finishPen(points);
      } else {
        setPenPoints(points);
      }
      return;
    }
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      press: new PressGesture(),
    };
    drag.current.press.begin({ x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Keep the menu inside the visible window even when invoked near an edge.
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 226),
      y: Math.min(event.clientY, window.innerHeight - (selectedId ? 302 : 264)),
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture) return;
    gesture.press.update({ x: event.clientX, y: event.clientY });
    if (!gesture.press.moved) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    setPanning(true);
    setView((current) => ({ ...current, panX: gesture.panX + dx, panY: gesture.panY + dy }));
  };

  const onPointerUp = () => {
    const gesture = drag.current;
    drag.current = null;
    setPanning(false);
    if (gesture && !gesture.press.moved) {
      // A plain background click also disarms the two-stage connect.
      setPendingConnect(null);
      select(null);
    }
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
        // The imported scene joins the SAME session: no tab/view reset.
        refreshCanvasDocument();
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
      if (STATECHART_KINDS.has(node.kind)) {
        for (const port of statechartShapePorts(node)) {
          if (port === 'out') continue;
          const anchor = statechartPortAnchor(node, port);
          const distance = Math.hypot(anchor.x - world.x, anchor.y - world.y);
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = { id: node.id, port };
          }
        }
        continue;
      }
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
    wirePress.current = new PressGesture();
    wirePress.current.begin({ x: event.clientX, y: event.clientY }, 4);
    setDraftWire({ fromId: node.id, fromPort: port, x: anchor.x, y: anchor.y });
    setWireTarget(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWire = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!draftWire) return;
    wirePress.current?.update({ x: event.clientX, y: event.clientY });
    const world = clientToWorld(event.clientX, event.clientY);
    setDraftWire((wire) => (wire ? { ...wire, x: world.x, y: world.y } : wire));
    setWireTarget(findWireTarget(world, draftWire.fromId));
  };

  const endWire = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!draftWire) return;
    const moved = wirePress.current?.moved ?? false;
    if (moved) {
      const world = clientToWorld(event.clientX, event.clientY);
      const target = findWireTarget(world, draftWire.fromId);
      if (target) {
        const from = visibleNodes.find((node) => node.id === draftWire.fromId);
        const to = visibleNodes.find((node) => node.id === target.id);
        if (
          from !== undefined &&
          to !== undefined &&
          STATECHART_KINDS.has(from.kind) &&
          STATECHART_KINDS.has(to.kind)
        ) {
          // State-to-state drag creates a transition (AnyLogic style) instead
          // of a process-flow coupling.
          createStatechartTransition(from, to);
        } else {
          connectBlocks(draftWire.fromId, target.id, draftWire.fromPort, target.port);
        }
      }
    } else {
      // A click without a drag arms the two-stage connect: the next click
      // on an in port completes it.
      setPendingConnect({ fromId: draftWire.fromId, fromPort: draftWire.fromPort });
    }
    wirePress.current = null;
    setDraftWire(null);
    setWireTarget(null);
  };

  // Second stage of the click-click connect: complete onto whatever in port
  // sits at the click point (findWireTarget snaps within its threshold).
  const onPortClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (pendingConnect === null) return;
    event.stopPropagation();
    const world = clientToWorld(event.clientX, event.clientY);
    const target = findWireTarget(world, pendingConnect.fromId);
    if (target !== null) {
      const from = visibleNodes.find((node) => node.id === pendingConnect.fromId);
      const to = visibleNodes.find((node) => node.id === target.id);
      if (
        from !== undefined &&
        to !== undefined &&
        STATECHART_KINDS.has(from.kind) &&
        STATECHART_KINDS.has(to.kind)
      ) {
        createStatechartTransition(from, to);
      } else if (to !== undefined) {
        connectBlocks(pendingConnect.fromId, target.id, pendingConnect.fromPort, target.port);
      }
    }
    setPendingConnect(null);
  };

  // Create a transition block between two statechart elements (from/to by
  // name, positioned at the midpoint so the arrow edge renders).
  const createStatechartTransition = (from: ModelNode, to: ModelNode) => {
    const document = useModelStore.getState().document;
    const count = document.nodes.filter(
      (node) => node.kind === 'transition' && node.container === from.container,
    ).length;
    const name = count === 0 ? 'transition' : `transition${count + 1}`;
    useModelStore.getState().addBlock({
      kind: 'transition',
      name,
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      params: { from: from.name, to: to.name, triggeredBy: 'timeout', timeout: 1.0 },
      library: 'statechart',
      container: from.container,
    });
    recordUse('transition');
    select(null);
  };

  const cancelWire = () => {
    wirePress.current = null;
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
  const finishPen = (draft = penPoints) => {
    const pts = draft.filter(
      (point, index) =>
        index === 0 ||
        Math.hypot(point.x - draft[index - 1]!.x, point.y - draft[index - 1]!.y) > 0.01,
    );
    if (pts.length < 2 || !drawingKind) {
      setPenPoints([]);
      stopDrawing();
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const local = pts.map((point) => ({ x: point.x - minX, y: point.y - minY }));
    const commands =
      drawingKind === 'curve' && local.length >= 3
        ? [
            `M ${local[0]!.x} ${local[0]!.y}`,
            `Q ${local[1]!.x} ${local[1]!.y} ${local[2]!.x} ${local[2]!.y}`,
            ...local.slice(3).map((point) => `T ${point.x} ${point.y}`),
          ]
        : local.map((point, index) =>
            index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`,
          );
    addBlock({
      kind: drawingKind,
      name: drawingKind,
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
    stopDrawing();
  };
  const cancelPen = () => {
    setPenPoints([]);
    stopDrawing();
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

  // Escape cancels an in-flight wire or the armed two-stage connect.
  useEffect(() => {
    if (!draftWire && !pendingConnect) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelWire();
        setPendingConnect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftWire, pendingConnect]);

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

  // Spawn flow tokens when a block's departed counter advances and prune
  // expired ones. Reads the latest node/edge layout through refs so the
  // animation loop can run at display rate without restarting. The raf
  // loop is cancelled on unmount; a baseline reset (tokenGeneration bump)
  // drops in-flight tokens immediately so leftovers from a previous run
  // never animate across a new one.
  useEffect(() => {
    let raf = 0;
    let lastSpawn = 0;
    let seenGeneration = vizState.tokenGeneration;
    const tick = (now: number) => {
      if (vizState.tokenGeneration !== seenGeneration) {
        // New run / model switch / reconnect: the baseline was reset, so
        // drop leftover tokens and let the fresh counters spawn from 0.
        seenGeneration = vizState.tokenGeneration;
        setTokens([]);
        lastSpawn = now;
      }
      if (now - lastSpawn > 80) {
        lastSpawn = now;
        for (const [name, state] of vizState.blocks) {
          const previous = vizState.lastDeparted.get(name) ?? 0;
          const delta = departedDelta(previous, state.departed);
          if (delta === 0) continue;
          vizState.lastDeparted.set(name, state.departed);
          const fromNode = flowNodesRef.current.find((node) => node.name === name);
          if (!fromNode) continue;
          const outs = flowEdgesRef.current.filter((edge) => edge.from === fromNode.id);
          if (outs.length === 0) continue;
          for (let i = 0; i < delta; ++i) {
            const edge = outs[i % outs.length]!;
            const toNode = flowNodesRef.current.find((node) => node.id === edge.to);
            if (!toNode) continue;
            const a = portAnchor(fromNode, edge.fromPort ?? firstOutPort(fromNode));
            const b = portAnchor(toNode, edge.toPort ?? firstInPort(toNode));
            const id = tokenSeq.current++;
            setTokens((prev) => [...prev.slice(-47), { id, a, b, born: now }]);
          }
        }
      }
      setTokens((prev) => {
        const alive = prev.filter((token) => now - token.born < FLOW_TOKEN_MS);
        return alive.length === prev.length ? prev : alive;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
      press: new PressGesture(),
    };
    elementDrag.current.press.begin({ x: event.clientX, y: event.clientY });
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
    if (!gesture.press.update({ x: event.clientX, y: event.clientY })) return;
    let x = gesture.worldX + dx / view.scale;
    let y = gesture.worldY + dy / view.scale;
    const current = useModelStore
      .getState()
      .document.nodes.find((entry) => entry.id === gesture.id);
    if (current?.presentation && !event.altKey) {
      const t = current.presentation.transform;
      const peers = useModelStore
        .getState()
        .document.nodes.filter(
          (entry) =>
            entry.id !== gesture.id &&
            entry.container === current.container &&
            entry.presentation?.visible !== false,
        )
        .map((entry) => ({
          id: entry.id,
          x: entry.presentation!.transform.x,
          y: entry.presentation!.transform.y,
          width: entry.presentation!.transform.width,
          height: entry.presentation!.transform.height,
        }));
      const snapped = snapRect(
        { id: gesture.id, x, y, width: t.width, height: t.height },
        peers,
        6 / view.scale,
      );
      x = snapped.x;
      y = snapped.y;
      setSnapGuides(snapped.guides);
    } else {
      setSnapGuides([]);
    }
    moveBlock(gesture.id, x, y);
  };

  const onElementPointerUp = (
    event: ReactPointerEvent<HTMLElement | SVGElement>,
    node: ModelNode,
  ) => {
    const gesture = elementDrag.current;
    elementDrag.current = null;
    setDraggingId(null);
    setSnapGuides([]);
    if (gesture && gesture.id === node.id && !gesture.press.moved) {
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
        {tokens.map((token) => {
          const d = `M ${token.a.x - ox} ${token.a.y - oy} L ${token.b.x - ox} ${token.b.y - oy}`;
          return (
            <circle
              key={token.id}
              className="flow-token"
              r={2.5 / view.scale}
              style={{
                offsetPath: `path('${d}')`,
                animation: `flow-token ${FLOW_TOKEN_MS}ms linear forwards`,
              }}
            />
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
  const shapeViewport = worldViewportFromCamera(
    view.panX,
    view.panY,
    view.scale,
    size.width,
    size.height,
  );
  const renderedShapeNodes = shapeNodes.filter(
    (node) =>
      node.presentation?.visible !== false &&
      (node.id === selectedId ||
        shapeIds.includes(node.id) ||
        !node.presentation ||
        graphicIntersectsViewport(node.presentation.transform, shapeViewport)),
  );
  const runtime = live
    ? {
        queueLength: vizState.queueLength,
        busy: vizState.busy ? 1 : 0,
        servers: vizState.servers,
        downServers: vizState.downServers,
        tick: vizState.tickVersion,
        throughput: vizState.throughput,
        meanWait: vizState.meanWait,
        time: vizState.simTime,
        simTime: vizState.simTime,
        stateSteps: vizState.stateSteps,
        agentTick: vizState.agentTick,
        continuousTime: vizState.continuousTime,
        atomicTime: vizState.atomicTime,
      }
    : undefined;
  let shapesView: ReactElement | null = null;
  if (renderedShapeNodes.length > 0 || penPoints.length > 0) {
    const pad = 80;
    const allX = [
      ...renderedShapeNodes.map((node) => node.x),
      ...penPoints.map((point) => point.x),
    ];
    const allY = [
      ...renderedShapeNodes.map((node) => node.y),
      ...penPoints.map((point) => point.y),
    ];
    const allRight = [
      ...renderedShapeNodes.map(
        (node) =>
          (node.presentation?.transform.x ?? node.x) + (node.presentation?.transform.width ?? 0),
      ),
      ...penPoints.map((point) => point.x),
    ];
    const allBottom = [
      ...renderedShapeNodes.map(
        (node) =>
          (node.presentation?.transform.y ?? node.y) + (node.presentation?.transform.height ?? 0),
      ),
      ...penPoints.map((point) => point.y),
    ];
    const minX = Math.min(...allX) - pad;
    const minY = Math.min(...allY) - pad;
    const maxX = Math.max(...allRight) + pad;
    const maxY = Math.max(...allBottom) + pad;
    shapesView = (
      <svg
        className="model-shapes"
        style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY }}
      >
        {renderedShapeNodes.map((node) => {
          const shapeObject = node.presentation ?? createGraphicNode(node.kind, node.x, node.y);
          const selected = node.id === selectedId;
          const multi = shapeIds.includes(node.id);
          const t = shapeObject.transform;
          return (
            <g
              key={node.id}
              className={`model-shape kind-${node.kind}${selected ? ' selected' : ''}${multi ? ' multi-selected' : ''}`}
              style={{ pointerEvents: shapeObject.locked ? 'none' : undefined }}
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
                setSnapGuides([]);
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
              {selected && !shapeObject.locked && (
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
              {selected &&
                !shapeObject.locked &&
                tool === 'select' &&
                shapeObject.type === 'path' && (
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
        {snapGuides.map((guide, index) =>
          guide.axis === 'x' ? (
            <line
              key={`snap-x-${index}`}
              className="shape-snap-guide"
              x1={guide.value - minX}
              x2={guide.value - minX}
              y1={guide.from - minY}
              y2={guide.to - minY}
            />
          ) : (
            <line
              key={`snap-y-${index}`}
              className="shape-snap-guide"
              x1={guide.from - minX}
              x2={guide.to - minX}
              y1={guide.value - minY}
              y2={guide.value - minY}
            />
          ),
        )}
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

  // Statechart elements render as AnyLogic-style shapes (rounded state
  // boxes, circles for initial/final/history, diamond branches); transition
  // blocks draw as arrows between their `from`/`to` states (by name).
  const scNodes = visibleNodes.filter((node) => STATECHART_KINDS.has(node.kind));
  const scEdges: Array<{
    id: string;
    name: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
  }> = [];
  for (const node of scNodes) {
    if (node.kind !== 'transition') continue;
    const fromName = String(node.params['from'] ?? '');
    const toName = String(node.params['to'] ?? '');
    if (!fromName || !toName) continue;
    const from = visibleNodes.find((entry) => entry.name === fromName);
    const to = visibleNodes.find((entry) => entry.name === toName);
    if (!from || !to) continue;
    scEdges.push({
      id: node.id,
      name: node.name,
      a: statechartPortAnchor(from, 'out'),
      b: statechartPortAnchor(to, 'in'),
    });
  }
  const scBounds =
    scEdges.length > 0
      ? {
          minX: Math.min(...scEdges.flatMap((edge) => [edge.a.x, edge.b.x])) - 24,
          minY: Math.min(...scEdges.flatMap((edge) => [edge.a.y, edge.b.y])) - 24,
          maxX: Math.max(...scEdges.flatMap((edge) => [edge.a.x, edge.b.x])) + 24,
          maxY: Math.max(...scEdges.flatMap((edge) => [edge.a.y, edge.b.y])) + 24,
        }
      : null;
  const scEdgesView =
    scBounds !== null ? (
      <svg
        className="model-sc-edges"
        style={{
          left: scBounds.minX,
          top: scBounds.minY,
          width: scBounds.maxX - scBounds.minX,
          height: scBounds.maxY - scBounds.minY,
        }}
      >
        {scEdges.map((edge) => {
          const dx = edge.b.x - edge.a.x;
          const dy = edge.b.y - edge.a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const tipX = edge.b.x;
          const tipY = edge.b.y;
          const tailX = edge.a.x;
          const tailY = edge.a.y;
          const d = `M ${tailX - scBounds.minX} ${tailY - scBounds.minY} L ${tipX - scBounds.minX} ${tipY - scBounds.minY}`;
          const head = `M ${tipX - scBounds.minX} ${tipY - scBounds.minY} L ${tipX - ux * 9 - uy * 4.5 - scBounds.minX} ${tipY - uy * 9 + ux * 4.5 - scBounds.minY} L ${tipX - ux * 9 + uy * 4.5 - scBounds.minX} ${tipY - uy * 9 - ux * 4.5 - scBounds.minY} Z`;
          const mx = (tailX + tipX) / 2 - scBounds.minX;
          const my = (tailY + tipY) / 2 - scBounds.minY;
          return (
            <g
              key={edge.id}
              className="model-sc-transition"
              onClick={() => select(edge.id)}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <path className="sc-edge-hit" d={d} strokeWidth={10 / view.scale} />
              <path className="sc-edge-line" d={d} strokeWidth={1.5 / view.scale} />
              <path className="sc-edge-head" d={head} />
              <text className="sc-edge-label" x={mx} y={my - 4} textAnchor="middle">
                {edge.name}
              </text>
            </g>
          );
        })}
      </svg>
    ) : null;
  const scShapesView = (
    <>
      {scNodes
        .filter(
          (node) => node.kind !== 'transition' || !scEdges.some((edge) => edge.id === node.id),
        )
        .map((node) => {
          const selected = node.id === selectedId;
          return (
            <div
              key={node.id}
              className={`model-sc-shape kind-${node.kind}${selected ? ' selected' : ''}${node.kind === 'state' && vizState.activeState === node.name ? ' state-active' : ''}${node.id === draggingId ? ' dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onElementPointerDown(event, node)}
              onPointerMove={(event) => onElementPointerMove(event, node)}
              onPointerUp={(event) => onElementPointerUp(event, node)}
              onPointerCancel={() => {
                elementDrag.current = null;
                setDraggingId(null);
              }}
              title={node.kind}
            >
              <span className="sc-shape-body">
                <BlockIcon kind={node.kind} />
                {statechartShapePorts(node).map((port) => {
                  const local = statechartPortLocal(node, port);
                  const direction = blockPorts(node.kind).find(
                    (entry) => entry.name === port,
                  )?.direction;
                  const isIn = direction === 'in' || direction === 'inout';
                  const targeted =
                    isIn &&
                    wireTarget !== null &&
                    wireTarget.id === node.id &&
                    wireTarget.port === port;
                  return (
                    <span
                      key={port}
                      className={`model-port sc-shape-port ${isIn ? 'port-in' : 'port-out'}${targeted ? ' wire-target' : ''}`}
                      data-port={port}
                      title={`${port} port`}
                      style={{
                        left: local.x,
                        top: local.y,
                      }}
                      onPointerDown={
                        isIn
                          ? (event) => event.stopPropagation()
                          : (event) => startWire(event, node, port)
                      }
                      onPointerMove={moveWire}
                      onPointerUp={endWire}
                      onPointerCancel={cancelWire}
                      onClick={onPortClick}
                    />
                  );
                })}
              </span>
              <span className="sc-shape-name">{node.name}</span>
            </div>
          );
        })}
    </>
  );

  // Analysis-library chart blocks render as live widgets bound to the
  // telemetry stream (queue length / throughput / mean wait ...).
  const chartsView = (
    <>
      {visibleNodes
        .filter((node) => ANALYSIS_CHART_KINDS.has(node.kind))
        .map((node) => {
          const selected = node.id === selectedId;
          return (
            <div
              key={node.id}
              className={`model-chart${selected ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onElementPointerDown(event, node)}
              onPointerMove={(event) => onElementPointerMove(event, node)}
              onPointerUp={(event) => onElementPointerUp(event, node)}
              onPointerCancel={() => {
                elementDrag.current = null;
                setDraggingId(null);
              }}
              onDoubleClick={() => select(node.id)}
              title={`${node.name} - ${runActive ? 'live' : 'design preview'} ${String(node.params['value'] ?? 'queueLength')}`}
            >
              <ChartWidget
                kind={node.kind}
                params={node.params}
                name={node.name}
                active={runActive}
              />
            </div>
          );
        })}
    </>
  );

  const controlsView = (
    <>
      {visibleNodes
        .filter((node) => CONTROL_KINDS.has(node.kind))
        .map((node) => {
          const selected = node.id === selectedId;
          return (
            <div
              key={node.id}
              className={`model-control kind-${node.kind}${selected ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onElementPointerDown(event, node)}
              onPointerMove={(event) => onElementPointerMove(event, node)}
              onPointerUp={(event) => onElementPointerUp(event, node)}
              onPointerCancel={() => {
                elementDrag.current = null;
                setDraggingId(null);
              }}
              title={`${node.name} (${node.kind})`}
            >
              <ControlWidget kind={node.kind} params={node.params} name={node.name} />
            </div>
          );
        })}
    </>
  );

  return (
    <div
      ref={viewportRef}
      className={`model-canvas${panning ? ' panning' : ''}${draftWire ? ' wiring' : ''}${pendingConnect ? ' pending-connect' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={openContextMenu}
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {contextMenu &&
        (() => {
          const actions: ContextAction[] = [
            { label: 'Undo', icon: <Undo2 />, shortcut: 'Ctrl Z', onSelect: undo },
            { label: 'Redo', icon: <Redo2 />, shortcut: 'Ctrl Y', onSelect: redo },
            {
              label: 'Fit model in view',
              icon: <Focus />,
              shortcut: 'F',
              separatorBefore: true,
              onSelect: fitVisibleModel,
            },
            {
              label: 'Reset view',
              icon: <RotateCcw />,
              onSelect: () => setView(defaultView),
            },
            { label: 'Zoom in', icon: <ZoomIn />, onSelect: () => zoomAtCenter(1.2) },
            { label: 'Zoom out', icon: <ZoomOut />, onSelect: () => zoomAtCenter(1 / 1.2) },
          ];
          if (selectedId) {
            actions.push({
              label: 'Delete selection',
              icon: <Trash2 />,
              shortcut: 'Del',
              separatorBefore: true,
              danger: true,
              onSelect: () => removeBlock(selectedId),
            });
          }
          return (
            <ContextMenu
              x={Math.max(8, contextMenu.x)}
              y={Math.max(8, contextMenu.y)}
              label="Canvas actions"
              actions={actions}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}
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
        {scEdgesView}
        {scShapesView}
        {chartsView}
        {controlsView}
        {visibleNodes.map((node) => {
          const nodeLive = live ? vizState.blocks.get(node.name) : undefined;
          const nodeDiagnostics = diagnosticsByNode.get(node.id) ?? [];
          const diagnosticClass = nodeDiagnostics.some(
            (diagnostic) => diagnostic.severity === 'error',
          )
            ? ' has-error'
            : nodeDiagnostics.length > 0
              ? ' has-warning'
              : '';
          const diagnosticTitle = nodeDiagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join('\n');
          if (
            PRESENTATION_KINDS.has(node.kind) ||
            STATECHART_KINDS.has(node.kind) ||
            ANALYSIS_CHART_KINDS.has(node.kind) ||
            CONTROL_KINDS.has(node.kind)
          ) {
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
                className={`model-block kind-process kind-${node.kind}${node.id === selectedId ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
                style={{ left: node.x, top: node.y }}
                onPointerDown={(event) => onElementPointerDown(event, node)}
                onPointerMove={(event) => onElementPointerMove(event, node)}
                onPointerUp={(event) => onElementPointerUp(event, node)}
                onPointerCancel={() => {
                  elementDrag.current = null;
                  setDraggingId(null);
                }}
                onDoubleClick={() =>
                  setFocusView({ kind: node.kind, name: node.name, containerId: node.id })
                }
                title={`Open ${node.name} (${childCount} blocks)`}
              >
                <span className="model-block-icon">
                  <BlockIcon kind={node.kind} />
                </span>
                <span className="model-block-name">{node.name}</span>
                {childCount > 0 && <span className="model-block-count">{childCount}</span>}
                {live && node.kind === 'agent' && vizState.agentCount > 0 && (
                  <span className="model-block-badge" title={`tick ${vizState.agentTick}`}>
                    {vizState.agentCount}
                  </span>
                )}
                {live && node.kind === 'continuous' && vizState.continuousStep > 0 && (
                  <span className="model-block-badge" title={`step ${vizState.continuousStep}`}>
                    t={vizState.continuousTime.toFixed(2)}
                  </span>
                )}
                {live && node.kind === 'atomic' && vizState.atomicStep > 0 && (
                  <span className="model-block-badge" title={`step ${vizState.atomicStep}`}>
                    t={vizState.atomicTime.toFixed(2)}
                  </span>
                )}
              </div>
            );
          }
          const ports = visiblePorts(node);
          return (
            <div
              key={node.id}
              className={`model-block kind-${node.kind}${node.id === selectedId ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}${diagnosticClass}`}
              style={{ left: node.x, top: node.y }}
              title={diagnosticTitle || undefined}
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
                      onClick={onPortClick}
                    />
                  );
                })}
              </span>
              <span className="model-block-name">{node.name}</span>
              {nodeDiagnostics.length > 0 && (
                <span className="model-block-diagnostic" aria-hidden="true">
                  !
                </span>
              )}
              {live && node.kind === 'queue' && queueLength > 0 && (
                <span className="model-block-badge">{queueLength}</span>
              )}
              {live && nodeLive && nodeLive.buffered > 0 && (
                <span className="model-block-badge">{nodeLive.buffered}</span>
              )}
              {live && nodeLive && nodeLive.inService > 0 && (
                <span
                  className="model-block-status busy"
                  title={`${nodeLive.inService} in service`}
                />
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
        <div className="model-empty">
          <Plus className="model-empty-plus" size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Drag blocks from the palette to build a model.</span>
        </div>
      )}
      <div className="canvas-tools">
        <button aria-label="Zoom out" title="Zoom out" onClick={() => zoomAtCenter(1 / 1.2)}>
          <ZoomOut size={14} />
        </button>
        <button
          className="canvas-zoom-value"
          aria-label="Reset zoom"
          title="Reset zoom to 100%"
          onClick={() => setView((current) => ({ ...current, scale: 1 }))}
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomAtCenter(1.2)}>
          <ZoomIn size={14} />
        </button>
        <button aria-label="Fit model" title="Fit model in view" onClick={fitVisibleModel}>
          <Focus size={14} />
        </button>
        <button
          aria-label="Auto arrange"
          title="Auto arrange the flow in this view (ELK layered layout; undoable)"
          disabled={arranging || flowNodeCount < 2}
          onClick={() => {
            void handleAutoArrange();
          }}
        >
          <LayoutGrid size={14} />
        </button>
        <button
          aria-label="Reset view"
          title="Reset canvas view"
          onClick={() => setView(defaultView)}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {tool === 'pen' && (
        <div className="canvas-tool-hint">
          Drawing {drawingKind} · Click to add points · Double-click or Enter to finish · Esc to
          cancel
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

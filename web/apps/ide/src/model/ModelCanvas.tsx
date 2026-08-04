// Modeling canvas (P1-6): an infinite plane with a rigorous coordinate
// system. World coords (x right, y down) map to screen via
// screen = world * scale + pan. The grid step adapts to the zoom so lines
// stay readable (finer when zoomed in); the axes through the origin get
// arrowheads and numeric ticks. Blocks from the palette drop in world coords.

import { useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useModelStore } from '../state/modelStore';
import type { BlockKind, ModelNode } from '@logicpilot/editor';
import { getDraggedKind } from './paletteDnd';
import { blockPorts } from './blockDefs';
import { BlockIcon } from './BlockIcon';

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
// Desired on-screen distance between grid lines (px); the step in world
// units is the smallest "nice" value that lands near this spacing.
const GRID_TARGET_PX = 40;
const MAJOR_EVERY = 5; // every 5th line is major (carries axis ticks)
// Default view margin: the origin sits this far in from the canvas edges so
// the axes, arrowheads and tick labels are fully visible on first load.
const VIEW_MARGIN = 48;

// Nice grid steps (world units per cell): 1-2-2.5-5 decade ladder.
const GRID_STEPS = [
  0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500,
  1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000, 100_000,
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
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const addBlock = useModelStore((state) => state.addBlock);
  const moveBlock = useModelStore((state) => state.moveBlock);
  const select = useModelStore((state) => state.select);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, panX: VIEW_MARGIN, panY: VIEW_MARGIN });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const blockDrag = useRef<{
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
        const scale = clamp(
          current.scale * Math.exp(-event.deltaY * 0.0015),
          MIN_SCALE,
          MAX_SCALE,
        );
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
    if ((event.target as Element).closest('.model-block')) return;
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
    const kind =
      (event.dataTransfer.getData('text/plain') as BlockKind) || (getDraggedKind() as BlockKind);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - view.panX) / view.scale;
    const y = (event.clientY - rect.top - view.panY) / view.scale;
    addBlock({ kind, name: kind, x, y });
    select(null);
  };

  // Drag a block card to move it in world coordinates; a plain click
  // (no movement) selects it instead.
  const onBlockPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    node: ModelNode,
  ) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('.model-port')) return;
    event.stopPropagation();
    blockDrag.current = {
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

  const onBlockPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    node: ModelNode,
  ) => {
    const gesture = blockDrag.current;
    if (!gesture || gesture.id !== node.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    moveBlock(gesture.id, gesture.worldX + dx / view.scale, gesture.worldY + dy / view.scale);
  };

  const onBlockPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
    node: ModelNode,
  ) => {
    const gesture = blockDrag.current;
    blockDrag.current = null;
    setDraggingId(null);
    if (gesture && gesture.id === node.id && !gesture.moved) {
      select(node.id);
    }
  };

  // Grid + axes, computed in screen space.
  const { scale, panX, panY } = view;
  const step = niceStep(GRID_TARGET_PX / scale);
  const x0 = Math.floor(-panX / step);
  const x1 = Math.ceil((size.width - panX) / step);
  const y0 = Math.floor(-panY / step);
  const y1 = Math.ceil((size.height - panY) / step);
  // Snap lines to the pixel grid (+0.5 centers a 1px stroke on one pixel
  // row/column) so the grid stays crisp at any pan/zoom instead of rendering
  // as blurry 2px soft lines.
  const axisX = Math.round(panX) + 0.5;
  const axisY = Math.round(panY) + 0.5;
  const verticals = [];
  const horizontals = [];
  for (let k = x0; k <= x1; k++) {
    const sx = Math.round(k * step * scale + panX) + 0.5;
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

  return (
    <div
      ref={viewportRef}
      className={`model-canvas${panning ? ' panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
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
        {document.nodes.map((node) => {
          const ports = blockPorts(node.kind);
          return (
            <div
              key={node.id}
              className={`model-block kind-${node.kind}${node.id === selectedId ? ' selected' : ''}${node.id === draggingId ? ' dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(event) => onBlockPointerDown(event, node)}
              onPointerMove={(event) => onBlockPointerMove(event, node)}
              onPointerUp={(event) => onBlockPointerUp(event, node)}
              onPointerCancel={() => {
                blockDrag.current = null;
                setDraggingId(null);
              }}
            >
              <span className="model-block-icon">
                <BlockIcon kind={node.kind} />
                {ports.in && (
                  <span
                    className="model-port port-in"
                    data-port="in"
                    title="in"
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                )}
                {ports.out && (
                  <span
                    className="model-port port-out"
                    data-port="out"
                    title="out"
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                )}
              </span>
              <span className="model-block-name">{node.name}</span>
            </div>
          );
        })}
      </div>
      {document.nodes.length === 0 && (
        <div className="model-empty">Drag blocks from the palette to build a model.</div>
      )}
    </div>
  );
}

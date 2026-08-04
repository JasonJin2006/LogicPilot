// Modeling canvas (P1-6): an infinite plane with a rigorous coordinate
// system. World coords (x right, y down) map to screen via
// screen = world * scale + pan. The grid step adapts to the zoom so lines
// stay readable (finer when zoomed in); the axes through the origin get
// arrowheads and numeric ticks. Blocks from the palette drop in world coords.

import { useEffect, useRef, useState } from 'react';
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useModelStore } from '../state/modelStore';
import type { BlockKind } from '@logicpilot/editor';
import { getDraggedKind } from './paletteDnd';

const MIN_SCALE = 0.1;
const MAX_SCALE = 16;
// Desired on-screen distance between grid lines (px); the step in world
// units is the smallest "nice" value that lands near this spacing.
const GRID_TARGET_PX = 40;
const MAJOR_EVERY = 5; // every 5th line is major (carries axis ticks)

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

function stepDecimals(step: number): number {
  const text = step.toFixed(10).replace(/0+$/, '');
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function formatTick(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
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
  const select = useModelStore((state) => state.select);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, panX: 0, panY: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
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

  const onCardClick = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    select(id);
  };

  // Grid + axes, computed in screen space.
  const { scale, panX, panY } = view;
  const step = niceStep(GRID_TARGET_PX / scale);
  const decimals = stepDecimals(step);
  const x0 = Math.floor(-panX / step);
  const x1 = Math.ceil((size.width - panX) / step);
  const y0 = Math.floor(-panY / step);
  const y1 = Math.ceil((size.height - panY) / step);
  const xTicksOn = panY >= 0 && panY <= size.height - 18;
  const yTicksOn = panX >= 6 && panX <= size.width - 34;
  const verticals = [];
  const horizontals = [];
  const xTicks = [];
  const yTicks = [];
  for (let k = x0; k <= x1; k++) {
    const sx = k * step * scale + panX;
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
    if (major && k !== 0 && xTicksOn) {
      xTicks.push(
        <text key={`xt${k}`} x={sx} y={panY + 14} textAnchor="middle">
          {formatTick(k * step, decimals)}
        </text>,
      );
    }
  }
  for (let k = y0; k <= y1; k++) {
    const sy = k * step * scale + panY;
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
    if (major && yTicksOn) {
      yTicks.push(
        <text key={`yt${k}`} x={panX - 6} y={sy + 3} textAnchor="end">
          {formatTick(k * step, decimals)}
        </text>,
      );
    }
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
            <line x1={0} y1={panY} x2={size.width} y2={panY} />
            <path
              d={`M ${size.width} ${panY} L ${size.width - 9} ${panY - 4} L ${size.width - 9} ${panY + 4} Z`}
            />
            <text x={size.width - 16} y={panY - 8} textAnchor="end">
              x
            </text>
          </g>
        )}
        {yAxisVisible && (
          <g className="model-axis">
            <line x1={panX} y1={0} x2={panX} y2={size.height} />
            <path
              d={`M ${panX} ${size.height} L ${panX - 4} ${size.height - 9} L ${panX + 4} ${size.height - 9} Z`}
            />
            <text x={panX + 8} y={size.height - 14}>
              y
            </text>
          </g>
        )}
        {xTicks}
        {yTicks}
      </svg>
      <div
        className="model-world"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${scale})` }}
      >
        {document.nodes.map((node) => (
          <div
            key={node.id}
            className={`model-block kind-${node.kind}${node.id === selectedId ? ' selected' : ''}`}
            style={{ left: node.x, top: node.y }}
            onClick={(event) => onCardClick(event, node.id)}
          >
            <span className="model-block-kind">{node.kind}</span>
            <span className="model-block-name">{node.name}</span>
          </div>
        ))}
      </div>
      {document.nodes.length === 0 && (
        <div className="model-empty">Drag blocks from the palette to build a model.</div>
      )}
    </div>
  );
}

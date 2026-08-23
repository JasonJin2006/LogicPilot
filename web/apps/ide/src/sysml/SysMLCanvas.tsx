import { useMemo, useRef, useState } from 'react';
import { Focus, LayoutTemplate, Minus, Plus } from 'lucide-react';
import { useSysMLStore, type SysMLViewMode } from '../state/sysmlStore';
import type { SysMLElement, SysMLPosition, SysMLRelationKind, SysMLVisualKind } from './sysmlProjection';

const NODE_WIDTH = 196;
const NODE_HEIGHT = 62;

const COLORS: Record<SysMLVisualKind, { fill: string; stroke: string }> = {
  package: { fill: '#24364d', stroke: '#7fb4e8' },
  part: { fill: '#263c35', stroke: '#7dd3a7' },
  item: { fill: '#243c3d', stroke: '#7bd6d2' },
  port: { fill: '#3b3044', stroke: '#c49be8' },
  interface: { fill: '#3e3448', stroke: '#d5a7ef' },
  requirement: { fill: '#4a3528', stroke: '#f0bc78' },
  action: { fill: '#333b55', stroke: '#9fb7f7' },
  state: { fill: '#3d344d', stroke: '#c7a7ef' },
  analysis: { fill: '#3a3c2c', stroke: '#d5d788' },
  verification: { fill: '#43312f', stroke: '#f0a294' },
  attribute: { fill: '#303c42', stroke: '#9bc8d8' },
  constraint: { fill: '#3a3841', stroke: '#c4b6d9' },
  usecase: { fill: '#3a3348', stroke: '#d2a3ef' },
  view: { fill: '#2f3c46', stroke: '#9dc9e3' },
  viewpoint: { fill: '#2e3e48', stroke: '#8fd4e6' },
  enum: { fill: '#3f382b', stroke: '#e2c27f' },
  occurrence: { fill: '#2d3d3a', stroke: '#8dd0bd' },
  stakeholder: { fill: '#40352f', stroke: '#e5b18f' },
  flow: { fill: '#323e4d', stroke: '#a5c7ee' },
  unknown: { fill: '#30343b', stroke: '#8d98a8' },
};

const RELATION_STYLES: Record<SysMLRelationKind, { dash?: string; color: string }> = {
  contains: { dash: '5 5', color: '#718096' },
  typed_by: { dash: '3 4', color: '#9babc1' },
  specializes: { color: '#8cc4ff' },
  connects: { color: '#8be0c2' },
  flows: { color: '#f1c27d' },
  satisfies: { color: '#ffce85' },
  verifies: { color: '#ff9d91' },
  traces: { dash: '4 4', color: '#c9a5f3' },
  transitions: { color: '#b6a5ff' },
  allocates: { color: '#9ce3ba' },
  derives: { dash: '4 3', color: '#f4b68d' },
  refines: { dash: '4 3', color: '#e8b2e4' },
  redefines: { color: '#a9c6f4' },
  subsets: { dash: '3 3', color: '#9ec3e6' },
  exposes: { color: '#a9e0cf' },
  binds: { color: '#f2d18c' },
  includes: { dash: '3 3', color: '#d0b4ee' },
  depends_on: { dash: '2 4', color: '#a7b4c7' },
};

interface Camera {
  scale: number;
  x: number;
  y: number;
}

interface DragState {
  id: string | null;
  startX: number;
  startY: number;
  origin?: SysMLPosition;
  camera: Camera;
}

function positionOf(element: SysMLElement, positions: Record<string, SysMLPosition>): SysMLPosition {
  return positions[element.id] ?? { x: 80, y: 80 };
}

function bounds(elements: SysMLElement[], positions: Record<string, SysMLPosition>) {
  const width = Math.max(960, ...elements.map((element) => positionOf(element, positions).x + NODE_WIDTH + 120));
  const height = Math.max(640, ...elements.map((element) => positionOf(element, positions).y + NODE_HEIGHT + 120));
  return { width, height };
}

function relationPoint(element: SysMLElement, positions: Record<string, SysMLPosition>, side: 'from' | 'to') {
  const position = positionOf(element, positions);
  return {
    x: position.x + (side === 'from' ? NODE_WIDTH : 0),
    y: position.y + NODE_HEIGHT / 2,
  };
}

function labelForKind(kind: SysMLVisualKind): string {
  return kind === 'unknown' ? 'element' : kind;
}

/** Standard stereotype header («part def», «requirement», ...) as used by
 *  SysML graphical notation. */
function stereotypeFor(element: SysMLElement): string {
  const kind = labelForKind(element.kind);
  return element.declaration === 'definition' ? `«${kind} def»` : `«${kind}»`;
}

const BADGE_MARK: Partial<Record<SysMLVisualKind, string>> = {
  requirement: 'U',
  analysis: 'A',
  verification: 'V',
};

/** Node body drawn per standard SysML graphical notation: packages carry a
 *  top-left tab, requirements/cases a ⓤ/A/V corner mark, actions and states
 *  are rounded, use cases an ellipse, everything else a plain block. All
 *  variants share one bounding box so layout and edges stay untouched. */
function NodeBody({ kind, fill, stroke }: { kind: SysMLVisualKind; fill: string; stroke: string }) {
  switch (kind) {
    case 'package':
      return (
        <>
          <rect className="sysml-node-shape" width={NODE_WIDTH} height={NODE_HEIGHT - 10} y={10} rx={3} fill={fill} stroke={stroke} />
          <path className="sysml-node-shape" d={`M0 10 V2 H30 L38 10 Z`} fill={fill} stroke={stroke} />
        </>
      );
    case 'usecase':
      return <ellipse className="sysml-node-shape" cx={NODE_WIDTH / 2} cy={NODE_HEIGHT / 2} rx={NODE_WIDTH / 2 - 2} ry={NODE_HEIGHT / 2 - 3} fill={fill} stroke={stroke} />;
    case 'state':
      return <rect className="sysml-node-shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx={17} fill={fill} stroke={stroke} />;
    case 'action':
      return (
        <>
          <rect className="sysml-node-shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx={9} fill={fill} stroke={stroke} />
          {/* call-behavior rake arrow, top-right */}
          <path d={`M${NODE_WIDTH - 26} 13 l9 5 l-9 5`} fill="none" stroke={stroke} strokeWidth={1.3} />
        </>
      );
    default:
      return <rect className="sysml-node-shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx={4} fill={fill} stroke={stroke} />;
  }
}

function CornerMark({ kind, fill, stroke }: { kind: SysMLVisualKind; fill: string; stroke: string }) {
  const mark = BADGE_MARK[kind];
  if (mark !== undefined) {
    const cx = NODE_WIDTH - 15;
    const cy = NODE_HEIGHT - 15;
    return (
      <>
        <circle cx={cx} cy={cy} r={8.5} fill={fill} stroke={stroke} strokeWidth={1.2} />
        <text x={cx} y={cy + 3.4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#f5f8fb">{mark}</text>
      </>
    );
  }
  if (kind === 'constraint') {
    return <text x={NODE_WIDTH - 10} y={NODE_HEIGHT - 9} textAnchor="end" fontSize={12} fill="#f5f8fb">{'{ }'}</text>;
  }
  if (kind === 'port' || kind === 'interface') {
    // Socket notation: nested squares.
    return (
      <>
        <rect x={NODE_WIDTH - 21} y={NODE_HEIGHT - 21} width={13} height={13} fill={fill} stroke={stroke} strokeWidth={1.1} />
        <rect x={NODE_WIDTH - 17} y={NODE_HEIGHT - 17} width={5} height={5} fill={stroke} />
      </>
    );
  }
  if (kind === 'stakeholder') {
    const cx = NODE_WIDTH - 15;
    return (
      <>
        <circle cx={cx} cy={NODE_HEIGHT - 21} r={3.6} fill="none" stroke={stroke} strokeWidth={1.2} />
        <path d={`M${cx - 7} ${NODE_HEIGHT - 8} q7 -9 14 0`} fill="none" stroke={stroke} strokeWidth={1.2} />
      </>
    );
  }
  return null;
}

function visibleInMode(kind: SysMLVisualKind, mode: SysMLViewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'structure') return ['package', 'part', 'item', 'port', 'interface', 'enum', 'occurrence', 'stakeholder', 'view', 'viewpoint'].includes(kind);
  if (mode === 'requirements') return ['package', 'requirement', 'verification', 'analysis', 'constraint', 'usecase'].includes(kind);
  if (mode === 'traceability') return true;
  return ['package', 'action', 'state', 'analysis', 'verification', 'flow', 'occurrence', 'usecase'].includes(kind);
}

export function SysMLCanvas() {
  const projection = useSysMLStore((state) => state.projection);
  const layout = useSysMLStore((state) => state.layout);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const viewMode = useSysMLStore((state) => state.viewMode);
  const pastLength = useSysMLStore((state) => state.past.length);
  const futureLength = useSysMLStore((state) => state.future.length);
  const select = useSysMLStore((state) => state.select);
  const setViewMode = useSysMLStore((state) => state.setViewMode);
  const checkpoint = useSysMLStore((state) => state.checkpoint);
  const move = useSysMLStore((state) => state.move);
  const autoLayout = useSysMLStore((state) => state.autoLayout);
  const undo = useSysMLStore((state) => state.undo);
  const redo = useSysMLStore((state) => state.redo);
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const documentRef = useRef<SVGSVGElement>(null);

  const positions = layout?.positions ?? {};
  const visibleElements = useMemo(() => {
    if (!projection) return [];
    if (viewMode !== 'traceability') {
      return projection.elements.filter((element) => visibleInMode(element.kind, viewMode));
    }
    const ids = new Set(
      projection.relations
        .filter((relation) => ['satisfies', 'verifies', 'traces', 'allocates', 'derives', 'refines'].includes(relation.kind))
        .flatMap((relation) => [relation.from, relation.to]),
    );
    return projection.elements.filter((element) => ids.has(element.id));
  }, [projection, viewMode]);
  const visibleIds = useMemo(() => new Set(visibleElements.map((element) => element.id)), [visibleElements]);
  const visibleRelations = useMemo(
    () => projection?.relations.filter((relation) => visibleIds.has(relation.from) && visibleIds.has(relation.to)) ?? [],
    [projection, visibleIds],
  );
  const graphBounds = useMemo(
    () => (projection ? bounds(visibleElements, positions) : { width: 960, height: 640 }),
    [projection, visibleElements, positions],
  );
  const selected = projection?.elements.find((element) => element.id === selectedId) ?? null;

  if (!projection || !layout) {
    return <div className="sysml-empty">Open a .sysml file to visualize its model.</div>;
  }

  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { id: null, startX: event.clientX, startY: event.clientY, camera };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginMove = (event: React.PointerEvent<SVGGElement>, element: SysMLElement) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const origin = positionOf(element, positions);
    checkpoint();
    dragRef.current = {
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      camera,
    };
    select(element.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.camera.scale;
    const dy = (event.clientY - drag.startY) / drag.camera.scale;
    if (drag.id && drag.origin) {
      move(drag.id, { x: Math.max(20, drag.origin.x + dx), y: Math.max(20, drag.origin.y + dy) });
    } else {
      setCamera({
        ...drag.camera,
        x: drag.camera.x + event.clientX - drag.startX,
        y: drag.camera.y + event.clientY - drag.startY,
      });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const zoom = (factor: number) =>
    setCamera((current) => ({ ...current, scale: Math.min(2.2, Math.max(0.35, current.scale * factor)) }));

  return (
    <div className="sysml-canvas">
      <div className="sysml-canvas-toolbar">
        <button type="button" title="Auto layout" onClick={autoLayout}>
          <LayoutTemplate size={13} />
          <span>Auto layout</span>
        </button>
        <button type="button" title="Zoom out" onClick={() => zoom(0.85)}><Minus size={13} /></button>
        <button type="button" title="Reset view" onClick={() => setCamera({ scale: 1, x: 0, y: 0 })}><Focus size={13} /></button>
        <button type="button" title="Zoom in" onClick={() => zoom(1.18)}><Plus size={13} /></button>
        <button type="button" title="Undo layout edit" disabled={pastLength === 0} onClick={undo}>Undo</button>
        <button type="button" title="Redo layout edit" disabled={futureLength === 0} onClick={redo}>Redo</button>
        <select
          className="sysml-view-mode"
          aria-label="SysML view"
          value={viewMode}
          onChange={(event) => setViewMode(event.target.value as SysMLViewMode)}
        >
          <option value="all">All</option>
          <option value="structure">Structure</option>
          <option value="requirements">Requirements</option>
          <option value="behavior">Behavior</option>
          <option value="traceability">Traceability</option>
        </select>
        <span className="sysml-canvas-count">{visibleElements.length}/{projection.elements.length} elements · {visibleRelations.length} relations</span>
      </div>
      <svg
        ref={documentRef}
        className="sysml-svg"
        viewBox={`0 0 ${graphBounds.width} ${graphBounds.height}`}
        onPointerDown={beginPan}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => select(null)}
      >
        <defs>
          <marker id="sysml-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#9aa8ba" />
          </marker>
        </defs>
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
          <rect x={0} y={0} width={graphBounds.width} height={graphBounds.height} className="sysml-canvas-bg" />
          {visibleRelations.map((relation) => {
            const from = projection.elements.find((element) => element.id === relation.from);
            const to = projection.elements.find((element) => element.id === relation.to);
            if (!from || !to) return null;
            const a = relationPoint(from, positions, 'from');
            const b = relationPoint(to, positions, 'to');
            const style = RELATION_STYLES[relation.kind];
            return (
              <g key={relation.id} className="sysml-relation">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={style.color} strokeDasharray={style.dash} markerEnd="url(#sysml-arrow)" />
                {relation.label !== 'contains' && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} className="sysml-relation-label">{relation.label}</text>
                )}
              </g>
            );
          })}
          {visibleElements.map((element) => {
            const point = positionOf(element, positions);
            const color = COLORS[element.kind];
            const isSelected = element.id === selectedId;
            return (
              <g
                key={element.id}
                transform={`translate(${point.x} ${point.y})`}
                className={`sysml-node${isSelected ? ' selected' : ''}`}
                onPointerDown={(event) => beginMove(event, element)}
                onClick={(event) => { event.stopPropagation(); select(element.id); }}
              >
                {/* uniform hit area: the notation shapes leave corners free */}
                <rect width={NODE_WIDTH} height={NODE_HEIGHT} fill="transparent" />
                <NodeBody kind={element.kind} fill={color.fill} stroke={color.stroke} />
                <text x={12} y={24} className="sysml-node-kind">{stereotypeFor(element)}</text>
                <text x={12} y={44} className="sysml-node-name">{element.name}</text>
                <CornerMark kind={element.kind} fill={color.fill} stroke={color.stroke} />
              </g>
            );
          })}
        </g>
      </svg>
      {selected && (
        <div className="sysml-selection">
          <span>{selected.kind}</span>
          <strong>{selected.qualifiedName}</strong>
          <small>line {selected.span.line} · {selected.id}</small>
        </div>
      )}
      {projection.diagnostics.length > 0 && (
        <div className="sysml-diagnostics">{projection.diagnostics.length} projection warning(s); source remains authoritative.</div>
      )}
    </div>
  );
}

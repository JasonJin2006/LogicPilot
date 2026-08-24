import { useEffect, useMemo, useRef, useState } from 'react';
import { PressGesture, zoomAtPoint } from '@logicpilot/canvas';
import { useUiStore } from '../state/uiStore';
import { useLayoutStore } from '../state/layoutStore';
import { useProjectStore } from '../state/projectStore';
import { Focus, LayoutTemplate, Minus, Plus } from 'lucide-react';
import { useSysMLStore, type SysMLViewMode } from '../state/sysmlStore';
import { extractExecutionTargets } from './sysmlExecution';
import { loweredDslPath, lowerStateMachine } from './sysmlLowering';
import {
  orthogonalRoute,
  polylineLabelPoint,
  routePathData,
  type RouteRect,
} from './sysmlEdgeRouting';
import {
  SYML_NODE_HEIGHT,
  SYML_NODE_WIDTH,
  type SysMLElement,
  type SysMLPosition,
  type SysMLRelationKind,
  type SysMLVisualKind,
} from './sysmlProjection';

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

const SYSML_MIN_SCALE = 0.35;
const SYSML_MAX_SCALE = 2.2;

interface DragState {
  id: string | null;
  origin?: SysMLPosition;
  /** Classifies the press: a sub-slop release is a click, not a drag
   *  (canvas-platform S2 semantics). */
  press: PressGesture;
  camera: Camera;
}

function positionOf(
  element: SysMLElement,
  positions: Record<string, SysMLPosition>,
): SysMLPosition {
  return positions[element.id] ?? { x: 80, y: 80 };
}

function bounds(elements: SysMLElement[], positions: Record<string, SysMLPosition>) {
  const width = Math.max(
    960,
    ...elements.map((element) => positionOf(element, positions).x + SYML_NODE_WIDTH + 120),
  );
  const height = Math.max(
    640,
    ...elements.map((element) => positionOf(element, positions).y + SYML_NODE_HEIGHT + 120),
  );
  return { width, height };
}

function relationPoint(
  element: SysMLElement,
  positions: Record<string, SysMLPosition>,
  side: 'from' | 'to',
) {
  const position = positionOf(element, positions);
  return {
    x: position.x + (side === 'from' ? SYML_NODE_WIDTH : 0),
    y: position.y + SYML_NODE_HEIGHT / 2,
  };
}

/** Element footprint for edge routing; compound containers use their
 *  persisted ELK-enlarged bounds when present. */
function routedRect(
  element: SysMLElement,
  positions: Record<string, SysMLPosition>,
  sizes?: Record<string, { width: number; height: number }>,
): RouteRect {
  const position = positionOf(element, positions);
  return {
    x: position.x,
    y: position.y,
    width: sizes?.[element.id]?.width ?? SYML_NODE_WIDTH,
    height: sizes?.[element.id]?.height ?? SYML_NODE_HEIGHT,
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
function NodeBody({
  kind,
  width = SYML_NODE_WIDTH,
  height = SYML_NODE_HEIGHT,
}: {
  kind: SysMLVisualKind;
  width?: number;
  height?: number;
}) {
  const shape = 'sysml-node-shape';
  switch (kind) {
    case 'package':
      // Compound containers stretch: the tab stays put, the body wraps the
      // ELK-enlarged bounds so children render INSIDE their parent frame.
      return (
        <>
          <rect className={shape} width={width} height={height - 10} y={10} rx={3} />
          <path className={shape} d={`M0 10 V2 H30 L38 10 Z`} />
        </>
      );
    case 'usecase':
      return (
        <ellipse
          className={shape}
          cx={width / 2}
          cy={height / 2}
          rx={width / 2 - 2}
          ry={height / 2 - 3}
        />
      );
    case 'state':
      return <rect className={shape} width={width} height={height} rx={Math.min(17, height / 3)} />;
    case 'action':
      return (
        <>
          <rect className={shape} width={width} height={height} rx={9} />
          {/* call-behavior rake arrow, top-right */}
          <path className="sysml-node-mark" d={`M${width - 26} 13 l9 5 l-9 5`} />
        </>
      );
    default:
      return <rect className={shape} width={width} height={height} rx={4} />;
  }
}

function CornerMark({
  kind,
  width = SYML_NODE_WIDTH,
  height = SYML_NODE_HEIGHT,
}: {
  kind: SysMLVisualKind;
  width?: number;
  height?: number;
}) {
  const mark = BADGE_MARK[kind];
  if (mark !== undefined) {
    const cx = width - 15;
    const cy = height - 15;
    return (
      <>
        <circle className="sysml-node-badge" cx={cx} cy={cy} r={8.5} />
        <text
          className="sysml-node-mark sysml-node-badge-text"
          x={cx}
          y={cy + 3.4}
          textAnchor="middle"
        >
          {mark}
        </text>
      </>
    );
  }
  if (kind === 'constraint') {
    return (
      <text
        className="sysml-node-mark sysml-node-badge-text"
        x={width - 10}
        y={height - 9}
        textAnchor="end"
      >
        {'{ }'}
      </text>
    );
  }
  if (kind === 'port' || kind === 'interface') {
    // Socket notation: nested squares.
    return (
      <>
        <rect className="sysml-node-badge" x={width - 21} y={height - 21} width={13} height={13} />
        <rect
          className="sysml-node-mark sysml-node-socket-pin"
          x={width - 17}
          y={height - 17}
          width={5}
          height={5}
        />
      </>
    );
  }
  if (kind === 'stakeholder') {
    const cx = width - 15;
    return (
      <>
        <circle className="sysml-node-mark" cx={cx} cy={height - 21} r={3.6} fill="none" />
        <path className="sysml-node-mark" d={`M${cx - 7} ${height - 8} q7 -9 14 0`} fill="none" />
      </>
    );
  }
  return null;
}

function visibleInMode(kind: SysMLVisualKind, mode: SysMLViewMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'structure')
    return [
      'package',
      'part',
      'item',
      'port',
      'interface',
      'enum',
      'occurrence',
      'stakeholder',
      'view',
      'viewpoint',
    ].includes(kind);
  if (mode === 'requirements')
    return ['package', 'requirement', 'verification', 'analysis', 'constraint', 'usecase'].includes(
      kind,
    );
  if (mode === 'traceability') return true;
  return [
    'package',
    'action',
    'state',
    'analysis',
    'verification',
    'flow',
    'occurrence',
    'usecase',
  ].includes(kind);
}

export function SysMLCanvas() {
  const projection = useSysMLStore((state) => state.projection);
  const layout = useSysMLStore((state) => state.layout);
  const parseDirty = useSysMLStore((state) => state.parseDirty);
  const currentPath = useSysMLStore((state) => state.path);
  const source = useSysMLStore((state) => state.source);
  // Per-file units back execution/lowering: spans index into their own
  // source text, so a linked (multi-file) projection must resolve the
  // owning unit per target instead of using the active file's text.
  const units = useSysMLStore((state) => state.units);
  const execution = useSysMLStore((state) => state.execution);
  const runError = useSysMLStore((state) => state.runError);
  const runTarget = useSysMLStore((state) => state.runTarget);
  const activeFile = useUiStore((state) => state.activeFile);
  const evidence = useSysMLStore((state) => state.evidence);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const viewMode = useSysMLStore((state) => state.viewMode);
  const pastLength = useSysMLStore((state) => state.past.length);
  const futureLength = useSysMLStore((state) => state.future.length);
  const select = useSysMLStore((state) => state.select);
  const setViewMode = useSysMLStore((state) => state.setViewMode);
  const checkpoint = useSysMLStore((state) => state.checkpoint);
  const move = useSysMLStore((state) => state.move);
  const autoLayout = useSysMLStore((state) => state.applyElkLayout);
  const undo = useSysMLStore((state) => state.undo);
  const redo = useSysMLStore((state) => state.redo);
  const [camera, setCamera] = useState<Camera>({ scale: 1, x: 0, y: 0 });
  const [runTargetId, setRunTargetId] = useState<string | null>(null);
  const [loweringErrors, setLoweringErrors] = useState<Array<{
    code: string;
    message: string;
  }> | null>(null);
  const machineTargets = useMemo(
    () =>
      projection === null
        ? []
        : projection.elements.filter(
            (element) =>
              element.kind === 'state' &&
              element.declaration === 'definition' &&
              projection.elements.some((child) => child.ownerId === element.id),
          ),
    [projection],
  );
  const dragRef = useRef<DragState | null>(null);
  const documentRef = useRef<SVGSVGElement>(null);

  // Escape cancels an in-flight drag (same convention as the model canvas).
  // Must sit above the early return below: the hook order must be stable
  // across the empty-projection and loaded renders.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dragRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const positions = layout?.positions ?? {};
  const visibleElements = useMemo(() => {
    if (!projection) return [];
    if (viewMode !== 'traceability') {
      return projection.elements.filter((element) => visibleInMode(element.kind, viewMode));
    }
    const ids = new Set(
      projection.relations
        .filter((relation) =>
          ['satisfies', 'verifies', 'traces', 'allocates', 'derives', 'refines'].includes(
            relation.kind,
          ),
        )
        .flatMap((relation) => [relation.from, relation.to]),
    );
    return projection.elements.filter((element) => ids.has(element.id));
  }, [projection, viewMode]);
  const visibleIds = useMemo(
    () => new Set(visibleElements.map((element) => element.id)),
    [visibleElements],
  );
  const visibleRelations = useMemo(
    () =>
      projection?.relations.filter(
        (relation) => visibleIds.has(relation.from) && visibleIds.has(relation.to),
      ) ?? [],
    [projection, visibleIds],
  );
  const graphBounds = useMemo(
    () => (projection ? bounds(visibleElements, positions) : { width: 960, height: 640 }),
    [projection, visibleElements, positions],
  );
  const selected = projection?.elements.find((element) => element.id === selectedId) ?? null;
  const execTargets = useMemo(
    () =>
      units.length === 0 && projection !== null
        ? extractExecutionTargets(source, projection)
        : units.flatMap((unit) => extractExecutionTargets(unit.source, unit.projection)),
    [units, projection, source],
  );
  /** The unit whose text/spans own a target id (linked-model aware). */
  const ownerUnitOf = (targetId: string) => {
    const owner = units.find((unit) =>
      unit.projection.elements.some((element) => element.id === targetId),
    );
    if (owner) return owner;
    return projection !== null
      ? { path: currentPath ?? '', source, projection, dirty: parseDirty }
      : undefined;
  };
  const supportedTargets = execTargets.filter((target) => target.supported);
  const effectiveRunId = runTargetId ?? supportedTargets[0]?.id ?? null;
  // In a linked workspace only the OWNING file's parse state blocks a run;
  // one broken sibling must not disable every other file's targets.
  const runBlocked = effectiveRunId === null || (ownerUnitOf(effectiveRunId)?.dirty ?? true);

  if (!projection || !layout) {
    return <div className="sysml-empty">Open a .sysml file to visualize its model.</div>;
  }

  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const press = new PressGesture();
    press.begin({ x: event.clientX, y: event.clientY });
    dragRef.current = { id: null, press, camera };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginMove = (event: React.PointerEvent<SVGGElement>, element: SysMLElement) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const origin = positionOf(element, positions);
    const press = new PressGesture();
    press.begin({ x: event.clientX, y: event.clientY });
    dragRef.current = { id: element.id, origin, press, camera };
    select(element.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Sub-slop movement keeps the press a click; only a genuine drag moves
    // (canvas-platform S2 semantics - plain clicks no longer checkpoint).
    const dragStarted = drag.press.update({ x: event.clientX, y: event.clientY });
    if (!drag.press.moved) return;
    const start = drag.press.origin!;
    const dx = (event.clientX - start.x) / drag.camera.scale;
    const dy = (event.clientY - start.y) / drag.camera.scale;
    if (drag.id && drag.origin) {
      // Element drag: the undo step is taken ONCE when the drag actually
      // starts, not on every pointer-down (old behavior checkpointed clicks).
      if (dragStarted) {
        checkpoint();
      }
      move(drag.id, { x: Math.max(20, drag.origin.x + dx), y: Math.max(20, drag.origin.y + dy) });
    } else {
      setCamera({
        ...drag.camera,
        x: drag.camera.x + event.clientX - start.x,
        y: drag.camera.y + event.clientY - start.y,
      });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  /** One-click lowering: generate .lp DSL into generated/<Name>.lp and open
   *  it as a text tab. Outside model/ on purpose - the artifact is a
   *  complete standalone model, never a fragment of this project's model. */
  const lowerToDsl = (targetId: string) => {
    if (projection === null) return;
    const owner = ownerUnitOf(targetId);
    if (!owner) return;
    const result = lowerStateMachine(owner.source, owner.projection, targetId);
    if (!result.ok) {
      setLoweringErrors(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'));
      return;
    }
    setLoweringErrors(null);
    const path = loweredDslPath(result.modelName);
    const bundle = useProjectStore.getState().bundle;
    if (bundle !== null && activeFile !== null && bundle.files[activeFile] !== undefined) {
      // Project mode: the artifact lives in bundle files and Save carries it.
      useProjectStore.getState().updateFiles((files) => ({ ...files, [path]: result.dsl }));
      useUiStore.getState().openFile(path);
    } else {
      // Virtual/disk document mode: keep the artifact beside the source.
      useUiStore.getState().updateDiskFile(path, result.dsl);
      useUiStore.getState().openDiskFile(path, result.dsl);
    }
    useLayoutStore.getState().openPanel('center', 'dsl');
  };

  const zoom = (factor: number) =>
    setCamera((current) => {
      // Kernel camera math: zoom about the viewport center instead of the
      // world origin (old behavior drifted the visible region on zoom).
      const rect = documentRef.current?.getBoundingClientRect();
      const next = zoomAtPoint(
        { scale: current.scale, panX: current.x, panY: current.y },
        factor,
        (rect?.width ?? 0) / 2,
        (rect?.height ?? 0) / 2,
        SYSML_MIN_SCALE,
        SYSML_MAX_SCALE,
      );
      return { scale: next.scale, x: next.panX, y: next.panY };
    });

  return (
    <div className="sysml-canvas">
      <div className="sysml-canvas-toolbar">
        <button type="button" title="Auto layout (ELK layered)" onClick={() => void autoLayout()}>
          <LayoutTemplate size={13} />
          <span>Auto layout</span>
        </button>
        <button type="button" title="Zoom out" onClick={() => zoom(0.85)}>
          <Minus size={13} />
        </button>
        <button
          type="button"
          title="Reset view"
          onClick={() => setCamera({ scale: 1, x: 0, y: 0 })}
        >
          <Focus size={13} />
        </button>
        <button type="button" title="Zoom in" onClick={() => zoom(1.18)}>
          <Plus size={13} />
        </button>
        <button type="button" title="Undo layout edit" disabled={pastLength === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" title="Redo layout edit" disabled={futureLength === 0} onClick={redo}>
          Redo
        </button>
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
        <span className="sysml-canvas-count">
          {visibleElements.length}/{projection.elements.length} elements · {visibleRelations.length}{' '}
          relations
        </span>
        {machineTargets.length > 0 && (
          <button
            type="button"
            title="Lower the state machine to .lp DSL (kernel StatechartRuntime)"
            onClick={() => lowerToDsl(machineTargets[0]!.id)}
          >
            Lower to DSL
          </button>
        )}
        {supportedTargets.length > 0 && (
          <>
            <select
              className="sysml-view-mode"
              aria-label="Execution target"
              value={effectiveRunId ?? ''}
              onChange={(event) => setRunTargetId(event.target.value)}
            >
              {supportedTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.qualifiedName}
                </option>
              ))}
            </select>
            <button
              type="button"
              title={
                runBlocked
                  ? 'Fix the parse errors before running (the projection is stale)'
                  : 'Execute the selected target (subset 0.2: expressions, action successions, state/time-trigger machines)'
              }
              disabled={runBlocked}
              onClick={() => {
                const id = effectiveRunId ?? supportedTargets[0]!.id;
                setRunTargetId(id);
                runTarget(id);
              }}
            >
              Run
            </button>
          </>
        )}
      </div>
      <div className="sysml-overlays">
        {runError !== null && (
          <div className="sysml-trace sysml-run-error">run failed: {runError}</div>
        )}
        {loweringErrors !== null && (
          <div className="sysml-trace sysml-run-error">
            {loweringErrors.map((diagnostic) => (
              <div key={diagnostic.code + diagnostic.message}>
                {diagnostic.code}: {diagnostic.message}
              </div>
            ))}
          </div>
        )}
        {execution !== null && (
          <div className="sysml-trace">
            <div className="sysml-trace-head">
              trace · {execution.steps.length} step(s)
              {execution.result !== null && ` · result ${execution.result}`} · rev{' '}
              {execution.sourceHash}
            </div>
            {execution.steps.map((step) => (
              <div key={step.index} className="sysml-trace-step">
                [{step.index + 1}] {step.description}
                {step.time !== undefined && ` · t=${step.time}`}
                {step.line !== undefined && ` (line ${step.line})`} → {step.value}
              </div>
            ))}
          </div>
        )}
        {evidence.length > 0 && (
          <div className="sysml-evidence">
            <div className="sysml-trace-head">
              evidence · last {Math.min(evidence.length, 5)} of {evidence.length} run(s) · bound to
              model revisions
            </div>
            {evidence.slice(0, 5).map((record) => (
              <div key={record.id} className={`sysml-evidence-row${record.ok ? '' : ' failed'}`}>
                <span>{new Date(record.startedAt).toLocaleTimeString()}</span>
                <strong>{record.targetQualifiedName}</strong>
                <span>
                  {record.ok
                    ? record.result !== null && record.result !== undefined
                      ? `result ${record.result}`
                      : `${record.steps?.length ?? 0} step(s)`
                    : `failed: ${record.error ?? 'unknown error'}`}
                </span>
                <span title={record.revision}>
                  rev {record.revision.replace(/^fnv1a-/, '').slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        )}
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
          <rect
            x={0}
            y={0}
            width={graphBounds.width}
            height={graphBounds.height}
            className="sysml-canvas-bg"
          />
          {visibleRelations.map((relation) => {
            const from = projection.elements.find((element) => element.id === relation.from);
            const to = projection.elements.find((element) => element.id === relation.to);
            if (!from || !to) return null;
            const style = RELATION_STYLES[relation.kind];
            if (relation.kind === 'contains') {
              // Structural nesting guide: straight dashed line (the ELK
              // pipeline nests containment into frames instead of edges).
              const a = relationPoint(from, positions, 'from');
              const b = relationPoint(to, positions, 'to');
              return (
                <g key={relation.id} className="sysml-relation">
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={style.color}
                    strokeDasharray={style.dash}
                    markerEnd="url(#sysml-arrow)"
                  />
                </g>
              );
            }
            // Orthogonal Manhattan routing: cross-container edges bend in a
            // channel instead of cutting through container frames, and the
            // geometry is recomputed per render so manual drags stay glued.
            const route = orthogonalRoute(
              routedRect(from, positions, layout?.sizes),
              routedRect(to, positions, layout?.sizes),
            );
            const label = polylineLabelPoint(route);
            return (
              <g key={relation.id} className="sysml-relation">
                <path
                  d={routePathData(route)}
                  fill="none"
                  stroke={style.color}
                  strokeDasharray={style.dash}
                  markerEnd="url(#sysml-arrow)"
                />
                <text x={label.x} y={label.y - 6} className="sysml-relation-label">
                  {relation.label}
                </text>
              </g>
            );
          })}
          {visibleElements.map((element) => {
            const point = positionOf(element, positions);
            const isSelected = element.id === selectedId;
            return (
              <g
                key={element.id}
                transform={`translate(${point.x} ${point.y})`}
                className={`sysml-node${isSelected ? ' selected' : ''}`}
                data-kind={element.kind}
                onPointerDown={(event) => beginMove(event, element)}
                onClick={(event) => {
                  event.stopPropagation();
                  select(element.id);
                }}
              >
                {/* uniform hit area: the notation shapes leave corners free */}
                <rect
                  width={layout?.sizes?.[element.id]?.width ?? SYML_NODE_WIDTH}
                  height={layout?.sizes?.[element.id]?.height ?? SYML_NODE_HEIGHT}
                  fill="transparent"
                />
                <NodeBody
                  kind={element.kind}
                  width={layout?.sizes?.[element.id]?.width}
                  height={layout?.sizes?.[element.id]?.height}
                />
                <text x={12} y={24} className="sysml-node-kind">
                  {stereotypeFor(element)}
                </text>
                <text x={12} y={44} className="sysml-node-name">
                  {element.name}
                </text>
                <CornerMark
                  kind={element.kind}
                  width={layout?.sizes?.[element.id]?.width}
                  height={layout?.sizes?.[element.id]?.height}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {selected && (
        <div className="sysml-selection">
          <span>{selected.kind}</span>
          <strong>{selected.qualifiedName}</strong>
          <small>
            line {selected.span.line} · {selected.id}
          </small>
          {currentPath !== null && (
            <button
              type="button"
              className="sysml-link"
              onClick={() => {
                useLayoutStore.getState().openPanel('center', 'dsl');
                useUiStore
                  .getState()
                  .revealInSource(currentPath!, selected.nameSpan.start, selected.nameSpan.end);
              }}
            >
              Go to source
            </button>
          )}
        </div>
      )}
      {projection.diagnostics.length > 0 && (
        <div className="sysml-diagnostics">
          {projection.diagnostics.length} projection warning(s); source remains authoritative.
        </div>
      )}
      {parseDirty && (
        <div className="sysml-diagnostics sysml-parse-dirty">
          Source has errors - showing the last valid model.
        </div>
      )}
    </div>
  );
}

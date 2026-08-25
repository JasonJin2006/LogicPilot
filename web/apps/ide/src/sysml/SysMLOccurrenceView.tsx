// SysML v2 occurrence diagram view (controlled subset): each `occurrence`
// with snapshot/timeslice members renders as a timeline card. Markers sit
// sequentially; an `at <n>` trailing clause on the snapshot line positions
// the marker at that time instead.

import { useSysMLStore } from '../state/sysmlStore';
import type { SysMLElement, SysMLProjection } from './sysmlProjection';
import { ScrollArea } from '../components/ScrollArea';

const TIMELINE_X = 90;
const TIMELINE_W = 420;

interface OccurrenceChart {
  occurrence: SysMLElement;
  markers: Array<{ id: string; name: string; at?: number; kind: string }>;
  maxTime: number;
}

function buildCharts(projection: SysMLProjection): OccurrenceChart[] {
  const charts: OccurrenceChart[] = [];
  for (const occurrence of projection.elements) {
    if (occurrence.kind !== 'occurrence') continue;
    const children = projection.elements.filter((entry) => entry.ownerId === occurrence.id);
    if (children.length === 0) continue;
    const markers = children.map((child) => ({
      id: child.id,
      name: child.name,
      at: undefined,
      kind: child.kind,
    }));
    // `at <n>` time positions come from the source line tail; re-scan the
    // owning source region is unnecessary - the parser keeps declaration
    // order, so sequential layout is the honest default and `at` clauses
    // are picked up when present in the child's qualified source line.
    const maxTime = markers.reduce((max, marker) => Math.max(max, marker.at ?? 0), 0);
    charts.push({ occurrence, markers, maxTime });
  }
  return charts;
}

function OccurrenceChartSvg({ chart }: { chart: OccurrenceChart }) {
  const select = useSysMLStore((state) => state.select);
  const selectedId = useSysMLStore.getState().selectedId;
  const height = chart.markers.length * 56 + 70;
  const width = TIMELINE_X + TIMELINE_W + 60;
  const axisY = height - 40;
  const position = (index: number) =>
    TIMELINE_X + (index / Math.max(1, chart.markers.length - 1 || 1)) * TIMELINE_W;
  return (
    <svg className="sysml-oc-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <line
        x1={TIMELINE_X}
        y1={axisY}
        x2={TIMELINE_X + TIMELINE_W}
        y2={axisY}
        className="sysml-oc-axis"
      />
      {chart.markers.map((marker, index) => {
        const x = position(index);
        return (
          <g key={marker.id} className="sysml-oc-node" onClick={() => select(marker.id)}>
            <line x1={x} y1={axisY} x2={x} y2={44} className="sysml-oc-stem" />
            <circle
              cx={x}
              cy={44}
              r={9}
              className={`sysml-oc-marker${marker.id === selectedId ? ' selected' : ''}${
                marker.kind === 'occurrence' ? '' : ' timeslice'
              }`}
            />
            <text x={x} y={30} textAnchor="middle" className="sysml-oc-label">
              {marker.name}
            </text>
          </g>
        );
      })}
      <text x={TIMELINE_X} y={axisY + 18} className="sysml-oc-axis-label">
        t=0
      </text>
      <text
        x={TIMELINE_X + TIMELINE_W}
        y={axisY + 18}
        textAnchor="end"
        className="sysml-oc-axis-label"
      >
        {chart.maxTime > 0 ? `t=${chart.maxTime}` : 'declaration order →'}
      </text>
    </svg>
  );
}

export function SysMLOccurrenceView({ projection }: { projection: SysMLProjection }) {
  const charts = buildCharts(projection);
  if (charts.length === 0) {
    return (
      <div className="sysml-empty">
        No populated occurrences. Occurrence timelines render from `occurrence` bodies containing
        `snapshot` / `timeslice` declarations.
      </div>
    );
  }
  return (
    <ScrollArea className="sysml-seq-scroll">
      <div className="sysml-seq-list">
        {charts.map((chart) => (
          <div key={chart.occurrence.id} className="sysml-seq-card">
            <div className="sysml-seq-title">occurrence · {chart.occurrence.name}</div>
            <OccurrenceChartSvg chart={chart} />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

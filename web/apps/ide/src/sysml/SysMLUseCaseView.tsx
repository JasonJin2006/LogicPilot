// SysML v2 use-case diagram view (controlled subset): each `usecase`
// renders as the classic ellipse, with `actor` stick-figure participants on
// the left and the `subject` part on the right, association lines to the
// ellipse. Declared inside the usecase body:
//   usecase '远程巡检' { subject MonitorSystem; actor '巡检员'; }

import { useSysMLStore } from '../state/sysmlStore';
import type { SysMLElement, SysMLProjection } from './sysmlProjection';
import { ScrollArea } from '../components/ScrollArea';

const CARD_W = 560;
const ELLIPSE_RX = 130;
const ELLIPSE_RY = 56;

interface UseCaseChart {
  usecase: SysMLElement;
  actors: SysMLElement[];
  subjects: SysMLElement[];
}

function buildCharts(projection: SysMLProjection): UseCaseChart[] {
  const charts: UseCaseChart[] = [];
  for (const usecase of projection.elements) {
    if (usecase.kind !== 'usecase') continue;
    const children = projection.elements.filter((entry) => entry.ownerId === usecase.id);
    const actors = children.filter((entry) => entry.kind === 'stakeholder');
    const subjects = children.filter((entry) => entry.kind === 'part');
    if (actors.length === 0 && subjects.length === 0) continue;
    charts.push({ usecase, actors, subjects });
  }
  return charts;
}

function UseCaseChartSvg({ chart }: { chart: UseCaseChart }) {
  const select = useSysMLStore((state) => state.select);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const rows = Math.max(chart.actors.length, chart.subjects.length, 1);
  const height = rows * 74 + 60;
  const cx = CARD_W / 2;
  const cy = height / 2;
  const actorX = 86;
  const subjectX = CARD_W - 96;
  return (
    <svg
      className="sysml-uc-svg"
      width={CARD_W}
      height={height}
      viewBox={`0 0 ${CARD_W} ${height}`}
    >
      {chart.actors.map((actor, index) => {
        const y = 52 + index * 74;
        return (
          <g key={actor.id} className="sysml-uc-node" onClick={() => select(actor.id)}>
            <line x1={actorX + 34} y1={y} x2={cx - ELLIPSE_RX + 8} y2={cy} className="sysml-uc-link" />
            <g transform={`translate(${actorX - 16} ${y - 26})`} className="sysml-uc-node">
              <circle cx={16} cy={6} r={6} className={`sysml-uc-actor${actor.id === selectedId ? ' selected' : ''}`} />
              <path
                d="M16 12 V26 M6 17 H26 M16 26 L9 38 M16 26 L23 38"
                className={`sysml-uc-actor${actor.id === selectedId ? ' selected' : ''}`}
              />
            </g>
            <text x={actorX + 24} y={y + 4} className="sysml-uc-label">
              {actor.name}
            </text>
          </g>
        );
      })}
      <ellipse
        cx={cx}
        cy={cy}
        rx={ELLIPSE_RX}
        ry={ELLIPSE_RY}
        className={`sysml-uc-ellipse${chart.usecase.id === selectedId ? ' selected' : ''}`}
        onClick={() => select(chart.usecase.id)}
      />
      <text x={cx} y={cy + 4} textAnchor="middle" className="sysml-uc-title">
        {chart.usecase.name}
      </text>
      {chart.subjects.map((subject, index) => {
        const y = 52 + index * 74;
        return (
          <g key={subject.id} className="sysml-uc-node" onClick={() => select(subject.id)}>
            <line x1={subjectX - 30} y1={y} x2={cx + ELLIPSE_RX - 8} y2={cy} className="sysml-uc-link" />
            <rect
              x={subjectX - 30}
              y={y - 15}
              width={120}
              height={30}
              rx={4}
              className={`sysml-uc-subject${subject.id === selectedId ? ' selected' : ''}`}
            />
            <text x={subjectX + 30} y={y + 4} textAnchor="middle" className="sysml-uc-label">
              {subject.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function SysMLUseCaseView({ projection }: { projection: SysMLProjection }) {
  const charts = buildCharts(projection);
  if (charts.length === 0) {
    return (
      <div className="sysml-empty">
        No populated use cases in this model. Use-case cards render from `usecase` bodies
        containing `actor ...;` / `subject ...;` declarations.
      </div>
    );
  }
  return (
    <ScrollArea className="sysml-seq-scroll">
      <div className="sysml-seq-list">
        {charts.map((chart) => (
          <div key={chart.usecase.id} className="sysml-seq-card">
            <div className="sysml-seq-title">use case · {chart.usecase.name}</div>
            <UseCaseChartSvg chart={chart} />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

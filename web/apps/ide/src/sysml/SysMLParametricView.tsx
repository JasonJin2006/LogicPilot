// SysML v2 parametric view (plan slice 4, controlled subset): every
// constraint with binding expressions renders as a small equation card -
// bound attributes feed the constraint node, edges carry the full
// expression as their label. Expressions are displayed, never evaluated.

import { useSysMLStore } from '../state/sysmlStore';
import type { SysMLElement, SysMLProjection } from './sysmlProjection';
import { ScrollArea } from '../components/ScrollArea';

const ATTR_W = 150;
const ATTR_H = 30;
const GAP = 18;
const CONSTRAINT_X = 260;

interface ParametricChart {
  constraint: SysMLElement;
  /** (attributeElement, expressionLabel) in source order, deduped. */
  bindings: Array<{ attribute: SysMLElement; expression: string }>;
  width: number;
  height: number;
}

function buildCharts(projection: SysMLProjection): ParametricChart[] {
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  const charts: ParametricChart[] = [];
  for (const constraint of projection.elements) {
    if (constraint.kind !== 'constraint') continue;
    const seen = new Set<string>();
    const bindings: ParametricChart['bindings'] = [];
    for (const relation of projection.relations) {
      if (relation.kind !== 'binds' || relation.to !== constraint.id) continue;
      const attribute = byId.get(relation.from);
      if (attribute === undefined || seen.has(attribute.id)) continue;
      seen.add(attribute.id);
      bindings.push({ attribute, expression: relation.label });
    }
    if (bindings.length === 0) continue;
    const height = bindings.length * (ATTR_H + GAP) + GAP * 2;
    charts.push({ constraint, bindings, width: 560, height });
  }
  return charts;
}

function ParametricChartSvg({ chart }: { chart: ParametricChart }) {
  const select = useSysMLStore((state) => state.select);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const constraintX = CONSTRAINT_X;
  const constraintW = 220;
  const constraintH = 46;
  const constraintY = chart.height / 2 - constraintH / 2;
  return (
    <svg
      className="sysml-par-svg"
      width={chart.width}
      height={chart.height}
      viewBox={`0 0 ${chart.width} ${chart.height}`}
    >
      {chart.bindings.map((binding, index) => {
        const y = GAP + index * (ATTR_H + GAP);
        const attrX = 16;
        return (
          <g key={binding.attribute.id}>
            <line
              x1={attrX + ATTR_W}
              y1={y + ATTR_H / 2}
              x2={constraintX}
              y2={chart.height / 2}
              className="sysml-par-edge"
            />
            <text
              x={(attrX + ATTR_W + constraintX) / 2}
              y={(y + ATTR_H / 2 + chart.height / 2) / 2 - 4}
              textAnchor="middle"
              className="sysml-par-expr"
            >
              {binding.expression}
            </text>
            <rect
              x={attrX}
              y={y}
              width={ATTR_W}
              height={ATTR_H}
              rx={4}
              className={`sysml-par-attr${binding.attribute.id === selectedId ? ' selected' : ''}`}
              onClick={() => select(binding.attribute.id)}
            />
            <text x={attrX + ATTR_W / 2} y={y + 19} textAnchor="middle" className="sysml-par-text">
              {binding.attribute.name}
            </text>
          </g>
        );
      })}
      <g onClick={() => select(chart.constraint.id)}>
        <rect
          x={constraintX}
          y={constraintY}
          width={constraintW}
          height={constraintH}
          rx={6}
          className={`sysml-par-constraint${chart.constraint.id === selectedId ? ' selected' : ''}`}
        />
        <text
          x={constraintX + constraintW / 2}
          y={constraintY + 20}
          textAnchor="middle"
          className="sysml-par-text"
        >
          «constraint» {chart.constraint.name}
        </text>
      </g>
    </svg>
  );
}

export function SysMLParametricView({ projection }: { projection: SysMLProjection }) {
  const charts = buildCharts(projection);
  if (charts.length === 0) {
    return (
      <div className="sysml-empty">
        No constraint bindings in this model. Parametric cards render from `constraint` bodies
        containing expression lines like `'A' &gt;= 'B' + 3;`.
      </div>
    );
  }
  return (
    <ScrollArea className="sysml-seq-scroll">
      <div className="sysml-seq-list">
        {charts.map((chart) => (
          <div key={chart.constraint.id} className="sysml-seq-card">
            <div className="sysml-seq-title">{chart.constraint.name}</div>
            <ParametricChartSvg chart={chart} />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

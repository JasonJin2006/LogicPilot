// SysML v2 sequence-diagram view (plan slice 2, controlled subset): every
// `interaction` with messages renders as a classic lifeline chart -
// participant headers in declaration order, dashed lifelines, solid arrows
// for `message`, dashed arrows for `reply`, ordered by source line.

import { useSysMLStore } from '../state/sysmlStore';
import type { SysMLElement, SysMLProjection } from './sysmlProjection';
import { ScrollArea } from '../components/ScrollArea';

const LIFELINE_GAP = 170;
const HEADER_H = 34;
const MESSAGE_GAP = 38;
const TOP_PAD = 14;

interface SequenceChart {
  interaction: SysMLElement;
  participants: SysMLElement[];
  /** (participantId, participantId, label, isReply, line) in source order. */
  messages: Array<{ from: string; to: string; label: string; reply: boolean; line: number }>;
  /** alt/loop/parallel frames: element span covers the block extent, so
   *  member messages group by source line. Single level (no nesting). */
  fragments: Array<{ id: string; name: string; start: number; end: number }>;
  width: number;
  height: number;
}

function buildCharts(projection: SysMLProjection): SequenceChart[] {
  const charts: SequenceChart[] = [];
  for (const interaction of projection.elements) {
    if (interaction.kind !== 'interaction') continue;
    const participants = projection.elements.filter(
      (element) => element.ownerId === interaction.id,
    );
    const participantIds = new Set(participants.map((entry) => entry.id));
    const messages = projection.relations
      .filter(
        (relation) =>
          (relation.kind === 'messages' || relation.kind === 'replies') &&
          participantIds.has(relation.from) &&
          participantIds.has(relation.to),
      )
      .sort((a, b) => a.line - b.line)
      .map((relation) => ({
        from: relation.from,
        to: relation.to,
        label: relation.label,
        reply: relation.kind === 'replies',
        line: relation.line,
      }));
    if (participants.length === 0 || messages.length === 0) continue;
    const fragments = projection.elements
      .filter((element) => element.kind === 'fragment' && element.ownerId === interaction.id)
      .map((fragment) => ({
        id: fragment.id,
        name: fragment.name,
        start: fragment.span.start,
        end: fragment.span.end,
      }));
    const width = Math.max(participants.length * LIFELINE_GAP + 40, 420);
    const height = TOP_PAD + HEADER_H + messages.length * MESSAGE_GAP + 26;
    charts.push({ interaction, participants, messages, fragments, width, height });
  }
  return charts;
}

function SequenceChartSvg({ chart }: { chart: SequenceChart }) {
  const select = useSysMLStore((state) => state.select);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const centerX = (index: number) => 40 + index * LIFELINE_GAP + (LIFELINE_GAP - 40) / 2;
  const lifelineEnd = chart.height - 12;
  return (
    <svg
      className="sysml-seq-svg"
      width={chart.width}
      height={chart.height}
      viewBox={`0 0 ${chart.width} ${chart.height}`}
    >
      {chart.participants.map((participant, index) => {
        const x = centerX(index);
        return (
          <g
            key={participant.id}
            onClick={() => select(participant.id)}
            className="sysml-seq-participant"
          >
            <rect
              x={x - 64}
              y={TOP_PAD}
              width={128}
              height={HEADER_H - 8}
              rx={4}
              className={`sysml-seq-head${participant.id === selectedId ? ' selected' : ''}`}
            />
            <text x={x} y={TOP_PAD + 18} textAnchor="middle" className="sysml-seq-head-text">
              {participant.name}
            </text>
            <line
              x1={x}
              y1={TOP_PAD + HEADER_H - 8}
              x2={x}
              y2={lifelineEnd}
              className="sysml-seq-lifeline"
            />
          </g>
        );
      })}
      {chart.fragments.map((fragment) => {
        const memberLines = chart.messages.filter(
          (message) => message.line >= fragment.start && message.line <= fragment.end,
        );
        if (memberLines.length === 0) return null;
        const first = chart.messages.indexOf(memberLines[0]!);
        const last = chart.messages.indexOf(memberLines[memberLines.length - 1]!);
        const top = TOP_PAD + HEADER_H + first * MESSAGE_GAP;
        const bottom = TOP_PAD + HEADER_H + (last + 1) * MESSAGE_GAP;
        return (
          <g key={fragment.id}>
            <rect
              x={12}
              y={top + 2}
              width={chart.width - 24}
              height={bottom - top - 4}
              rx={6}
              className="sysml-seq-frame"
            />
            <text x={22} y={top + 16} className="sysml-seq-frame-label">
              {fragment.name}
            </text>
          </g>
        );
      })}
      {chart.messages.map((message, index) => {
        const fromIndex = chart.participants.findIndex((entry) => entry.id === message.from);
        const toIndex = chart.participants.findIndex((entry) => entry.id === message.to);
        if (fromIndex === -1 || toIndex === -1) return null;
        const y = TOP_PAD + HEADER_H + index * MESSAGE_GAP + MESSAGE_GAP / 2;
        const x1 = centerX(fromIndex);
        const x2 = centerX(toIndex);
        const mid = (x1 + x2) / 2;
        return (
          <g key={`${message.line}-${index}`}>
            <text x={mid} y={y - 5} textAnchor="middle" className="sysml-seq-label">
              {message.label}
            </text>
            <line
              x1={x1}
              y1={y}
              x2={x2}
              y2={y}
              className={message.reply ? 'sysml-seq-reply' : 'sysml-seq-message'}
            />
            {(() => {
              const dir = x2 >= x1 ? 1 : -1;
              const tip = x2 - dir * 7;
              return (
                <polyline
                  points={`${tip},${y - 3.5} ${x2},${y} ${tip},${y + 3.5}`}
                  className={message.reply ? 'sysml-seq-reply' : 'sysml-seq-message'}
                />
              );
            })()}
          </g>
        );
      })}
    </svg>
  );
}

export function SysMLSequenceView({ projection }: { projection: SysMLProjection }) {
  const charts = buildCharts(projection);
  if (charts.length === 0) {
    return (
      <div className="sysml-empty">
        No interactions with messages in this model. Sequence charts render from `interaction`
        bodies containing `message` / `reply ... from ... to ...;` statements.
      </div>
    );
  }
  return (
    <ScrollArea className="sysml-seq-scroll">
      <div className="sysml-seq-list">
        {charts.map((chart) => (
          <div key={chart.interaction.id} className="sysml-seq-card">
            <div className="sysml-seq-title">{chart.interaction.name}</div>
            <SequenceChartSvg chart={chart} />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

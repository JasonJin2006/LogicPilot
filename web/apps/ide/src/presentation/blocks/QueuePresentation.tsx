// Presentation for a `queue` element: a waiting area that lays out the
// agents whose world x is at/after the server cells (from Tick deltas).

import { Line, Oval, Text } from '../shapes';
import type { PresentationProps } from '../registry';

const CELL_W = 56;
const SPACING = 22;

export function QueuePresentation({ element, runtime }: PresentationProps) {
  const waiting = [...runtime.agents.values()].filter((agent) => agent.x >= runtime.servers);
  const y = element.y;
  const startX = element.x - 30;
  return (
    <g>
      <Line
        x1={startX - 20}
        y1={y}
        x2={startX + 200}
        y2={y}
        stroke="var(--text-muted)"
        opacity={0.3}
      />
      {waiting.map((agent, index) => {
        const slot = Math.round(agent.x) - runtime.servers;
        const x = startX + slot * SPACING;
        const interpolated = Math.min(200, Math.max(0, x - startX));
        return (
          <Oval
            key={`${element.id}-${index}-${agent.x}`}
            cx={startX + interpolated}
            cy={y + (index % 2) * 10}
            r={9}
            fill="var(--accent)"
          />
        );
      })}
      <Text x={startX} y={y + 34} fill="var(--text-muted)" fontSize={11}>
        {element.name} ({waiting.length})
      </Text>
    </g>
  );
}

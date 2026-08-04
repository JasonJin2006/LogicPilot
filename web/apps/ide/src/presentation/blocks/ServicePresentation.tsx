// Presentation for a `service` element: one cell per server (busy / down /
// idle colors), with in-service agents drawn on their cell.

import { Oval, Rect, RoundedRect, Text } from '../shapes';
import type { PresentationProps } from '../registry';

const CELL_W = 56;
const CELL_H = 84;

export function ServicePresentation({ element, runtime }: PresentationProps) {
  const servers = Math.max(1, Math.round(runtime.servers));
  const downServers = Math.max(0, Math.min(runtime.downServers, servers));
  const originX = element.x - 40;
  const originY = element.y - CELL_H / 2;
  const inService = [...runtime.agents.values()].filter((agent) => agent.x < servers);
  return (
    <g>
      {Array.from({ length: servers }, (_, i) => {
        const down = i >= servers - downServers;
        const fill = down
          ? 'var(--error-dim)'
          : runtime.busy
            ? 'var(--warn-dim)'
            : 'var(--surface-2)';
        const stroke = down ? 'var(--error)' : runtime.busy ? 'var(--warn)' : 'var(--border)';
        const cx = originX + i * CELL_W;
        return (
          <RoundedRect
            key={i}
            x={cx + 2}
            y={originY}
            width={CELL_W - 14}
            height={CELL_H}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
          />
        );
      })}
      {inService.map((agent) => (
        <Oval
          key={`${element.id}-${agent.x}`}
          cx={originX + agent.x * CELL_W + CELL_W / 2}
          cy={originY + CELL_H / 2}
          r={9}
          fill="var(--ok)"
        />
      ))}
      <Text x={originX} y={originY + CELL_H + 22} fill="var(--text-muted)" fontSize={11}>
        {element.name}
      </Text>
    </g>
  );
}

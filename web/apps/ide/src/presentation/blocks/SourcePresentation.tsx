// Presentation for a `source` element: arrivals generator (icon + label)
// feeding the flow to the right.

import { Line, Oval, Rect, Text } from '../shapes';
import type { PresentationProps } from '../registry';

export function SourcePresentation({ element }: PresentationProps) {
  return (
    <g>
      <Rect
        x={element.x - 30}
        y={element.y - 22}
        width={60}
        height={44}
        rx={8}
        fill="var(--accent-dim)"
        stroke="var(--accent)"
      />
      <Oval cx={element.x} cy={element.y - 2} r={9} fill="var(--accent)" />
      <Text x={element.x} y={element.y + 34} anchor="middle" fill="var(--text-muted)" fontSize={11}>
        {element.name}
      </Text>
      <Line
        x1={element.x + 30}
        y1={element.y}
        x2={element.x + 70}
        y2={element.y}
        stroke="var(--text-muted)"
        dashed
      />
    </g>
  );
}

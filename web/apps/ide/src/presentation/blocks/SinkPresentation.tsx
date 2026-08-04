// Presentation for a `sink` element: the terminal stage.

import { Rect, Text } from '../shapes';
import type { PresentationProps } from '../registry';

export function SinkPresentation({ element }: PresentationProps) {
  return (
    <g>
      <Rect
        x={element.x - 24}
        y={element.y - 18}
        width={48}
        height={36}
        rx={4}
        fill="var(--surface-2)"
        stroke="var(--border)"
      />
      <Text x={element.x} y={element.y + 26} anchor="middle" fill="var(--text-muted)" fontSize={11}>
        {element.name}
      </Text>
    </g>
  );
}

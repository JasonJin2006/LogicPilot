// The process-library palette (mirrors libraries/process.lplib): block
// metadata shared by the Palette panel and the modeling canvas. Flow blocks
// carry directional in/out ports on their icon/card edges; `resource` is
// seized, so it stays out of the flow and gets no ports.

import type { BlockKind } from '@logicpilot/editor';

export interface BlockDef {
  kind: BlockKind;
  hint: string;
  in?: boolean;
  out?: boolean;
}

export const BLOCK_DEFS: BlockDef[] = [
  { kind: 'resource', hint: 'capacity / failure_rate' },
  { kind: 'source', hint: 'arrival rate', out: true },
  { kind: 'queue', hint: 'buffer capacity', in: true, out: true },
  { kind: 'service', hint: 'resource + time', in: true, out: true },
  { kind: 'sink', hint: 'terminal stage', in: true },
];

export function blockPorts(kind: BlockKind): { in?: boolean; out?: boolean } {
  const def = BLOCK_DEFS.find((entry) => entry.kind === kind);
  return { in: def?.in, out: def?.out };
}

// Canvas card geometry (must match styles/model.css): the block card is a
// centered flex column (34px icon + 4px gap + 15px name line). Port dots are
// drawn on the icon's left/right midpoints, so their anchors are fixed world
// offsets from the block center. The x offset is width-independent (the icon
// is centered in the card); the y offset only depends on the fixed heights.
export const PORT_X = 17;
export const PORT_Y = -9.5;

export function portAnchor(
  node: { x: number; y: number },
  port: 'in' | 'out',
): { x: number; y: number } {
  return { x: node.x + (port === 'in' ? -PORT_X : PORT_X), y: node.y + PORT_Y };
}

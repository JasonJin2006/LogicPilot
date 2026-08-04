// Palette block libraries: metadata shared by the Palette panel and the
// modeling canvas. The process library mirrors libraries/process.lplib
// (flow blocks carry in/out ports); presentation/statechart/action mirror
// AnyLogic's drawing and behavior elements (canvas annotations, not DSL).

export type LibraryId = 'process' | 'presentation' | 'statechart' | 'action';

export interface BlockDef {
  kind: string;
  library: LibraryId;
  name: string;
  hint?: string;
  in?: boolean;
  out?: boolean;
}

/** Built-in libraries shown as tabs in the palette selector bar. */
export const LIBRARIES: Array<{ id: LibraryId; name: string }> = [
  { id: 'process', name: 'process' },
  { id: 'presentation', name: 'presentation' },
  { id: 'statechart', name: 'statechart' },
  { id: 'action', name: 'action' },
];

const PROCESS_DEFS: BlockDef[] = [
  { kind: 'resource', library: 'process', name: 'resource', hint: 'capacity / failure_rate' },
  { kind: 'source', library: 'process', name: 'source', hint: 'arrival rate', out: true },
  { kind: 'queue', library: 'process', name: 'queue', hint: 'buffer capacity', in: true, out: true },
  { kind: 'delay', library: 'process', name: 'delay', hint: 'hold agents for a time', in: true, out: true },
  { kind: 'service', library: 'process', name: 'service', hint: 'resource + time', in: true, out: true },
  { kind: 'split', library: 'process', name: 'split', hint: 'clone each agent', in: true, out: true },
  { kind: 'combine', library: 'process', name: 'combine', hint: 'merge agents into one', in: true, out: true },
  { kind: 'batch', library: 'process', name: 'batch', hint: 'accumulate agents', in: true, out: true },
  { kind: 'unbatch', library: 'process', name: 'unbatch', hint: 'release a batch', in: true, out: true },
  { kind: 'seize', library: 'process', name: 'seize', hint: 'grab a resource unit', in: true, out: true },
  { kind: 'release', library: 'process', name: 'release', hint: 'return a resource unit', in: true, out: true },
  { kind: 'wait', library: 'process', name: 'wait', hint: 'buffer with capacity', in: true, out: true },
  { kind: 'hold', library: 'process', name: 'hold', hint: 'hold/resume the flow', in: true, out: true },
  { kind: 'match', library: 'process', name: 'match', hint: 'pair agents', in: true, out: true },
  { kind: 'selectOutput', library: 'process', name: 'selectOutput', hint: 'route by condition', in: true, out: true },
  { kind: 'enter', library: 'process', name: 'enter', hint: 'enter the process', out: true },
  { kind: 'exit', library: 'process', name: 'exit', hint: 'leave the process', in: true },
  { kind: 'moveTo', library: 'process', name: 'moveTo', hint: 'move agents to a node', in: true, out: true },
  { kind: 'timeMeasureStart', library: 'process', name: 'timeMeasureStart', hint: 'start timing', out: true },
  { kind: 'timeMeasureEnd', library: 'process', name: 'timeMeasureEnd', hint: 'end timing', in: true },
  { kind: 'assembler', library: 'process', name: 'assembler', hint: 'assemble from parts', in: true, out: true },
  { kind: 'count', library: 'process', name: 'count', hint: 'count passed agents', in: true, out: true },
  { kind: 'sink', library: 'process', name: 'sink', hint: 'terminal stage', in: true },
];

// Presentation library: basic shapes for auxiliary drawing (AnyLogic
// presentation shapes). Rendered as real shapes on the canvas.
const PRESENTATION_DEFS: BlockDef[] = [
  { kind: 'rect', library: 'presentation', name: 'Rectangle' },
  { kind: 'roundedRect', library: 'presentation', name: 'Rounded Rectangle' },
  { kind: 'oval', library: 'presentation', name: 'Oval' },
  { kind: 'line', library: 'presentation', name: 'Line' },
  { kind: 'polyline', library: 'presentation', name: 'Polyline' },
  { kind: 'arc', library: 'presentation', name: 'Arc' },
  { kind: 'curve', library: 'presentation', name: 'Curve' },
  { kind: 'text', library: 'presentation', name: 'Text' },
  { kind: 'image', library: 'presentation', name: 'Image' },
  { kind: 'group', library: 'presentation', name: 'Group' },
];

// Statechart library (AnyLogic statecharts).
const STATECHART_DEFS: BlockDef[] = [
  { kind: 'state', library: 'statechart', name: 'State' },
  { kind: 'initialState', library: 'statechart', name: 'Initial State' },
  { kind: 'finalState', library: 'statechart', name: 'Final State' },
  { kind: 'transition', library: 'statechart', name: 'Transition' },
  { kind: 'historyState', library: 'statechart', name: 'History State' },
  { kind: 'branch', library: 'statechart', name: 'Branch' },
];

// Action chart library (AnyLogic action charts).
const ACTION_DEFS: BlockDef[] = [
  { kind: 'action', library: 'action', name: 'Action' },
  { kind: 'decision', library: 'action', name: 'Decision' },
  { kind: 'whileLoop', library: 'action', name: 'While Loop' },
  { kind: 'forLoop', library: 'action', name: 'For Loop' },
  { kind: 'doWhileLoop', library: 'action', name: 'Do-While Loop' },
  { kind: 'break', library: 'action', name: 'Break' },
  { kind: 'return', library: 'action', name: 'Return' },
  { kind: 'localVariable', library: 'action', name: 'Local Variable' },
];

export const BLOCK_DEFS: BlockDef[] = [
  ...PROCESS_DEFS,
  ...PRESENTATION_DEFS,
  ...STATECHART_DEFS,
  ...ACTION_DEFS,
];

/** Kinds that render as real drawing shapes instead of block cards. */
export const PRESENTATION_KINDS: ReadonlySet<string> = new Set(
  PRESENTATION_DEFS.map((def) => def.kind),
);

export function blockPorts(kind: string): { in?: boolean; out?: boolean } {
  const def = BLOCK_DEFS.find((entry) => entry.kind === kind);
  return { in: def?.in, out: def?.out };
}

export type FieldType = 'int' | 'float' | 'distribution' | 'ref';

export interface BlockField {
  key: string;
  type: FieldType;
}

/** Library field shapes (process.lplib for the core; the extended PML
 *  blocks carry a subset for canvas editing until their kernel lowering
 *  lands). */
export const BLOCK_FIELDS: Record<string, BlockField[]> = {
  resource: [
    { key: 'capacity', type: 'int' },
    { key: 'failure_rate', type: 'float' },
  ],
  source: [{ key: 'arrival', type: 'distribution' }],
  queue: [{ key: 'capacity', type: 'int' }],
  delay: [{ key: 'time', type: 'distribution' }],
  service: [
    { key: 'resource', type: 'ref' },
    { key: 'time', type: 'distribution' },
  ],
  split: [{ key: 'copies', type: 'int' }],
  combine: [{ key: 'agents', type: 'int' }],
  batch: [{ key: 'size', type: 'int' }],
  unbatch: [],
  seize: [{ key: 'resource', type: 'ref' }],
  release: [{ key: 'resource', type: 'ref' }],
  wait: [{ key: 'capacity', type: 'int' }],
  hold: [],
  match: [],
  selectOutput: [{ key: 'probability', type: 'float' }],
  enter: [],
  exit: [],
  moveTo: [],
  timeMeasureStart: [],
  timeMeasureEnd: [],
  assembler: [],
  count: [],
  sink: [],
};

/** Friendly defaults applied when a block is dropped. service.resource is
 *  deliberately left empty so the user picks a resource reference. */
export const BLOCK_DEFAULTS: Record<string, Record<string, string | number | boolean>> = {
  resource: { capacity: 1, failure_rate: 0 },
  source: { arrival: 'poisson(10)' },
  queue: { capacity: 100 },
  delay: { time: 'exponential(1.0)' },
  service: { time: 'exponential(1)' },
  split: { copies: 2 },
  combine: { agents: 2 },
  batch: { size: 2 },
  seize: { resource: '' },
  release: { resource: '' },
  wait: { capacity: 100 },
  selectOutput: { probability: 0.5 },
  sink: {},
};

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

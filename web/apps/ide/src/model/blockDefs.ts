// Palette block libraries: metadata shared by the Palette panel and the
// modeling canvas. The process library is driven by
// libraries/pml-catalog.json (the AnyLogic-derived single source of truth):
// every block carries its full port list (with conditional visibility) and
// the full AnyLogic property list. Presentation/statechart/action mirror
// AnyLogic's drawing and behavior elements (canvas annotations, not DSL).
import { BLOCK_CATALOG } from './blockCatalog';

export type LibraryId = 'process' | 'presentation' | 'statechart' | 'action';

/** Container kinds whose subgraph opens as its own canvas (drill-in), like
 *  AnyLogic agent canvases. `process` is the builtin flow container;
 *  agent/atomic/continuous are the DSL method containers. */
export const CANVAS_CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'process',
  'agent',
  'atomic',
  'continuous',
]);

export type PortDirection = 'in' | 'out' | 'inout';

export interface BlockPortDef {
  name: string;
  direction: PortDirection;
  conditionalOn: string | null;
  description: string;
}

export type CatalogFieldType =
  'int' | 'float' | 'bool' | 'string' | 'enum' | 'distribution' | 'ref' | 'expression';

export interface BlockPropertyDef {
  name: string;
  displayName: string;
  type: CatalogFieldType;
  default: string | number | boolean | null;
  validValues: string[] | null;
  visibleWhen: string | null;
  section: string;
  required: boolean;
  runtimeSettable: boolean;
  description: string;
}

export interface BlockDef {
  kind: string;
  library: LibraryId;
  name: string;
  hint?: string;
  ports: BlockPortDef[];
  properties: BlockPropertyDef[];
}

interface CatalogBlock {
  kind: string;
  friendlyName: string;
  ports: BlockPortDef[];
  properties: BlockPropertyDef[];
}

const catalogBlocks = BLOCK_CATALOG;

/** Built-in libraries shown as tabs in the palette selector bar. */
export const LIBRARIES: Array<{ id: LibraryId; name: string }> = [
  { id: 'process', name: 'process' },
  { id: 'presentation', name: 'presentation' },
  { id: 'statechart', name: 'statechart' },
  { id: 'action', name: 'action' },
];

function catalogDef(kind: string): CatalogBlock | undefined {
  return catalogBlocks.find((block) => block.kind === kind);
}

function processDef(kind: string, hint: string): BlockDef {
  const catalog = catalogDef(kind);
  return {
    kind,
    library: 'process',
    name: kind,
    hint,
    ports: catalog?.ports ?? [],
    properties: catalog?.properties ?? [],
  };
}

const PROCESS_DEFS: BlockDef[] = [
  processDef('resource', 'capacity / failure_rate'),
  processDef('source', 'arrival rate'),
  processDef('queue', 'buffer capacity'),
  processDef('delay', 'hold agents for a time'),
  processDef('service', 'resource + time'),
  processDef('split', 'clone each agent'),
  processDef('combine', 'merge agents into one'),
  processDef('batch', 'accumulate agents'),
  processDef('unbatch', 'release a batch'),
  processDef('seize', 'grab a resource unit'),
  processDef('release', 'return a resource unit'),
  processDef('wait', 'buffer with capacity'),
  processDef('hold', 'hold/resume the flow'),
  processDef('match', 'pair agents'),
  processDef('selectOutput', 'route by condition'),
  processDef('enter', 'enter the process'),
  processDef('exit', 'leave the process'),
  processDef('moveTo', 'move agents to a node'),
  processDef('timeMeasureStart', 'start timing'),
  processDef('timeMeasureEnd', 'end timing'),
  processDef('assembler', 'assemble from parts'),
  processDef('count', 'count passed agents'),
  processDef('sink', 'terminal stage'),
  // AnyLogic PML full palette (added 2026-08-06; kernel execution support
  // lands per-block, until then the DSL compiler reports LP2004).
  processDef('selectOutput5', 'route to one of five outputs'),
  processDef('selectOutputIn', 'merge up to five inputs'),
  processDef('selectOutputOut', 'fan one input out to five branches'),
  processDef('restrictedAreaStart', 'enter a restricted area'),
  processDef('restrictedAreaEnd', 'leave a restricted area'),
  processDef('pickup', 'pick agents from a queue into a container'),
  processDef('dropoff', 'drop agents from a container into a queue'),
  processDef('resourceTaskStart', 'start a resource task'),
  processDef('resourceTaskEnd', 'finish a resource task'),
  processDef('resourceSendTo', 'send a resource unit to a node'),
  processDef('resourceAttach', 'attach a resource unit'),
  processDef('resourceDetach', 'detach a resource unit'),
  processDef('downtime', 'model resource downtime'),
  processDef('pMLSettings', 'process library settings'),
  processDef('plainTransfer', 'plain agent transfer'),
];

// Presentation library: basic shapes for auxiliary drawing (AnyLogic
// presentation shapes). Rendered as real shapes on the canvas.
const PRESENTATION_DEFS: BlockDef[] = (
  [
    ['rect', 'Rectangle'],
    ['roundedRect', 'Rounded Rectangle'],
    ['oval', 'Oval'],
    ['line', 'Line'],
    ['polyline', 'Polyline'],
    ['arc', 'Arc'],
    ['curve', 'Curve'],
    ['text', 'Text'],
    ['image', 'Image'],
    ['group', 'Group'],
  ] as const
).map(([kind, name]) => ({
  kind,
  library: 'presentation',
  name,
  ports: [],
  properties: [],
}));

// Statechart library (AnyLogic statecharts).
const STATECHART_DEFS: BlockDef[] = (
  [
    ['state', 'State'],
    ['initialState', 'Initial State'],
    ['finalState', 'Final State'],
    ['transition', 'Transition'],
    ['historyState', 'History State'],
    ['branch', 'Branch'],
  ] as const
).map(([kind, name]) => ({
  kind,
  library: 'statechart',
  name,
  ports: [],
  properties: [],
}));

// Action chart library (AnyLogic action charts).
const ACTION_DEFS: BlockDef[] = (
  [
    ['action', 'Action'],
    ['decision', 'Decision'],
    ['whileLoop', 'While Loop'],
    ['forLoop', 'For Loop'],
    ['doWhileLoop', 'Do-While Loop'],
    ['break', 'Break'],
    ['return', 'Return'],
    ['localVariable', 'Local Variable'],
  ] as const
).map(([kind, name]) => ({
  kind,
  library: 'action',
  name,
  ports: [],
  properties: [],
}));

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

/** The block's full port list (direction + conditional visibility). */
export function blockPorts(kind: string): BlockPortDef[] {
  return BLOCK_DEFS.find((entry) => entry.kind === kind)?.ports ?? [];
}

export type FieldType = CatalogFieldType;

/** Keep the narrow BlockField alias for callers that only need key/type. */
export interface BlockField {
  key: string;
  type: FieldType;
}

/** The block's full property list (the AnyLogic catalog is authoritative). */
export function blockProperties(kind: string): BlockPropertyDef[] {
  return BLOCK_DEFS.find((entry) => entry.kind === kind)?.properties ?? [];
}

/** Friendly defaults applied when a block is dropped (catalog defaults). */
export const BLOCK_DEFAULTS: Record<
  string,
  Record<string, string | number | boolean>
> = Object.fromEntries(
  BLOCK_DEFS.map((def) => [
    def.kind,
    Object.fromEntries(
      def.properties
        .filter((property) => property.default !== null)
        .map((property) => [property.name, property.default as string | number | boolean]),
    ),
  ]),
);

// ── Port geometry ─────────────────────────────────────────────────────────
// Port anchors mirror AnyLogic's green-dot placement (PML palette reference):
// primary in/out on the glyph's left/right mid-edge; conditional ports along
// the TOP edge (seize.preparedUnits / release.wrapUp on the bottom); split /
// combine on the triangle corners; selectOutput.outF on the diamond's bottom
// vertex; timeMeasure pairs keep one port under the stopwatch.
// Coordinates are in the icon's 40×40 viewBox space, scaled to the rendered
// 34px canvas icon.
export const PORT_X = 17; // fallback rail for blocks without a layout entry
export const PORT_Y = -9.5; // icon centre relative to the node centre
const ICON_SCALE = 34 / 40;
const PORT_STACK_SPACING = 16; // fallback stacking for custom libraries

const PORT_LAYOUTS: Record<string, Record<string, [number, number]>> = {
  source: { in: [9, 20], out: [31, 20] },
  sink: { in: [9, 20] },
  enter: { out: [31, 20] },
  exit: { in: [9, 20] },
  hold: { in: [9, 20], out: [31, 20] },
  count: { in: [9, 20], out: [31, 20] },
  delay: { in: [7, 20], out: [33, 20] },
  queue: { in: [7, 20], out: [33, 20], outTimeout: [16, 11], outPreempted: [24, 11] },
  service: { in: [7, 20], out: [33, 20], outTimeout: [16, 11], outPreempted: [24, 11] },
  wait: { in: [7, 20], out: [33, 20], outTimeout: [16, 11], outPreempted: [24, 11] },
  seize: {
    in: [7, 20],
    out: [33, 20],
    outTimeout: [16, 11],
    outPreempted: [24, 11],
    preparedUnits: [16, 29],
  },
  release: { in: [7, 20], out: [33, 20], wrapUp: [24, 29] },
  batch: { in: [7, 20], out: [33, 20] },
  unbatch: { in: [7, 20], out: [33, 20] },
  moveTo: { in: [7, 20], out: [33, 20] },
  selectOutput: { in: [9, 20], outT: [31, 20], outF: [20, 32] },
  selectOutput5: {
    in: [9, 20],
    out1: [31, 8],
    out2: [31, 14],
    out3: [31, 20],
    out4: [31, 26],
    out5: [31, 32],
  },
  selectOutputIn: {
    in1: [9, 12],
    in2: [9, 16],
    in3: [9, 20],
    in4: [9, 24],
    in5: [9, 28],
    out: [31, 20],
  },
  selectOutputOut: {
    in: [9, 20],
    out1: [31, 12],
    out2: [31, 16],
    out3: [31, 20],
    out4: [31, 24],
    out5: [31, 28],
  },
  split: { in: [12, 12], out: [28, 12], outCopy: [28, 28] },
  combine: { in1: [12, 12], in2: [12, 28], out: [28, 28] },
  match: {
    in1: [7, 15],
    in2: [7, 25],
    out1: [33, 15],
    out2: [33, 25],
    outTimeout1: [16, 9],
    outTimeout2: [24, 9],
    outPreempted1: [16, 31],
    outPreempted2: [24, 31],
  },
  assembler: { in: [11, 14], p1: [11, 26], out: [29, 20] },
  timeMeasureStart: { in: [15, 26], out: [30, 20] },
  timeMeasureEnd: { in: [9, 20], out: [25, 26] },
  resourceTaskStart: { in: [12, 20], out: [28, 20] },
  resourceTaskEnd: { in: [12, 20], out: [28, 20] },
  resourceSendTo: { in: [7, 20], out: [33, 20] },
  resourceAttach: { in: [7, 20], out: [33, 20] },
  resourceDetach: { in: [7, 20], out: [33, 20] },
  pickup: { in: [7, 20], out: [33, 20] },
  dropoff: { in: [7, 20], out: [33, 20] },
  restrictedAreaStart: { in: [10, 20], out: [25, 20] },
  restrictedAreaEnd: { in: [15, 20], out: [30, 20] },
  plainTransfer: { in: [10, 20], out: [30, 20] },
};

/** Port anchor in the icon's 40×40 viewBox space (used by the palette dots). */
export function portGlyphPoint(
  kind: string,
  port: string,
  direction: PortDirection,
): [number, number] {
  return PORT_LAYOUTS[kind]?.[port] ?? (direction === 'in' ? [7, 20] : [33, 20]);
}

export function portAnchor(
  node: { x: number; y: number; kind?: string },
  port: string,
): { x: number; y: number } {
  const point = PORT_LAYOUTS[node.kind ?? '']?.[port];
  if (point) {
    return {
      x: node.x + (point[0] - 20) * ICON_SCALE,
      y: node.y + PORT_Y + (point[1] - 20) * ICON_SCALE,
    };
  }
  // Fallback (custom libraries): stack on the left/right mid-edge.
  const ports = node.kind ? blockPorts(node.kind) : [];
  const spec = ports.find((entry) => entry.name === port);
  if (spec?.direction === 'in' || spec?.direction === 'inout') {
    const ins = ports.filter((entry) => entry.direction === 'in' || entry.direction === 'inout');
    const index = Math.max(
      0,
      ins.findIndex((entry) => entry.name === port),
    );
    return {
      x: node.x - PORT_X,
      y: node.y + PORT_Y + (index - (ins.length - 1) / 2) * PORT_STACK_SPACING,
    };
  }
  const outs = ports.filter((entry) => entry.direction === 'out' || entry.direction === 'inout');
  const index = Math.max(
    0,
    outs.findIndex((entry) => entry.name === port),
  );
  return {
    x: node.x + PORT_X,
    y: node.y + PORT_Y + (index - (outs.length - 1) / 2) * PORT_STACK_SPACING,
  };
}

// Palette block libraries: metadata shared by the Palette panel and the
// modeling canvas. The process library is driven by
// libraries/pml-catalog.json (the AnyLogic-derived single source of truth):
// every block carries its full port list (with conditional visibility) and
// the full AnyLogic property list. Presentation/statechart/action mirror
// AnyLogic's drawing and behavior elements (canvas annotations, not DSL).
import { BLOCK_CATALOG } from './blockCatalog';

export type LibraryId = 'process' | 'presentation' | 'statechart' | 'action';

export type PortDirection = 'in' | 'out' | 'inout';

export interface BlockPortDef {
  name: string;
  direction: PortDirection;
  conditionalOn: string | null;
  description: string;
}

export type CatalogFieldType =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'enum'
  | 'distribution'
  | 'ref'
  | 'expression';

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
export const BLOCK_DEFAULTS: Record<string, Record<string, string | number | boolean>> =
  Object.fromEntries(
    BLOCK_DEFS.map((def) => [
      def.kind,
      Object.fromEntries(
        def.properties
          .filter((property) => property.default !== null)
          .map((property) => [property.name, property.default as string | number | boolean]),
      ),
    ]),
  );

// Canvas card geometry (must match styles/model.css): the block card is a
// centered flex column (34px icon + 4px gap + 15px name line). Port dots are
// drawn on the icon's left/right midpoints. With multiple ports of the same
// direction they stack vertically around the midpoint (24px apart).
export const PORT_X = 17;
export const PORT_Y = -9.5;
const PORT_STACK_SPACING = 16;

export function portAnchor(
  node: { x: number; y: number; kind?: string },
  port: string,
): { x: number; y: number } {
  const ports = node.kind ? blockPorts(node.kind) : [];
  const spec = ports.find((entry) => entry.name === port);
  if (spec?.direction === 'in' || spec?.direction === 'inout') {
    const ins = ports.filter(
      (entry) => entry.direction === 'in' || entry.direction === 'inout',
    );
    const index = Math.max(0, ins.findIndex((entry) => entry.name === port));
    return { x: node.x - PORT_X, y: node.y + PORT_Y + (index - (ins.length - 1) / 2) * PORT_STACK_SPACING };
  }
  const outs = ports.filter(
    (entry) => entry.direction === 'out' || entry.direction === 'inout',
  );
  const index = Math.max(0, outs.findIndex((entry) => entry.name === port));
  return { x: node.x + PORT_X, y: node.y + PORT_Y + (index - (outs.length - 1) / 2) * PORT_STACK_SPACING };
}

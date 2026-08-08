// Palette block libraries: metadata shared by the Palette panel and the
// modeling canvas. The process library is driven by
// libraries/pml-catalog.json (the AnyLogic-derived single source of truth):
// every block carries its full port list (with conditional visibility) and
// the full AnyLogic property list. Presentation/statechart/action mirror
// AnyLogic's drawing and behavior elements (canvas annotations, not DSL).
import { BLOCK_CATALOG, EXECUTABLE_PROCESS_KINDS } from './blockCatalog';

export type LibraryId =
  'process' | 'presentation' | 'statechart' | 'action' | 'agent' | 'analysis' | 'controls';

/** Container kinds whose subgraph opens as its own canvas (drill-in), like
 *  AnyLogic agent canvases. `process` is the builtin flow container;
 *  agent/atomic/continuous are the DSL method containers. */
export const CANVAS_CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'process',
  'agent',
  'atomic',
  'continuous',
  'statechart',
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
  /** Process blocks with a kernel registry entry (generated from the
   *  embedded stdlib). Catalog-only kinds are hidden from the palette
   *  because the DSL compiler rejects them (LP2004). */
  executable?: boolean;
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
  { id: 'agent', name: 'agent' },
  { id: 'analysis', name: 'analysis' },
  { id: 'controls', name: 'controls' },
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
    executable: EXECUTABLE_PROCESS_KINDS.has(kind),
  };
}

/** Whether a process-library block kind has an executable kernel registry
 *  entry (and therefore compiles + runs through the generic flow engine). */
export function isExecutableProcessKind(kind: string): boolean {
  return EXECUTABLE_PROCESS_KINDS.has(kind);
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
  processDef('selectOutputIn', 'route to one of the associated exits'),
  processDef('selectOutputOut', 'an exit of a SelectOutputIn block'),
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
    ['frame', 'Frame'],
  ] as const
).map(([kind, name]) => ({
  kind,
  library: 'presentation',
  name,
  ports: [],
  properties: [],
}));

/** Common AnyLogic element properties shared by the non-flow libraries
 *  (agent / analysis / controls / statechart): every element carries the
 *  standard General block (Show name, Ignore, Visible). */
function commonProps(
  extra: BlockPropertyDef[] = [],
  section: 'basic' | 'advanced' | 'actions' = 'basic',
): BlockPropertyDef[] {
  const base: BlockPropertyDef[] = [
    {
      name: 'showName',
      displayName: 'Show name',
      type: 'bool',
      default: true,
      validValues: null,
      visibleWhen: null,
      section,
      required: false,
      runtimeSettable: true,
      description: 'If selected, the name is displayed on the diagram.',
    },
    {
      name: 'ignore',
      displayName: 'Ignore',
      type: 'bool',
      default: false,
      validValues: null,
      visibleWhen: null,
      section,
      required: false,
      runtimeSettable: false,
      description: 'If selected, the element is excluded from the model.',
    },
    {
      name: 'visible',
      displayName: 'Visible',
      type: 'bool',
      default: true,
      validValues: null,
      visibleWhen: null,
      section,
      required: false,
      runtimeSettable: true,
      description: 'If selected, the element is visible at runtime.',
    },
  ];
  return [...base, ...extra];
}

function actionProp(name: string, displayName: string): BlockPropertyDef {
  return {
    name,
    displayName,
    type: 'expression',
    default: '',
    validValues: null,
    visibleWhen: null,
    section: 'actions',
    required: false,
    runtimeSettable: false,
    description: 'Code executed when the element fires.',
  };
}

function enumProp(
  name: string,
  displayName: string,
  values: string[],
  defaultValue: string,
  visibleWhen: string | null = null,
): BlockPropertyDef {
  return {
    name,
    displayName,
    type: 'enum',
    default: defaultValue,
    validValues: values,
    visibleWhen,
    section: 'basic',
    required: false,
    runtimeSettable: true,
    description: '',
  };
}

function stringProp(
  name: string,
  displayName: string,
  defaultValue: string,
  section: 'basic' | 'actions' = 'basic',
): BlockPropertyDef {
  return {
    name,
    displayName,
    type: 'string',
    default: defaultValue,
    validValues: null,
    visibleWhen: null,
    section,
    required: false,
    runtimeSettable: true,
    description: '',
  };
}

// Agent library (AnyLogic Agent palette): parameters, variables, events,
// functions, collections, schedules, ports and statechart elements that
// live on the agent diagram. Properties follow AnyLogic Help
// (anylogic/data/*, anylogic/statecharts/*).
const AGENT_DEFS: BlockDef[] = [
  {
    kind: 'parameter',
    library: 'agent',
    name: 'Parameter',
    hint: 'static value',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['int', 'double', 'bool', 'string'], 'double'),
      stringProp('unit', 'Unit', ''),
      stringProp('defaultValue', 'Default value', '0'),
    ]),
  },
  {
    kind: 'event',
    library: 'agent',
    name: 'Event',
    hint: 'scheduled action',
    ports: [],
    properties: commonProps([
      enumProp('triggerType', 'Trigger type', ['timeout', 'rate', 'condition'], 'timeout'),
      enumProp(
        'mode',
        'Mode',
        ['user_control', 'occurs_once', 'cyclic'],
        'user_control',
        'triggerType == "timeout"',
      ),
      stringProp('timeout', 'Timeout', '1.0'),
      stringProp('rate', 'Rate', '1.0'),
      stringProp('condition', 'Condition', ''),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'dynamicEvent',
    library: 'agent',
    name: 'Dynamic Event',
    hint: 'self-deleting scheduled action',
    ports: [],
    properties: commonProps([
      stringProp('parameters', 'Parameters', ''),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'variable',
    library: 'agent',
    name: 'Variable',
    hint: 'mutable model state',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['int', 'double', 'bool', 'string'], 'double'),
      stringProp('initialValue', 'Initial value', '0'),
      {
        name: 'constant',
        displayName: 'Constant',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'advanced',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the variable cannot be modified at runtime.',
      },
    ]),
  },
  {
    kind: 'collection',
    library: 'agent',
    name: 'Collection',
    hint: 'grouped data items',
    ports: [],
    properties: commonProps([
      enumProp(
        'collectionClass',
        'Collection class',
        ['ArrayList', 'LinkedList', 'LinkedHashSet', 'TreeSet', 'TreeMap', 'LinkedHashMap'],
        'ArrayList',
      ),
      stringProp('elementsClass', 'Elements class', 'Object'),
      stringProp('keyElementsClass', 'Key elements class', ''),
      stringProp('valueElementsClass', 'Value elements class', ''),
      stringProp('initialContents', 'Initial contents', ''),
    ]),
  },
  {
    kind: 'function',
    library: 'agent',
    name: 'Function',
    hint: 'user-defined function',
    ports: [],
    properties: commonProps([
      {
        name: 'returnsValue',
        displayName: 'Returns value',
        type: 'bool',
        default: true,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the function returns the result of calculations.',
      },
      enumProp('type', 'Return type', ['bool', 'int', 'double', 'string'], 'double'),
      stringProp('arguments', 'Arguments', ''),
      actionProp('functionBody', 'Function body'),
    ]),
  },
  {
    kind: 'tableFunction',
    library: 'agent',
    name: 'Table Function',
    hint: 'tabular function with interpolation',
    ports: [],
    properties: commonProps([
      stringProp('xValues', 'X values', ''),
      stringProp('yValues', 'Y values', ''),
      enumProp('interpolation', 'Interpolation', ['linear', 'step'], 'linear'),
    ]),
  },
  {
    kind: 'customDistribution',
    library: 'agent',
    name: 'Custom Distribution',
    hint: 'empirical distribution',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['continuous', 'discrete'], 'continuous'),
      enumProp(
        'defineUsing',
        'Define using',
        ['frequency_table', 'observed_samples', 'ranges', 'options'],
        'frequency_table',
      ),
      stringProp('data', 'Data', ''),
    ]),
  },
  {
    kind: 'schedule',
    library: 'agent',
    name: 'Schedule',
    hint: 'time-dependent value pattern',
    ports: [],
    properties: commonProps([
      enumProp('valueType', 'Value type', ['on_off', 'int', 'real', 'rate'], 'real'),
      enumProp('mode', 'Mode', ['intervals', 'moments'], 'intervals'),
      stringProp('recurrenceTime', 'Recurrence time', '24'),
      stringProp('data', 'Data', ''),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'port',
    library: 'agent',
    name: 'Port',
    hint: 'typed agent communication port',
    ports: [{ name: 'out', direction: 'out', conditionalOn: null, description: '' }],
    properties: commonProps([stringProp('messageType', 'Message type', 'Object')]),
  },
  {
    kind: 'connector',
    library: 'agent',
    name: 'Connector',
    hint: 'connects two agent ports',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([stringProp('from', 'From', ''), stringProp('to', 'To', '')]),
  },
  {
    kind: 'linkToAgents',
    library: 'agent',
    name: 'Link to agents',
    hint: 'dynamic agent connections',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['undirected', 'directed'], 'undirected'),
      enumProp(
        'multiplicity',
        'Multiplicity',
        ['one_to_one', 'one_to_many', 'many_to_many'],
        'one_to_many',
      ),
      stringProp('targetAgentType', 'Target agent type', ''),
    ]),
  },
];

// Statechart library (AnyLogic Statechart palette). The container block
// `statechart` opens as its own canvas; states/transitions/pseudo-states
// live inside it. Properties follow anylogic/statecharts/*.
const STATECHART_DEFS: BlockDef[] = [
  {
    kind: 'statechart',
    library: 'statechart',
    name: 'Statechart',
    hint: 'state machine container',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([stringProp('description', 'Description', '')]),
  },
  {
    kind: 'statechartEntryPoint',
    library: 'statechart',
    name: 'Statechart Entry Point',
    hint: 'global initial state',
    ports: [{ name: 'out', direction: 'out', conditionalOn: null, description: '' }],
    properties: commonProps([
      stringProp('target', 'Target state', ''),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'initialStatePointer',
    library: 'statechart',
    name: 'Initial State Pointer',
    hint: 'initial state inside a composite',
    ports: [{ name: 'out', direction: 'out', conditionalOn: null, description: '' }],
    properties: commonProps([
      stringProp('target', 'Target state', ''),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'state',
    library: 'statechart',
    name: 'State',
    hint: 'location of control',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([
      actionProp('entryAction', 'Entry action'),
      actionProp('exitAction', 'Exit action'),
    ]),
  },
  {
    kind: 'transition',
    library: 'statechart',
    name: 'Transition',
    hint: 'switch between states',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([
      stringProp('from', 'From', ''),
      stringProp('to', 'To', ''),
      enumProp(
        'triggeredBy',
        'Triggered by',
        ['timeout', 'rate', 'condition', 'message'],
        'timeout',
      ),
      stringProp('timeout', 'Timeout', '1.0'),
      stringProp('rate', 'Rate', '1.0'),
      stringProp('condition', 'Condition', ''),
      stringProp('messageType', 'Message type', 'Object'),
      {
        name: 'guard',
        displayName: 'Guard',
        type: 'expression',
        default: '',
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: true,
        description:
          'Boolean expression evaluated after the trigger fires; the transition is taken only when it is true.',
      },
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'branch',
    library: 'statechart',
    name: 'Branch',
    hint: 'transition branching point',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([actionProp('action', 'Action')]),
  },
  {
    kind: 'finalState',
    library: 'statechart',
    name: 'Final State',
    hint: 'statechart termination point',
    ports: [{ name: 'in', direction: 'in', conditionalOn: null, description: '' }],
    properties: commonProps([actionProp('action', 'Action')]),
  },
  {
    kind: 'historyState',
    library: 'statechart',
    name: 'History State',
    hint: 'return to last visited state',
    ports: [
      { name: 'in', direction: 'in', conditionalOn: null, description: '' },
      { name: 'out', direction: 'out', conditionalOn: null, description: '' },
    ],
    properties: commonProps([
      enumProp('historyType', 'History type', ['shallow', 'deep'], 'shallow'),
      actionProp('action', 'Action'),
    ]),
  },
];

// Analysis library (AnyLogic Analysis palette): data collectors (data
// sets, statistics, histograms, outputs) and charts (bar/stack/pie/plot/
// time charts). Properties follow anylogic/analysis/*.
const ANALYSIS_DEFS: BlockDef[] = [
  {
    kind: 'dataSet',
    library: 'analysis',
    name: 'Data Set',
    hint: '2D (X,Y) data with min/max',
    ports: [],
    properties: commonProps([
      {
        name: 'useTimeAsX',
        displayName: 'Use time as horizontal axis value',
        type: 'bool',
        default: true,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the data set is timed.',
      },
      stringProp('horizontalAxisValue', 'Horizontal axis value', ''),
      stringProp('verticalAxisValue', 'Vertical axis value', ''),
      stringProp('tailSize', 'Tail size', '1000'),
      {
        name: 'updateAutomatically',
        displayName: 'Update data automatically',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'advanced',
        required: false,
        runtimeSettable: false,
        description: 'If selected, new samples are added automatically.',
      },
    ]),
  },
  {
    kind: 'statistics',
    library: 'analysis',
    name: 'Statistics',
    hint: 'mean/min/max of a sample series',
    ports: [],
    properties: commonProps([
      enumProp('kind', 'Data type', ['discrete', 'continuous'], 'continuous'),
      stringProp('value', 'Value', ''),
    ]),
  },
  {
    kind: 'histogramData',
    library: 'analysis',
    name: 'Histogram Data',
    hint: 'collects samples into intervals',
    ports: [],
    properties: commonProps([
      stringProp('value', 'Value', ''),
      stringProp('numberOfIntervals', 'Number of intervals', '20'),
    ]),
  },
  {
    kind: 'histogram2DData',
    library: 'analysis',
    name: 'Histogram2D Data',
    hint: '2D histogram sample collector',
    ports: [],
    properties: commonProps([
      stringProp('xValue', 'X value', ''),
      stringProp('yValue', 'Y value', ''),
      stringProp('xIntervals', 'X intervals', '20'),
      stringProp('yIntervals', 'Y intervals', '20'),
    ]),
  },
  {
    kind: 'output',
    library: 'analysis',
    name: 'Output',
    hint: 'single scalar result value',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['int', 'double', 'bool', 'string'], 'double'),
      stringProp('value', 'Value', ''),
      enumProp(
        'calculated',
        'Calculated',
        ['on_simulation_end', 'at_model_time', 'user_control'],
        'on_simulation_end',
      ),
    ]),
  },
  {
    kind: 'barChart',
    library: 'analysis',
    name: 'Bar Chart',
    hint: 'values as bars',
    ports: [],
    properties: commonProps([
      stringProp('title', 'Title', ''),
      stringProp('value', 'Value', ''),
      enumProp('barsDirection', 'Bars direction', ['horizontal', 'vertical'], 'vertical'),
      stringProp('barsRelativeWidth', 'Bars relative width', '0.8'),
    ]),
  },
  {
    kind: 'stackChart',
    library: 'analysis',
    name: 'Stack Chart',
    hint: 'stacked bars',
    ports: [],
    properties: commonProps([stringProp('title', 'Title', ''), stringProp('value', 'Value', '')]),
  },
  {
    kind: 'pieChart',
    library: 'analysis',
    name: 'Pie Chart',
    hint: 'values as pie slices',
    ports: [],
    properties: commonProps([stringProp('title', 'Title', ''), stringProp('value', 'Value', '')]),
  },
  {
    kind: 'plot',
    library: 'analysis',
    name: 'Plot',
    hint: 'X-Y scatter plot',
    ports: [],
    properties: commonProps([
      stringProp('title', 'Title', ''),
      stringProp('xValue', 'X value', ''),
      stringProp('yValue', 'Y value', ''),
      enumProp('pointStyle', 'Point style', ['none', 'circle', 'square', 'cross'], 'circle'),
      stringProp('lineWidth', 'Line width', '1'),
    ]),
  },
  {
    kind: 'timePlot',
    library: 'analysis',
    name: 'Time Plot',
    hint: 'value history over time',
    ports: [],
    properties: commonProps([
      stringProp('title', 'Title', ''),
      stringProp('value', 'Value', ''),
      enumProp('pointStyle', 'Point style', ['none', 'circle', 'square', 'cross'], 'none'),
      stringProp('lineWidth', 'Line width', '1'),
      enumProp('interpolation', 'Interpolation', ['linear', 'step'], 'linear'),
    ]),
  },
  {
    kind: 'timeStackChart',
    library: 'analysis',
    name: 'Time Stack Chart',
    hint: 'stacked areas over time',
    ports: [],
    properties: commonProps([stringProp('title', 'Title', ''), stringProp('value', 'Value', '')]),
  },
  {
    kind: 'timeColorChart',
    library: 'analysis',
    name: 'Time Color Chart',
    hint: 'color-coded value over time',
    ports: [],
    properties: commonProps([stringProp('title', 'Title', ''), stringProp('value', 'Value', '')]),
  },
  {
    kind: 'histogram',
    library: 'analysis',
    name: 'Histogram',
    hint: 'visualizes histogram data',
    ports: [],
    properties: commonProps([
      {
        name: 'showPdf',
        displayName: 'Show PDF',
        type: 'bool',
        default: true,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the PDF is shown on the histogram.',
      },
      {
        name: 'showCdf',
        displayName: 'Show CDF',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the CDF is shown on the histogram.',
      },
      {
        name: 'showMean',
        displayName: 'Show mean',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the mean value is shown with a line.',
      },
      stringProp('data', 'Data', ''),
    ]),
  },
  {
    kind: 'histogram2D',
    library: 'analysis',
    name: 'Histogram2D',
    hint: 'visualizes 2D histogram data',
    ports: [],
    properties: commonProps([stringProp('data', 'Data', '')]),
  },
];

// Controls library (AnyLogic Controls palette): interactive presentation
// widgets. Properties follow anylogic/controls/*.
const CONTROLS_DEFS: BlockDef[] = [
  {
    kind: 'button',
    library: 'controls',
    name: 'Button',
    hint: 'click to run an action',
    ports: [],
    properties: commonProps([
      stringProp('label', 'Label', 'Button'),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'checkBox',
    library: 'controls',
    name: 'Check Box',
    hint: 'boolean control',
    ports: [],
    properties: commonProps([
      stringProp('label', 'Label', 'Check Box'),
      stringProp('linkTo', 'Link to', ''),
      stringProp('defaultValue', 'Default value', 'false'),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'editBox',
    library: 'controls',
    name: 'Edit Box',
    hint: 'text input control',
    ports: [],
    properties: commonProps([
      stringProp('linkTo', 'Link to', ''),
      stringProp('minimumValue', 'Minimum value', ''),
      stringProp('maximumValue', 'Maximum value', ''),
      stringProp('defaultValue', 'Default value', ''),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'radioButtons',
    library: 'controls',
    name: 'Radio Buttons',
    hint: 'single-choice button group',
    ports: [],
    properties: commonProps([
      enumProp('orientation', 'Orientation', ['vertical', 'horizontal'], 'vertical'),
      stringProp('items', 'Radio buttons', ''),
      stringProp('linkTo', 'Link to', ''),
      stringProp('defaultValue', 'Default value', '0'),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'slider',
    library: 'controls',
    name: 'Slider',
    hint: 'numeric value in a range',
    ports: [],
    properties: commonProps([
      enumProp('orientation', 'Orientation', ['horizontal', 'vertical'], 'horizontal'),
      stringProp('linkTo', 'Link to', ''),
      stringProp('minimumValue', 'Minimum value', '0'),
      stringProp('maximumValue', 'Maximum value', '100'),
      stringProp('step', 'Step', '1'),
      stringProp('defaultValue', 'Default value', '50'),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'comboBox',
    library: 'controls',
    name: 'Combo Box',
    hint: 'drop-down list control',
    ports: [],
    properties: commonProps([
      stringProp('items', 'Items', ''),
      {
        name: 'editable',
        displayName: 'Editable',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the user can type new values.',
      },
      stringProp('linkTo', 'Link to', ''),
      stringProp('defaultValue', 'Default value', ''),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'listBox',
    library: 'controls',
    name: 'List Box',
    hint: 'multi-select list control',
    ports: [],
    properties: commonProps([
      {
        name: 'multipleSelection',
        displayName: 'Multiple selection',
        type: 'bool',
        default: false,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the user can select multiple items.',
      },
      stringProp('items', 'Items', ''),
      stringProp('linkTo', 'Link to', ''),
      stringProp('defaultValue', 'Default value', ''),
      stringProp('enabled', 'Enabled', 'true'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'fileChooser',
    library: 'controls',
    name: 'File Chooser',
    hint: 'upload/download file dialog',
    ports: [],
    properties: commonProps([
      enumProp('type', 'Type', ['upload', 'download'], 'upload'),
      stringProp('title', 'Title', 'Choose a file'),
      stringProp('fileNameFilters', 'File name filters', '.txt'),
      actionProp('action', 'Action'),
    ]),
  },
  {
    kind: 'progressBar',
    library: 'controls',
    name: 'Progress Bar',
    hint: 'visual task progress',
    ports: [],
    properties: commonProps([
      enumProp('orientation', 'Orientation', ['horizontal', 'vertical'], 'horizontal'),
      {
        name: 'showProgressString',
        displayName: 'Show progress string',
        type: 'bool',
        default: true,
        validValues: null,
        visibleWhen: null,
        section: 'basic',
        required: false,
        runtimeSettable: false,
        description: 'If selected, the label is shown inside the progress bar.',
      },
      stringProp('minimumValue', 'Minimum value', '0'),
      stringProp('maximumValue', 'Maximum value', '100'),
      stringProp('progressValue', 'Progress value', '0'),
      stringProp('determinate', 'Determinate', 'true'),
    ]),
  },
];

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
  // Catalog-only process kinds (restrictedArea*, pickup/dropoff, ...) have
  // no kernel registry entry yet; keeping them out of BLOCK_DEFS means the
  // palette, canvas insertion and recent list never offer a block whose DSL
  // cannot compile (LP2004).
  ...PROCESS_DEFS.filter((def) => def.executable !== false),
  ...PRESENTATION_DEFS,
  ...STATECHART_DEFS,
  ...ACTION_DEFS,
  ...AGENT_DEFS,
  ...ANALYSIS_DEFS,
  ...CONTROLS_DEFS,
];

/** Kinds that render as real drawing shapes instead of block cards. */
export const PRESENTATION_KINDS: ReadonlySet<string> = new Set(
  PRESENTATION_DEFS.map((def) => def.kind),
);

/** Statechart element kinds render as AnyLogic-style shapes (rounded
 *  state boxes, circles for initial/final/history, diamond branches)
 *  instead of generic block cards. */
export const STATECHART_KINDS: ReadonlySet<string> = new Set([
  'state',
  'finalState',
  'historyState',
  'branch',
  'statechartEntryPoint',
  'initialStatePointer',
  'transition',
]);

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
  selectOutputIn: { in: [9, 20] },
  selectOutputOut: { out: [31, 20] },
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

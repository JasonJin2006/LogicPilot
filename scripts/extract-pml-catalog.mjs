// Extract the AnyLogic Process Modeling Library block catalog from the
// official HTML help files into libraries/pml-catalog.json (the single
// source of truth for process block shapes: ports + properties).
//
// The AnyLogic docs are NOT a repo dependency: run this once on a machine
// with the docs folder, and commit the generated catalog. The build never
// reads the docs.
//
// Usage: node scripts/extract-pml-catalog.mjs [docsDir] [outFile]
//   docsDir  default: <repo>/../AnyLogic官方文档 (the desktop sibling)
//   outFile  default: <repo>/libraries/pml-catalog.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot =
  process.argv[2] ??
  resolve(repoRoot, '..', 'AnyLogic官方文档', 'library-reference-guides',
          'process-modeling-library');
const outFile =
  process.argv[3] ?? join(repoRoot, 'libraries', 'pml-catalog.json');

// The 23 process kinds shipped in the editor palette -> AnyLogic doc page.
const BLOCK_FILES = {
  resource: 'resourcepool.html',
  source: 'source.html',
  queue: 'queue.html',
  delay: 'delay.html',
  service: 'service.html',
  split: 'split.html',
  combine: 'combine.html',
  batch: 'batch.html',
  unbatch: 'unbatch.html',
  seize: 'seize.html',
  release: 'release.html',
  wait: 'wait.html',
  hold: 'hold.html',
  match: 'match.html',
  selectOutput: 'selectoutput.html',
  enter: 'enter.html',
  exit: 'exit.html',
  moveTo: 'moveto.html',
  timeMeasureStart: 'timemeasurestart.html',
  timeMeasureEnd: 'timemeasureend.html',
  assembler: 'assembler.html',
  count: 'count-agents.html',
  sink: 'sink.html',
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const ENTITIES = {
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#39;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&ndash;': '-',
  '&mdash;': '-',
};

function decodeEntities(text) {
  return text.replace(/&[a-zA-Z#0-9]+;/g, (match) => ENTITIES[match] ?? match);
}

/** Strip tags; block-level tags become newlines so "Name:/Type:" lines stay
 *  on their own lines. */
function htmlToLines(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|dd|dt|p|h\d|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n +/g, '\n')
      .replace(/ +\n/g, '\n')
      .replace(/\n{2,}/g, '\n'),
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Find the byte index of the first h2 whose visible text matches (exact,
 *  trimmed, case-insensitive). Section ids vary across pages ("properties",
 *  "parameters", ...), so we locate by heading text. */
function headingIndex(html, text) {
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const visible = decodeEntities(
      match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    );
    if (visible.toLowerCase() === text.toLowerCase()) {
      return match.index;
    }
  }
  return -1;
}

/** Byte range of a section: from its h2 to the next h2 among `stopTexts`
 *  (or the end of the document). */
function sectionRange(html, text, stopTexts) {
  const start = headingIndex(html, text);
  if (start < 0) {
    return { start: -1, end: -1 };
  }
  let end = html.length;
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (match.index <= start) {
      continue;
    }
    const visible = decodeEntities(
      match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    ).toLowerCase();
    if (stopTexts.some((stop) => stop.toLowerCase() === visible)) {
      end = match.index;
      break;
    }
  }
  return { start, end };
}

/** Extract `<dt>...</dt><dd>...</dd>` pairs of a `<dl class="params">`. */
function extractParamGroups(html) {
  const groups = [];
  const dlRe = /<dl class="params">([\s\S]*?)<\/dl>/gi;
  let dlMatch;
  while ((dlMatch = dlRe.exec(html)) !== null) {
    const dl = dlMatch[1];
    if (/data-success|feedback/i.test(dl)) {
      continue;  // the feedback form is a dl too; skip it
    }
    const itemRe = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
    let itemMatch;
    while ((itemMatch = itemRe.exec(dl)) !== null) {
      groups.push({ dt: itemMatch[1], dd: itemMatch[2] });
    }
  }
  return groups;
}

/** Extract `Name:`, `Type:`, `Default value:` and the `Valid values:` list
 *  from a `<dd>` content div (tag-stripped line parsing). */
function parseContent(ddHtml) {
  const out = { name: null, type: null, defaultValue: null, validValues: [] };
  const contentMatch = /<div class="content">([\s\S]*?)<\/div>/.exec(ddHtml);
  if (!contentMatch) {
    return out;
  }
  const lines = htmlToLines(contentMatch[1]);
  let inValidValues = false;
  for (const line of lines) {
    if (line.startsWith('Name:')) {
      out.name = line.slice('Name:'.length).trim();
    } else if (line.startsWith('Type:')) {
      out.type = line.slice('Type:'.length).trim();
    } else if (line.startsWith('Default value:')) {
      out.defaultValue = line.slice('Default value:'.length).trim();
    } else if (/^Valid values:/.test(line)) {
      inValidValues = true;
    } else if (inValidValues) {
      if (/^local variable/i.test(line)) {
        break;  // the rest is local-variable hints, not valid values
      }
      if (line) {
        out.validValues.push(line);
      }
    }
  }
  return out;
}

/** "Source.RATE - Rate" -> "rate" (canonical short enum token). */
function canonicalEnumValue(raw) {
  let value = raw.trim();
  // Drop the human label after an em/en dash (U+2014/U+2013) or ASCII dash.
  const dash = value.search(/[\u2014\u2013]| - /);
  if (dash >= 0) {
    value = value.slice(0, dash);
  }
  value = value.split('.').pop().trim();  // drop the qualified prefix
  return value.toLowerCase();
}

// ---------------------------------------------------------------------------
// Type mapping (AnyLogic Java types -> catalog types)
// ---------------------------------------------------------------------------

function mapType({ rawType, defaultValue, validValues }) {
  const t = (rawType ?? '').toLowerCase();
  if (validValues.length > 0) {
    return 'enum';
  }
  if (/\bint\b|long|integer/i.test(t)) {
    return 'int';
  }
  if (/double|float/i.test(t)) {
    // A `double` whose default is a distribution call is a distribution.
    if (/^(exponential|poisson|normal|constant|rate|triangular|uniform)\(/.test(
      defaultValue ?? '',
    )) {
      return 'distribution';
    }
    return 'float';
  }
  if (/boolean|bool/i.test(t)) {
    return 'bool';
  }
  if (/string/i.test(t)) {
    return 'string';
  }
  if (/distribution/i.test(t)) {
    return 'distribution';
  }
  if (/resourcepool|node|path|network|agent/i.test(t)) {
    return 'ref';
  }
  if (/tableinput|schedule|function|event|experiment|chart/i.test(t)) {
    return 'expression';
  }
  if (/queue\.|source\.|firstarrivalmode|locationtype/i.test(t)) {
    return 'enum';
  }
  return 'expression';
}

function parseDefault(type, rawDefault) {
  if (rawDefault == null) {
    return null;
  }
  const text = String(rawDefault).trim();
  switch (type) {
    case 'int': {
      const n = Number.parseInt(text, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'float': {
      const n = Number.parseFloat(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return /true/i.test(text);
    case 'enum':
      return text ? canonicalEnumValue(text) : null;
    case 'distribution': {
      const call = /^(exponential|poisson|normal|constant|rate)\([^)]*\)/.exec(
        text,
      );
      return call ? call[0] : null;
    }
    default:
      return text || null;
  }
}

// ---------------------------------------------------------------------------
// Port direction + conditional visibility
// ---------------------------------------------------------------------------

function portDirection(description) {
  const lower = description.toLowerCase();
  if (lower.includes('input')) {
    return 'in';
  }
  if (lower.includes('inout')) {
    return 'inout';
  }
  return 'out';
}

/** Manual conditions for conditional ports (keyed "block:port"); falls back
 *  to description inference. */
const PORT_CONDITIONS = {
  'queue:outTimeout': 'enableTimeout',
  'queue:outPreempted': 'enablePreemption',
  'service:outTimeout': 'enableTimeout',
  'service:outPreempted': 'enablePreemption',
  'seize:outTimeout': 'enableTimeout',
  'seize:outPreempted': 'enablePreemption',
  'wait:outTimeout': 'enableTimeout',
  'wait:outPreempted': 'enablePreemption',
  'match:outTimeout1': 'enableTimeout1',
  'match:outTimeout2': 'enableTimeout2',
  'match:outPreempted1': 'enablePreemption1',
  'match:outPreempted2': 'enablePreemption2',
};

function portCondition(blockKind, portName, description) {
  const manual = PORT_CONDITIONS[`${blockKind}:${portName}`];
  if (manual) {
    return manual;
  }
  const lower = description.toLowerCase();
  if (lower.includes('timeout')) {
    return 'enableTimeout';
  }
  if (lower.includes('preempt')) {
    return 'enablePreemption';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field-name canonicalization
// ---------------------------------------------------------------------------

function slugify(displayName) {
  return displayName
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1),
    )
    .join('');
}

/** dslName overrides: keep the established DSL field names for the five
 *  kernel blocks so existing examples/lowering keep working; everything else
 *  uses the AnyLogic "Name:" value as-is. */
const DSL_NAME_OVERRIDES = {
  resource: { failureRate: 'failure_rate' },
  service: { delayTime: 'time', resourcePool: 'resource' },
  seize: { resourcePool: 'resource' },
  source: { rate: 'arrival' },
};

function dslName(blockKind, docName, displayName) {
  const override = DSL_NAME_OVERRIDES[blockKind]?.[docName];
  if (override) {
    return override;
  }
  return docName || slugify(displayName);
}

/** Drop doc properties that collide with an override or are niche
 *  expression fields with no useful v1 semantics. */
const DROP_PROPERTIES = {
  seize: new Set(['resource', 'xYZ']),
  service: new Set(['resourceSets']),
};

/** Type overrides for properties whose doc page omits the "Type:" line
 *  (the editor and the generic executor key on these). */
const TYPE_OVERRIDES = {
  service: { resource: 'ref' },
  seize: { resource: 'ref' },
  source: { arrival: 'distribution' },
};

/** Default overrides for kernel-facing fields (the DSL abstraction maps
 *  AnyLogic's "Arrival rate" double onto a rate() distribution). */
const DEFAULT_OVERRIDES = {
  source: { arrival: 'rate(1)' },
};

/** Map AnyLogic property-section h3 ids to our panel sections. */
const SECTION_MAP = {
  advanced: 'advanced',
  'priorities-preemption': 'advanced',
  'priorities--preemption': 'advanced',
  animation: 'advanced',
  'maintenance-failures-shifts-breaks': 'advanced',
  actions: 'actions',
};

/** Normalize a "[Visible if ...]" marker to a machine-readable condition
 *  (`field == value`) using the block's extracted property names. Falls
 *  back to the raw text when the reference cannot be resolved. */
function normalizeVisibleWhen(raw, properties) {
  if (!raw) {
    return null;
  }
  const byDisplay = new Map();
  for (const property of properties) {
    byDisplay.set(property.displayName.toLowerCase(), property.name);
    byDisplay.set(property.name.toLowerCase(), property.name);
  }
  const byName = new Map(properties.map((property) => [property.name, property]));
  const text = raw.replace(/\s+/g, ' ').trim();
  // "the <X> option is selected" -> the field for X == true.
  const option = /^the (.+) option is selected$/i.exec(text);
  if (option) {
    const fieldName = byDisplay.get(option[1].trim().toLowerCase());
    if (fieldName) {
      return `${fieldName} == true`;
    }
  }
  const colon = text.indexOf(':');
  if (colon > 0) {
    const fieldText = text.slice(0, colon).trim();
    const valueText = text.slice(colon + 1).trim();
    const fieldName = byDisplay.get(fieldText.toLowerCase());
    if (fieldName) {
      const property = byName.get(fieldName);
      const labelEntry = property?._labels?.find(
        (entry) =>
          entry.label.toLowerCase() === valueText.toLowerCase() ||
          entry.token === valueText.toLowerCase(),
      );
      const value = labelEntry?.token ?? canonicalEnumValue(valueText);
      if (property?.type === 'bool' || /option is selected/i.test(valueText)) {
        return `${fieldName} == true`;
      }
      return `${fieldName} == ${JSON.stringify(value)}`;
    }
  }
  return text;
}

/** "Queue.QUEUING_FIFO - FIFO" -> the human label after the dash. */
function enumLabel(raw) {
  const value = raw.trim();
  const dash = value.search(/[\u2014\u2013]| - /);
  return dash >= 0 ? value.slice(dash + 1).trim() : '';
}

// ---------------------------------------------------------------------------
// Section split
// ---------------------------------------------------------------------------

function extractProperties(blockKind, html) {
  const { start, end } = sectionRange(html, 'Properties', [
    'Statistics',
    'Functions',
    'Ports',
  ]);
  if (start < 0) {
    return [];
  }
  const section = html.slice(start, end);

  // Split by h3 sub-sections to assign "advanced"/"actions".
  const subsections = [{ id: 'basic', html: section }];
  const h3Re = /<h3[^>]*id="([^"]+)"[^>]*>/gi;
  const h3s = [...section.matchAll(h3Re)].map((m) => ({
    id: m[1],
    index: m.index,
  }));
  if (h3s.length > 0) {
    subsections.length = 0;
    let cursor = 0;
    for (const h3 of h3s) {
      subsections.push({ id: 'basic', html: section.slice(cursor, h3.index) });
      const nextIndex = h3s.find((candidate) => candidate.index > h3.index)?.index ?? section.length;
      subsections.push({ id: h3.id, html: section.slice(h3.index, nextIndex) });
      cursor = nextIndex;
    }
  }

  const properties = [];
  for (const subsection of subsections) {
    for (const { dt, dd } of extractParamGroups(subsection.html)) {
      const displayName = decodeEntities(
        dt.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      );
      const ddLines = htmlToLines(dd);
      const content = parseContent(dd);

      // "[Visible if ...]" marker (first line of the dd).
      let visibleWhen = null;
      const visibleMatch = /^\[Visible if (.+)\]$/.exec(ddLines[0] ?? '');
      if (visibleMatch) {
        visibleWhen = visibleMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Description = dd lines that are not the marker/content boilerplate.
      const contentStart = ddLines.findIndex((line) => line === 'Name:' ||
        line.startsWith('Name:') || line === 'Type:' || line === 'Valid values:');
      const description = (contentStart > 0 ? ddLines.slice(1, contentStart) : ddLines.slice(1))
        .join(' ')
        .trim();

      let docName = content.name ?? slugify(displayName);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(docName)) {
        docName = slugify(displayName);
      }
      const name = dslName(blockKind, docName, displayName);
      const type =
        TYPE_OVERRIDES[blockKind]?.[name] ??
        mapType({
        rawType: content.type,
        defaultValue: content.defaultValue,
        validValues: content.validValues,
      });
      const validValues =
        type === 'enum'
          ? content.validValues
              .map(canonicalEnumValue)
              .filter(
                (value) =>
                  !/local variable|t agent|t unit|resourcepool pool|^\w+:/.test(
                    value,
                  ),
              )
          : null;
      const defaultValue =
        DEFAULT_OVERRIDES[blockKind]?.[name] ??
        parseDefault(type, content.defaultValue);
      const section = SECTION_MAP[subsection.id] ?? 'basic';
      if (DROP_PROPERTIES[blockKind]?.has(docName)) {
        continue;
      }
      if (properties.some((property) => property.name === name)) {
        continue;  // override collision: keep the first (kernel-facing) one
      }

      const property = {
        name,
        displayName,
        type,
        default: defaultValue,
        validValues,
        visibleWhen,
        section,
        required: false,
        runtimeSettable: true,
        description,
      };
      if (type === 'enum') {
        property._labels = content.validValues
          .filter((value) => !/^local variable/i.test(value))
          .map((value) => ({
            token: canonicalEnumValue(value),
            label: enumLabel(value),
          }));
      }
      properties.push(property);
    }
  }
  return properties;
}

function extractPorts(blockKind, html) {
  const { start, end } = sectionRange(html, 'Ports', []);
  if (start < 0) {
    return [];
  }
  const section = html.slice(start, end);
  const ports = [];
  for (const { dt, dd } of extractParamGroups(section)) {
    const name = decodeEntities(dt.replace(/<[^>]+>/g, '').trim());
    const description = htmlToLines(dd).join(' ').trim();
    ports.push({
      name,
      direction: portDirection(description),
      description,
      conditionalOn: portCondition(blockKind, name, description),
    });
  }
  return ports;
}

function extractSectionSummary(html, id, stopIds) {
  const { start, end } = sectionRange(html, id, stopIds);
  return start < 0 ? [] : htmlToLines(html.slice(start, end));
}

// ---------------------------------------------------------------------------
// Manual overrides for doc pages that lack a structured reference section
// ---------------------------------------------------------------------------

/** Full manual blocks: count's page is a how-to without Properties/Ports. */
const MANUAL_BLOCKS = {
  count: {
    friendlyName: 'Count',
    ports: [
      { name: 'in', direction: 'in', description: 'The input port.', conditionalOn: null },
      { name: 'out', direction: 'out', description: 'The output port.', conditionalOn: null },
    ],
    properties: [],
    actions: [],
    statistics: ['count: number of agents that passed through the block'],
    functions: [],
  },
  resource: {
    // ResourcePool has no ports (it is referenced, not connected).
    ports: [],
  },
  assembler: {
    ports: [
      { name: 'in', direction: 'in', description: 'The input port for the main agent.', conditionalOn: null },
      { name: 'p1', direction: 'in', description: 'The input port for the first part.', conditionalOn: null },
      { name: 'out', direction: 'out', description: 'The output port for the assembled agent.', conditionalOn: null },
    ],
  },
};

function applyManual(block) {
  const manual = MANUAL_BLOCKS[block.kind];
  if (!manual) {
    return block;
  }
  return {
    ...block,
    ...manual,
    ports: manual.ports ?? block.ports,
    properties: manual.properties ?? block.properties,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const blocks = [];
const warnings = [];

for (const [kind, file] of Object.entries(BLOCK_FILES)) {
  const path = join(docsRoot, file);
  let html;
  try {
    html = readFileSync(path, 'utf8');
  } catch (error) {
    warnings.push(`missing doc page for '${kind}' (${file}): ${error.message}`);
    continue;
  }
  const properties = extractProperties(kind, html);
  const ports = extractPorts(kind, html);
  const hasManual = MANUAL_BLOCKS[kind] !== undefined;
  if (properties.length === 0 && !hasManual) {
    warnings.push(`no properties extracted for '${kind}'`);
  }
  if (ports.length === 0 && !hasManual) {
    warnings.push(`no ports extracted for '${kind}'`);
  }
  const firstHeading = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
  blocks.push(
    applyManual({
      kind,
      friendlyName: firstHeading ? decodeEntities(firstHeading[1]).trim() : kind,
      ports,
      properties,
      actions: extractSectionSummary(html, 'Actions', ['Functions', 'Ports', 'Statistics']),
      statistics: extractSectionSummary(html, 'Statistics', ['Functions', 'Ports']),
      functions: extractSectionSummary(html, 'Functions', ['Ports', 'Statistics']),
    }),
  );
}

// Self-validation: every visibleWhen / conditionalOn reference must resolve
// to a property in the same block; enum fields need validValues; defaults
// must match their type.
const schemaErrors = [];
  for (const block of blocks) {
    const propNames = new Set(block.properties.map((property) => property.name));
    for (const property of block.properties) {
      property.visibleWhen = normalizeVisibleWhen(
        property.visibleWhen,
        block.properties,
      );
    }
    for (const property of block.properties) {
      delete property._labels;
    }
    for (const port of block.ports) {
    if (port.conditionalOn && !propNames.has(port.conditionalOn)) {
      schemaErrors.push(
        `${block.kind}.${port.name}: conditionalOn '${port.conditionalOn}' ` +
          `does not match any property`,
      );
    }
  }
  for (const property of block.properties) {
    if (property.type === 'enum' && !property.validValues?.length) {
      schemaErrors.push(
        `${block.kind}.${property.name}: enum without valid values`,
      );
    }
    if (property.default !== null) {
      const bad =
        (property.type === 'int' && !Number.isInteger(property.default)) ||
        (property.type === 'float' &&
          typeof property.default !== 'number') ||
        (property.type === 'bool' &&
          typeof property.default !== 'boolean');
      if (bad) {
        schemaErrors.push(
          `${block.kind}.${property.name}: default '${property.default}' ` +
            `does not match type ${property.type}`,
        );
      }
    }
  }
}

const catalog = {
  schemaVersion: 1,
  library: 'process',
  generatedFrom: 'AnyLogic Help local HTML (process-modeling-library)',
  blocks,
};

writeFileSync(outFile, `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`wrote ${outFile}`);
console.log(`blocks: ${blocks.length}`);
console.log(
  `properties: ${blocks.reduce((sum, block) => sum + block.properties.length, 0)}`,
);
console.log(`ports: ${blocks.reduce((sum, block) => sum + block.ports.length, 0)}`);
if (schemaErrors.length > 0) {
  console.error('\nschema errors:');
  for (const error of schemaErrors) {
    console.error(`  - ${error}`);
  }
  process.exitCode = 1;
}
if (warnings.length > 0) {
  console.error('\nwarnings:');
  for (const warning of warnings) {
    console.error(`  - ${warning}`);
  }
}

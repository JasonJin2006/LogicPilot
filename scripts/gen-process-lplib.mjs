// Generate libraries/process.lplib from libraries/pml-catalog.json (the
// single source of truth for the process library block shapes).
//
// Usage: node scripts/gen-process-lplib.mjs
// Then regenerate the embedded compiler header:
//   node scripts/gen-stdlib-header.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(
  readFileSync(join(repoRoot, 'libraries', 'pml-catalog.json'), 'utf8'),
);

// Kernel-extension fields not present in AnyLogic docs but required by the
// current DSL/lowering (failure/repair laws on the resource pool).
const KERNEL_EXTENSION_FIELDS = {
  resource: [
    { name: 'failure_rate', type: 'float', default: 0.0 },
    { name: 'repair_rate', type: 'float', default: 1.0 },
  ],
};

const TYPE_DEFAULTS = {
  int: 0,
  float: 0.0,
  bool: false,
  string: '',
  enum: '',
  expression: '',
  ref: '',
  distribution: 'exponential(1)',
};

function formatDefault(type, value) {
  if (value !== null && value !== undefined) {
    if (type === 'bool') {
      return value ? 'true' : 'false';
    }
    if (type === 'int' || type === 'float') {
      return String(value);
    }
    if (type === 'distribution') {
      return String(value);  // a distribution call, e.g. rate(1)
    }
    return JSON.stringify(String(value));  // string/enum/expression/ref
  }
  if (type === 'distribution') {
    return 'exponential(1)';
  }
  return formatDefault(type, TYPE_DEFAULTS[type]);
}

function lplibType(catalogType) {
  if (catalogType === 'enum') {
    return 'string';  // valid values live in the catalog (editor authority)
  }
  return catalogType;
}

const lines = [
  '// Generated from libraries/pml-catalog.json by',
  '// scripts/gen-process-lplib.mjs - DO NOT EDIT BY HAND.',
  '// Regenerate after editing the catalog:',
  '//   node scripts/gen-process-lplib.mjs',
  '//   node scripts/gen-stdlib-header.mjs',
  'library process {',
  '  version = 1',
];

for (const block of catalog.blocks) {
  lines.push('');
  lines.push(`  // ${block.friendlyName} (${block.ports.length} port(s), ` +
             `${block.properties.length} properties)`);
  lines.push(`  block ${block.kind} {`);
  for (const port of block.ports) {
    const condition = port.conditionalOn ? ` when ${port.conditionalOn}` : '';
    lines.push(`    ${port.direction} ${port.name}: entity${condition}`);
  }
  if (block.ports.length > 0) {
    lines.push('');
  }
  for (const property of block.properties) {
    const type = lplibType(property.type);
    const value = formatDefault(property.type, property.default);
    lines.push(`    ${property.name}: ${type} = ${value}`);
  }
  for (const extension of KERNEL_EXTENSION_FIELDS[block.kind] ?? []) {
    lines.push(`    ${extension.name}: ${extension.type} = ` +
               `${formatDefault(extension.type, extension.default)}`);
  }
  lines.push('  }');
}
lines.push('}');
lines.push('');

const outPath = join(repoRoot, 'libraries', 'process.lplib');
writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`wrote ${outPath} (${catalog.blocks.length} blocks)`);

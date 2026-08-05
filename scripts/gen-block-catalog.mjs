// Generate web/apps/ide/src/model/blockCatalog.ts from
// libraries/pml-catalog.json (the single source of truth). The IDE imports
// this local module instead of the JSON so the Vite dev server never serves
// files outside the web root.
//
// Usage: node scripts/gen-block-catalog.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(
  readFileSync(join(repoRoot, 'libraries', 'pml-catalog.json'), 'utf8'),
);

const lines = [
  '// Generated from libraries/pml-catalog.json by',
  '// scripts/gen-block-catalog.mjs - DO NOT EDIT BY HAND.',
  '// Regenerate after editing the catalog:',
  '//   node scripts/gen-block-catalog.mjs',
  'import type { BlockPortDef, BlockPropertyDef } from \'./blockDefs\';',
  '',
  'export interface CatalogBlock {',
  '  kind: string;',
  '  friendlyName: string;',
  '  ports: BlockPortDef[];',
  '  properties: BlockPropertyDef[];',
  '}',
  '',
  'export const BLOCK_CATALOG: CatalogBlock[] = [',
];

for (const block of catalog.blocks) {
  lines.push('  {');
  lines.push(`    kind: ${JSON.stringify(block.kind)},`);
  lines.push(`    friendlyName: ${JSON.stringify(block.friendlyName)},`);
  lines.push('    ports: [');
  for (const port of block.ports) {
    lines.push('      {');
    lines.push(`        name: ${JSON.stringify(port.name)},`);
    lines.push(`        direction: ${JSON.stringify(port.direction)},`);
    lines.push(
      `        conditionalOn: ${JSON.stringify(port.conditionalOn)},`,
    );
    lines.push(`        description: ${JSON.stringify(port.description)},`);
    lines.push('      },');
  }
  lines.push('    ],');
  lines.push('    properties: [');
  for (const property of block.properties) {
    lines.push('      {');
    lines.push(`        name: ${JSON.stringify(property.name)},`);
    lines.push(`        displayName: ${JSON.stringify(property.displayName)},`);
    lines.push(`        type: ${JSON.stringify(property.type)},`);
    lines.push(`        default: ${JSON.stringify(property.default)},`);
    lines.push(`        validValues: ${JSON.stringify(property.validValues)},`);
    lines.push(`        visibleWhen: ${JSON.stringify(property.visibleWhen)},`);
    lines.push(`        section: ${JSON.stringify(property.section)},`);
    lines.push(`        required: ${JSON.stringify(property.required)},`);
    lines.push(
      `        runtimeSettable: ${JSON.stringify(property.runtimeSettable)},`,
    );
    lines.push(`        description: ${JSON.stringify(property.description)},`);
    lines.push('      },');
  }
  lines.push('    ],');
  lines.push('  },');
}
lines.push('];');
lines.push('');

const outPath = join(
  repoRoot,
  'web',
  'apps',
  'ide',
  'src',
  'model',
  'blockCatalog.ts',
);
writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(`wrote ${outPath} (${catalog.blocks.length} blocks)`);

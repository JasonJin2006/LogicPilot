#!/usr/bin/env node
// Phase 1 schema-compatibility gate (docs/architecture/next-generation-plugin-platform.md §16).
//
// schemas/contracts/*.schema.json is frozen against schemas/contracts/baseline/.
// Breaking changes are:
//   - a definition removed (or renamed),
//   - a property removed from an object definition,
//   - a new property added to the required list,
//   - a property type / ref / const / enum set changed (enum narrowing AND
//     widening both count: readers switch exhaustively),
//   - array element or map value type changed.
// Additive optional properties are allowed.
//
// The script also audits the "strict object" policy: every object definition
// must set additionalProperties:false so unknown fields are rejected, and every
// schema file must pin the draft 2020-12 meta-schema and an $id.
//
// Updating the freeze is an explicit, reviewed act: copy the new schemas over
// schemas/contracts/baseline/ in the same commit that changes the contract.
//
// Usage: node scripts/check-contract-conform.mjs   (exit 0 = conformant)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const currentDir = join(root, 'schemas', 'contracts');
const baselineDir = join(root, 'schemas', 'contracts', 'baseline');

const problems = [];

const files = readdirSync(currentDir)
  .filter((f) => f.endsWith('.schema.json'))
  .sort();
if (files.length === 0) throw new Error('no contract schemas found');

function loadDefIndex(dir) {
  const index = new Map(); // defName -> { file, def }
  for (const file of files) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const schema = JSON.parse(readFileSync(path, 'utf8'));
    for (const [name, def] of Object.entries(schema.$defs ?? {})) {
      index.set(name, { file, def });
    }
  }
  return index;
}

/** Normalized structural signature of a property schema, for equality checks. */
function signature(schema) {
  if (schema.$ref) return { kind: 'ref', target: schema.$ref };
  if (schema['x-freeform-json']) return { kind: 'freeform' };
  if (schema.const !== undefined) return { kind: 'const', value: schema.const };
  if (schema.enum) return { kind: 'enum', values: [...schema.enum].sort() };
  switch (schema.type) {
    case 'string':
      return { kind: 'string' };
    case 'integer':
      return { kind: 'integer' };
    case 'number':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return { kind: 'array', items: signature(schema.items) };
    case 'object':
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return { kind: 'map', value: signature(schema.additionalProperties) };
      }
      return { kind: 'inline-object' };
    default:
      return { kind: `unknown:${JSON.stringify(schema)}` };
  }
}

function sameSignature(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- 1. audit policy ---------------------------------------------------------

for (const file of files) {
  const schema = JSON.parse(readFileSync(join(currentDir, file), 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    problems.push(`${file}: $schema must pin draft 2020-12`);
  }
  if (typeof schema.$id !== 'string' || schema.$id.length === 0) {
    problems.push(`${file}: missing $id`);
  }
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    if (def['x-freeform-json']) continue; // opaque payloads are intentionally free-form
    if (def.type === 'object' && def.additionalProperties !== false) {
      problems.push(
        `${file}#/${name}: object definitions must set additionalProperties:false (strict unknown-field rejection)`,
      );
    }
  }
}

// --- 2. baseline compatibility ----------------------------------------------

const currentDefs = loadDefIndex(currentDir);
const baselineDefs = loadDefIndex(baselineDir);

for (const [name, entry] of baselineDefs) {
  if (!currentDefs.has(name)) {
    problems.push(
      `breaking: definition ${name} (${entry.file}) was removed from the current schemas`,
    );
    continue;
  }
  const current = currentDefs.get(name).def;
  const baseline = entry.def;
  if (baseline.type !== 'object' || current.type !== 'object') {
    if (JSON.stringify(baseline) !== JSON.stringify(current)) {
      problems.push(`breaking: non-object definition ${name} (${entry.file}) changed`);
    }
    continue;
  }

  const baselineRequired = new Set(baseline.required ?? []);
  const currentRequired = new Set(current.required ?? []);
  for (const prop of currentRequired) {
    if (!baselineRequired.has(prop)) {
      problems.push(`breaking: ${name}.${prop} (${entry.file}) became required`);
    }
  }

  for (const [prop, baselineProp] of Object.entries(baseline.properties ?? {})) {
    const currentProp = current.properties?.[prop];
    if (!currentProp) {
      problems.push(`breaking: ${name}.${prop} (${entry.file}) was removed`);
      continue;
    }
    if (!sameSignature(signature(baselineProp), signature(currentProp))) {
      problems.push(`breaking: ${name}.${prop} (${entry.file}) changed type`);
    }
  }
}

// --- report ------------------------------------------------------------------

if (problems.length > 0) {
  console.error(`[contract-conform] ${problems.length} violation(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('[contract-conform] to update the freeze, copy the changed schemas over');
  console.error('[contract-conform] schemas/contracts/baseline/ in the same commit.');
  process.exit(1);
}
console.log(
  `[contract-conform] OK: ${files.length} schemas, ${currentDefs.size} definitions conform to baseline`,
);

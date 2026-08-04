// ModelDocument -> DSL v2 source generation.
//
// The generated syntax follows docs/specs/dsl-v2.md (thin core grammar +
// process library blocks): `resource` blocks at model level, process stages
// inside one `process` container ordered by canvas x position (the DSL
// connects sequential stages by declaration order). Block field values are
// serialized from the node params.

import type { BlockKind, ModelDocument, ModelNode } from './graph.js';

/** Blocks that live inside the single process container. */
const PROCESS_BLOCKS: ReadonlySet<BlockKind> = new Set(['source', 'queue', 'service', 'sink']);

function paramValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  // Bare identifiers (resource references) and distribution calls pass
  // through; anything else is a string literal.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    return value;
  }
  if (/^(rate|interarrival|exponential|normal|constant)\(.*\)$/.test(value.trim())) {
    return value.trim();
  }
  return JSON.stringify(value);
}

function renderBlock(node: ModelNode, indent: string): string {
  const params = Object.entries(node.params);
  if (params.length === 0) {
    return `${indent}${node.kind} ${node.name} { }`;
  }
  const body = params.map(([key, value]) => `${indent}  ${key} = ${paramValue(value)}`).join('\n');
  return `${indent}${node.kind} ${node.name} {\n${body}\n${indent}}`;
}

/** Generate DSL v2 source for the document. Stage ordering inside the
 *  process container follows canvas x position (left to right). */
export function generateDsl(document: ModelDocument): string {
  const modelName = document.name || 'Model';
  const resources = document.nodes.filter((node) => node.kind === 'resource');
  const stages = document.nodes
    .filter((node) => PROCESS_BLOCKS.has(node.kind))
    .sort((a, b) => a.x - b.x);

  const lines: string[] = [];
  lines.push(`model ${modelName} {`);
  for (const resource of resources) {
    lines.push(renderBlock(resource, '  '));
  }
  if (stages.length > 0) {
    lines.push('  process Flow {');
    for (const stage of stages) {
      lines.push(renderBlock(stage, '    '));
    }
    lines.push('  }');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

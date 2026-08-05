// ModelDocument -> DSL v2 source generation.
//
// The generated syntax follows docs/specs/dsl-v2.md (thin core grammar +
// process library blocks): `resource` blocks at model level, process stages
// inside one `process` container ordered by canvas x position (the DSL
// connects sequential stages by declaration order). Block field values are
// serialized from the node params.

import type { ModelDocument, ModelEdge, ModelNode } from './graph.js';

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
  if (/^(rate|interarrival|poisson|exponential|normal|constant)\(.*\)$/.test(value.trim())) {
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

// Order process stages by coupling edges (topological flow order, stable by
// canvas x within each rank); disconnected stages fall back to x position.
function orderStages(
  stages: ModelNode[],
  edges: ModelEdge[],
  document: ModelDocument,
): ModelNode[] {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const incoming = new Map(stages.map((stage) => [stage.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge.to);
    outgoing.set(edge.from, next);
  }
  const remaining = new Set(stages.map((stage) => stage.id));
  const byX = (a: ModelNode, b: ModelNode) => a.x - b.x;
  const ready = stages.filter((stage) => (incoming.get(stage.id) ?? 0) === 0).sort(byX);
  const ordered: ModelNode[] = [];
  while (ready.length > 0) {
    const stage = ready.shift()!;
    ordered.push(stage);
    remaining.delete(stage.id);
    for (const id of outgoing.get(stage.id) ?? []) {
      if (!remaining.has(id)) continue;
      const count = (incoming.get(id) ?? 1) - 1;
      incoming.set(id, count);
      if (count === 0) ready.push(byId.get(id)!);
    }
    ready.sort(byX);
  }
  const leftovers = stages.filter((stage) => remaining.has(stage.id)).sort(byX);
  return [...ordered, ...leftovers];
}

/** Generate DSL v2 source for the document. Stage ordering inside the
 *  process container follows the coupling edges when present (topological
 *  flow order), falling back to canvas x position (left to right). */
export function generateDsl(document: ModelDocument): string {
  const modelName = document.name || 'Model';
  const resources = document.nodes.filter((node) => node.kind === 'resource');
  // Process-flow stages only. Drawing and behavior elements
  // (presentation/statechart/action libraries) are canvas annotations and do
  // not emit. Custom-library kinds (library 'process') emit too: the
  // compiler reports them as unknown (LP2004) until the matching library is
  // registered in the kernel. Container Nodes (kind 'process') emit as
  // `process <name> { ... }` wrappers around their stages.
  const stages = document.nodes.filter(
    (node) =>
      node.kind !== 'resource' &&
      node.kind !== 'process' &&
      (node.library === undefined || node.library === 'process'),
  );
  const containers = document.nodes.filter((node) => node.kind === 'process');

  const lines: string[] = [];
  lines.push(`model ${modelName} {`);
  for (const resource of resources) {
    lines.push(renderBlock(resource, '  '));
  }
  // Group stages by their container block (node.container, defaulting to the
  // legacy single 'Flow' container) so multiple process containers round-trip
  // through the DSL.
  const byContainer = new Map<string, ModelNode[]>();
  for (const stage of stages) {
    const key = stage.container ?? 'Flow';
    const group = byContainer.get(key);
    if (group) {
      group.push(stage);
    } else {
      byContainer.set(key, [stage]);
    }
  }
  const emitContainer = (containerName: string) => {
    lines.push(`  process ${containerName} {`);
    const group = byContainer.get(containerName);
    if (group) {
      for (const stage of orderStages(group, document.edges, document)) {
        lines.push(renderBlock(stage, '    '));
      }
    }
    lines.push('  }');
  };
  // Container Nodes first, in document order (empty containers emit too);
  // then any orphan stage groups (legacy data without a container Node).
  const emitted = new Set<string>();
  for (const container of containers) {
    emitContainer(container.name);
    emitted.add(container.name);
  }
  for (const containerName of [...byContainer.keys()].filter((name) => !emitted.has(name)).sort()) {
    emitContainer(containerName);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

// ModelDocument -> DSL v2 source generation.
//
// The generated syntax follows docs/specs/dsl-v2.md (thin core grammar +
// process library blocks). Every node is emitted - use/param members,
// field/effect lines, behavior blocks, nested containers and placeholder
// kinds - so generate(parse(x)) is semantically lossless. Stage ordering
// follows the coupling edges when present (topological flow order), falling
// back to canvas x position.

import { findNode, type ModelDocument, type ModelEdge, type ModelNode } from './graph.js';

/** Container kinds emit as nested `kind name { ... }` blocks. */
const CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'agent',
  'atomic',
  'continuous',
  'experiment',
]);

/** Serialize a field/param value. Parser-produced values are already
 *  verbatim (numbers as numbers, quoted strings, calls, expressions), while
 *  hand-built params follow the old rules: bare identifiers and distribution
 *  calls pass through, anything else is a quoted string literal. */
function fieldValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const text = value.trim();
  if (text.startsWith('"') || /^[0-9]/.test(text) || /^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/.test(text)) {
    return text;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    return text;
  }
  // Expression-like values (comparisons, arithmetic, calls, ranges, dotted
  // identifiers) pass through unquoted so `condition = t < 3` survives the
  // round trip as an expression instead of a string literal. Plain
  // multi-word text without operators is a string and gets quoted.
  if (/[<>=*/+(),.-]/.test(text)) {
    return text;
  }
  return JSON.stringify(value);
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

/** Generate DSL v2 source for the document. */
export function generateDsl(document: ModelDocument): string {
  const modelName = document.name || 'Model';
  const lines: string[] = [];
  lines.push(`model ${modelName} {`);

  // Drawing/behavior annotations (presentation/action libraries) are
  // canvas-only and never emit; process and statechart members do.
  const emitCandidate = (node: ModelNode): boolean =>
    node.library === undefined || node.library === 'process' || node.library === 'statechart';
  const childrenOf = (name: string, excludeId?: string): ModelNode[] =>
    document.nodes.filter(
      (node) => node.container === name && node.id !== excludeId && emitCandidate(node),
    );

  // Explicit couplings for a container's subgraph: every edge whose
  // endpoints live in the container. When the topology is non-trivial
  // (multi-output blocks, conditional ports, branches) the compiler needs
  // the explicit `couple` lines; emitting them for every edge keeps the
  // canvas graph identical to the compiled IR.
  const emitCouplings = (container: string | undefined, indent: string) => {
    const members = new Set(
      document.nodes
        .filter((node) => node.container === container && emitCandidate(node))
        .map((node) => node.name),
    );
    for (const edge of document.edges) {
      const from = findNode(document, edge.from);
      const to = findNode(document, edge.to);
      if (!from || !to || from.container !== container || to.container !== container) {
        continue;
      }
      if (!members.has(from.name) || !members.has(to.name)) {
        continue;
      }
      lines.push(
        `${indent}couple ${from.name}.${edge.fromPort ?? 'out'} -> ` +
          `${to.name}.${edge.toPort ?? 'in'}`,
      );
    }
  };

  const emitNode = (node: ModelNode, indent: string) => {
    if (node.kind === 'use') {
      lines.push(`${indent}use ${node.name}`);
      return;
    }
    if (node.kind === 'param') {
      const { type, value } = node.params;
      lines.push(
        `${indent}param ${node.name}${type ? `: ${type}` : ''} = ${fieldValue(value ?? '')}`,
      );
      return;
    }
    if (node.kind === 'field') {
      lines.push(`${indent}${node.name} = ${fieldValue(node.params['value'] ?? '')}`);
      return;
    }
    if (node.kind === 'effect') {
      lines.push(`${indent}${node.name}`);
      return;
    }
    if (node.kind.startsWith('on_')) {
      const port = typeof node.params['port'] === 'string' ? node.params['port'] : undefined;
      lines.push(`${indent}${node.kind}${port ? ` ${port}` : ''} {`);
      for (const child of childrenOf(node.name, node.id)) {
        emitNode(child, `${indent}  `);
      }
      lines.push(`${indent}}`);
      return;
    }
    const children = childrenOf(node.name, node.id);
    if (node.kind === 'statechart') {
      // The statechart's initial state comes from the entry point's Target
      // property, falling back to an edge leaving the entry point (or
      // initial state pointer) inside the container.
      const pointers = document.nodes.filter(
        (entry) =>
          (entry.kind === 'statechartEntryPoint' || entry.kind === 'initialStatePointer') &&
          entry.container === node.name,
      );
      const targetName = String(
        pointers.find((entry) => typeof entry.params['target'] === 'string')?.params['target'] ??
          '',
      );
      const initial =
        (targetName !== '' ? children.find((child) => child.name === targetName) : undefined) ??
        document.edges
          .map((edge) => {
            const from = findNode(document, edge.from);
            const to = findNode(document, edge.to);
            if (!from || !to || from.container !== node.name) return null;
            if (from.kind !== 'statechartEntryPoint' && from.kind !== 'initialStatePointer') {
              return null;
            }
            return to;
          })
          .find((to): to is ModelNode => to !== null);
      lines.push(`${indent}statechart ${node.name} {`);
      for (const [key, value] of Object.entries(node.params)) {
        lines.push(`${indent}  ${key} = ${fieldValue(value)}`);
      }
      if (initial !== undefined) {
        lines.push(`${indent}  initial = ${initial.name}`);
      }
      for (const child of children) {
        emitNode(child, `${indent}  `);
      }
      lines.push(`${indent}}`);
      return;
    }
    const params = Object.entries(node.params);
    if (params.length === 0 && children.length === 0) {
      lines.push(`${indent}${node.kind} ${node.name} { }`);
      return;
    }
    lines.push(`${indent}${node.kind} ${node.name} {`);
    for (const [key, value] of params) {
      lines.push(`${indent}  ${key} = ${fieldValue(value)}`);
    }
    for (const child of children) {
      emitNode(child, `${indent}  `);
    }
    if (CONTAINER_KINDS.has(node.kind)) {
      emitCouplings(node.name, `${indent}  `);
    }
    lines.push(`${indent}}`);
  };

  const isDeclarationLeaf = (node: ModelNode): boolean =>
    node.kind !== 'use' &&
    node.kind !== 'param' &&
    node.kind !== 'resource' &&
    node.kind !== 'field' &&
    node.kind !== 'effect' &&
    !node.kind.startsWith('on_') &&
    !CONTAINER_KINDS.has(node.kind);

  const topLevel = document.nodes.filter((node) => !node.container && emitCandidate(node));
  // Agent-centric emission: process-library blocks at the model root are
  // emitted directly (no `process Flow` wrapper) with their model-level
  // couplings.
  const orphanLeaves = topLevel.filter(isDeclarationLeaf);
  const direct = topLevel.filter((node) => !isDeclarationLeaf(node));
  for (const node of direct) {
    emitNode(node, '  ');
  }
  if (orphanLeaves.length > 0) {
    for (const stage of orderStages(orphanLeaves, document.edges, document)) {
      emitNode(stage, '  ');
    }
    emitCouplings(undefined, '  ');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

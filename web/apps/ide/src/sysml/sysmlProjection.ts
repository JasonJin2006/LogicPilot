// Best-effort SysML v2 projection for external models.
//
// Professional SysML tools remain the source of truth for the language. The
// projection extracts the stable, visual subset needed by the Workbench:
// declarations with precise source spans, containment and the most common
// structural/traceability/behavior relations. The statement-level scanner
// lives in ./sysmlParser (stable SYxxxx diagnostics); this layer resolves
// references, dedupes relations and derives the layout sidecar.

import {
  elementIdFor,
  fnv1aHex,
  parseSysMLSource,
} from './sysmlParser';

export type SysMLVisualKind =
  | 'package'
  | 'part'
  | 'item'
  | 'port'
  | 'interface'
  | 'requirement'
  | 'action'
  | 'state'
  | 'analysis'
  | 'verification'
  | 'attribute'
  | 'constraint'
  | 'usecase'
  | 'view'
  | 'viewpoint'
  | 'enum'
  | 'occurrence'
  | 'stakeholder'
  | 'flow'
  | 'unknown';

export type SysMLRelationKind =
  | 'contains'
  | 'typed_by'
  | 'specializes'
  | 'connects'
  | 'flows'
  | 'satisfies'
  | 'verifies'
  | 'traces'
  | 'transitions'
  | 'allocates'
  | 'derives'
  | 'refines'
  | 'redefines'
  | 'subsets'
  | 'exposes'
  | 'binds'
  | 'includes'
  | 'depends_on';

export interface SysMLSourceSpan {
  start: number;
  end: number;
  line: number;
}

export interface SysMLElement {
  id: string;
  kind: SysMLVisualKind;
  name: string;
  qualifiedName: string;
  ownerId?: string;
  declaration: 'definition' | 'usage' | 'unknown';
  span: SysMLSourceSpan;
  /** The identifier token inside the declaration line - the anchor for
   *  go-to-definition/rename style language features (plan §8 S1). */
  nameSpan: SysMLSourceSpan;
}

export interface SysMLRelation {
  id: string;
  kind: SysMLRelationKind;
  from: string;
  to: string;
  label: string;
  line: number;
}

export interface SysMLProjectionDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  line?: number;
}

export interface SysMLProjection {
  sourceHash: string;
  elements: SysMLElement[];
  relations: SysMLRelation[];
  diagnostics: SysMLProjectionDiagnostic[];
}

export interface SysMLPosition {
  x: number;
  y: number;
}

export interface SysMLLayout {
  version: 1;
  sourceHash: string;
  positions: Record<string, SysMLPosition>;
}

/** Portable project-side layout artifact; the source file remains external or
 * text-backed and is never rewritten by the projection editor. */
export function sysmlLayoutPath(sourcePath: string): string {
  return `presentation/sysml/${fnv1aHex(sourcePath)}.layout.json`;
}

function resolveReference(
  reference: string,
  elements: SysMLElement[],
  byQualified: Map<string, SysMLElement>,
): SysMLElement | undefined {
  const normalized = reference.replace(/^::/, '');
  const exact = byQualified.get(normalized);
  if (exact) return exact;
  const candidates = elements.filter(
    (element) => element.name === normalized || element.qualifiedName.endsWith(`::${normalized}`),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Parse the visual subset without pretending to be a complete SysML parser. */
export function projectSysML(source: string): SysMLProjection {
  const parsed = parseSysMLSource(source);
  const elements: SysMLElement[] = parsed.elements.map((element) => ({
    ...element,
    id: elementIdFor(element.kind, element.qualifiedName),
  }));

  const byQualified = new Map(elements.map((element) => [element.qualifiedName, element]));
  const relations: SysMLRelation[] = [];
  const relationKeys = new Set<string>();
  const diagnostics = [...parsed.diagnostics];
  for (const candidate of parsed.pending) {
    const from = resolveReference(candidate.from, elements, byQualified);
    const to = resolveReference(candidate.to, elements, byQualified);
    if (!from || !to) {
      if (candidate.kind !== 'contains') {
        // SY0002: stable unresolved-reference warning (parser code table).
        diagnostics.push({
          code: 'SY0002',
          severity: 'warning',
          message: `cannot resolve ${candidate.kind} reference '${candidate.from}' -> '${candidate.to}'`,
          line: candidate.line,
        });
      }
      continue;
    }
    const key = `${candidate.kind}:${from.id}:${to.id}`;
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);
    relations.push({
      id: `sysml-rel-${fnv1aHex(`${candidate.kind}:${candidate.line}:${from.id}:${to.id}`)}`,
      kind: candidate.kind,
      from: from.id,
      to: to.id,
      label: candidate.label,
      line: candidate.line,
    });
  }

  return {
    sourceHash: `fnv1a-${fnv1aHex(source)}`,
    elements,
    relations,
    diagnostics,
  };
}

export type SysMLLayoutMode = 'all' | 'structure' | 'requirements' | 'behavior' | 'traceability';

export function autoLayoutSysML(
  projection: SysMLProjection,
  mode: SysMLLayoutMode = 'all',
): SysMLLayout {
  const positions: Record<string, SysMLPosition> = {};
  if (mode !== 'all' && mode !== 'structure') {
    const relationKinds = mode === 'requirements'
      ? new Set<SysMLRelationKind>(['satisfies', 'verifies', 'traces', 'derives', 'refines'])
      : mode === 'behavior'
        ? new Set<SysMLRelationKind>(['transitions', 'flows', 'connects', 'typed_by'])
        : new Set<SysMLRelationKind>(['satisfies', 'verifies', 'traces', 'allocates', 'derives', 'refines']);
    const selected = mode === 'traceability'
      ? new Set(
          projection.relations
            .filter((relation) => relationKinds.has(relation.kind))
            .flatMap((relation) => [relation.from, relation.to]),
        )
      : new Set(
          projection.elements
            .filter((element) =>
              mode === 'requirements'
                ? ['package', 'requirement', 'verification', 'analysis', 'constraint', 'usecase'].includes(element.kind)
                : ['package', 'action', 'state', 'analysis', 'verification', 'flow', 'occurrence', 'usecase'].includes(element.kind),
            )
            .map((element) => element.id),
        );
    const ordered = projection.elements.filter((element) => selected.has(element.id));
    const byKind = new Map<string, SysMLElement[]>();
    for (const element of ordered) {
      const list = byKind.get(element.kind) ?? [];
      list.push(element);
      byKind.set(element.kind, list);
    }
    const columns = [...byKind.entries()];
    columns.forEach(([, entries], column) => {
      entries.forEach((element, row) => {
        positions[element.id] = { x: 80 + column * 280, y: 80 + row * 112 };
      });
    });
    projection.elements.forEach((element, index) => {
      positions[element.id] ??= { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 112 };
    });
    return { version: 1, sourceHash: projection.sourceHash, positions };
  }
  const byOwner = new Map<string | undefined, SysMLElement[]>();
  for (const element of projection.elements) {
    const group = byOwner.get(element.ownerId) ?? [];
    group.push(element);
    byOwner.set(element.ownerId, group);
  }
  const queue: Array<{ ownerId?: string; x: number; y: number }> = [
    { ownerId: undefined, x: 80, y: 80 },
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = byOwner.get(current.ownerId) ?? [];
    children.forEach((element, index) => {
      const x = current.x;
      const y = current.y + index * 112;
      positions[element.id] = { x, y };
      queue.push({ ownerId: element.id, x: x + 300, y });
    });
  }
  // Relations to non-contained elements use a deterministic second column.
  projection.elements.forEach((element, index) => {
    positions[element.id] ??= { x: 80 + (index % 4) * 280, y: 80 + Math.floor(index / 4) * 112 };
  });
  return { version: 1, sourceHash: projection.sourceHash, positions };
}

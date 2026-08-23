// Best-effort SysML v2 projection for external models.
//
// This is intentionally not a SysML parser. Professional SysML tools remain
// the source of truth for the language. The projection extracts the stable,
// visual subset needed by the Workbench: declarations, containment and the
// most common structural/traceability/behavior relations. Unsupported syntax
// is preserved in the source editor and reported as a non-fatal diagnostic.

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

const DECLARATION =
  /^\s*(package|part|item|port|interface|requirement|action|state|analysis|verification|attribute|constraint|usecase|view|viewpoint|enum|occurrence|stakeholder|flow)\s+(?:(def|usage)\s+)?([A-Za-z_][A-Za-z0-9_]*)/;
const REFERENCE = '[A-Za-z_][A-Za-z0-9_.:]*';

function fnv1a(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function sysmlSourceHash(source: string): string {
  return `fnv1a-${fnv1a(source)}`;
}

/** Portable project-side layout artifact; the source file remains external or
 * text-backed and is never rewritten by the projection editor. */
export function sysmlLayoutPath(sourcePath: string): string {
  return `presentation/sysml/${fnv1a(sourcePath)}.layout.json`;
}

function visualKind(value: string): SysMLVisualKind {
  return value as SysMLVisualKind;
}

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, '').trimEnd();
}

function relationId(kind: SysMLRelationKind, line: number, from: string, to: string): string {
  return `sysml-rel-${fnv1a(`${kind}:${line}:${from}:${to}`)}`;
}

function elementId(qualifiedName: string, kind: SysMLVisualKind): string {
  return `sysml-${fnv1a(`${kind}:${qualifiedName}`)}`;
}

interface PendingRelation {
  kind: SysMLRelationKind;
  from: string;
  to: string;
  label: string;
  line: number;
}

interface Scope {
  element: SysMLElement;
  closeDepth: number;
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

function pushPending(
  pending: PendingRelation[],
  kind: SysMLRelationKind,
  from: string,
  to: string,
  label: string,
  line: number,
): void {
  if (from.trim() === '' || to.trim() === '') return;
  pending.push({ kind, from: from.trim(), to: to.trim(), label, line });
}

/** Parse the visual subset without pretending to be a complete SysML parser. */
export function projectSysML(source: string): SysMLProjection {
  const elements: SysMLElement[] = [];
  const pending: PendingRelation[] = [];
  const diagnostics: SysMLProjectionDiagnostic[] = [];
  const scopes: Scope[] = [];
  let depth = 0;
  let offset = 0;

  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripComments(rawLine);
    while (scopes.length > 0 && depth < scopes[scopes.length - 1]!.closeDepth) {
      scopes.pop();
    }
    const owner = scopes[scopes.length - 1]?.element;
    const declaration = DECLARATION.exec(line);
    if (declaration) {
      const kind = visualKind(declaration[1]!);
      const declarationKind = declaration[2] === 'def' ? 'definition' : declaration[2] === 'usage' ? 'usage' : 'unknown';
      const name = declaration[3]!;
      const qualifiedName = owner ? `${owner.qualifiedName}::${name}` : name;
      const element: SysMLElement = {
        id: elementId(qualifiedName, kind),
        kind,
        name,
        qualifiedName,
        ownerId: owner?.id,
        declaration: declarationKind,
        span: { start: offset, end: offset + rawLine.length, line: lineNumber },
      };
      elements.push(element);
      if (owner) {
        pushPending(pending, 'contains', owner.qualifiedName, qualifiedName, 'contains', lineNumber);
      }

      const specializes = new RegExp(`:>\\s*(${REFERENCE})`).exec(line);
      if (specializes) {
        pushPending(pending, 'specializes', qualifiedName, specializes[1]!, ':>', lineNumber);
      }
      const typed = new RegExp(`:\\s*(${REFERENCE})`).exec(line.replace(/:>/g, ''));
      if (typed && declarationKind !== 'definition') {
        pushPending(pending, 'typed_by', qualifiedName, typed[1]!, ':', lineNumber);
      }

      const opens = (line.match(/{/g) ?? []).length;
      const closes = (line.match(/}/g) ?? []).length;
      if (opens > closes) scopes.push({ element, closeDepth: depth + opens - closes });
      depth += opens - closes;
    } else {
      const satisfy = new RegExp(`^\\s*satisfy\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`).exec(line);
      const verify = new RegExp(`^\\s*verify\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`).exec(line);
      const trace = new RegExp(`^\\s*trace\\s+(${REFERENCE})\\s+(?:to|from)\\s+(${REFERENCE})`).exec(line);
      const connect = new RegExp(`^\\s*connect\\s+(${REFERENCE})\\s+to\\s+(${REFERENCE})`).exec(line);
      const flow = new RegExp(`^\\s*flow\\s+(${REFERENCE})\\s+from\\s+(${REFERENCE})\\s+to\\s+(${REFERENCE})`).exec(line);
      const transition = new RegExp(`^\\s*transition\\s+(?:first\\s+)?(${REFERENCE})\\s+then\\s+(${REFERENCE})`).exec(line);
      const binary = new RegExp(
        `^\\s*(allocate|derive|refine|redefine|subset|expose|bind|include|dependsOn|depends_on)\\s+(${REFERENCE})\\s+(?:to|from|by|=)\\s+(${REFERENCE})`,
      ).exec(line);
      if (satisfy) pushPending(pending, 'satisfies', satisfy[2]!, satisfy[1]!, 'satisfies', lineNumber);
      else if (verify) pushPending(pending, 'verifies', verify[2]!, verify[1]!, 'verifies', lineNumber);
      else if (flow) pushPending(pending, 'flows', flow[2]!, flow[3]!, flow[1]!, lineNumber);
      else if (connect) pushPending(pending, 'connects', connect[1]!, connect[2]!, 'connects', lineNumber);
      else if (transition) pushPending(pending, 'transitions', transition[1]!, transition[2]!, 'transitions', lineNumber);
      else if (trace) pushPending(pending, 'traces', trace[1]!, trace[2]!, 'traces', lineNumber);
      else if (binary) {
        const relationKind: SysMLRelationKind =
          binary[1] === 'allocate' ? 'allocates' :
          binary[1] === 'derive' ? 'derives' :
          binary[1] === 'refine' ? 'refines' :
          binary[1] === 'redefine' ? 'redefines' :
          binary[1] === 'subset' ? 'subsets' :
          binary[1] === 'expose' ? 'exposes' :
          binary[1] === 'bind' ? 'binds' :
          binary[1] === 'include' ? 'includes' : 'depends_on';
        pushPending(pending, relationKind, binary[2]!, binary[3]!, binary[1]!, lineNumber);
      }
      depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    }
    offset += rawLine.length + 1;
  });

  const byQualified = new Map(elements.map((element) => [element.qualifiedName, element]));
  const relations: SysMLRelation[] = [];
  const relationKeys = new Set<string>();
  for (const candidate of pending) {
    const from = resolveReference(candidate.from, elements, byQualified);
    const to = resolveReference(candidate.to, elements, byQualified);
    if (!from || !to) {
      if (candidate.kind !== 'contains') {
        diagnostics.push({
          code: 'LP-SYML-REF',
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
      id: relationId(candidate.kind, candidate.line, from.id, to.id),
      kind: candidate.kind,
      from: from.id,
      to: to.id,
      label: candidate.label,
      line: candidate.line,
    });
  }

  if (elements.length === 0 && source.trim() !== '') {
    diagnostics.push({
      code: 'LP-SYML-EMPTY',
      severity: 'warning',
      message: 'no visual SysML declarations were recognized; the source remains available in the text editor',
    });
  }
  return { sourceHash: sysmlSourceHash(source), elements, relations, diagnostics };
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

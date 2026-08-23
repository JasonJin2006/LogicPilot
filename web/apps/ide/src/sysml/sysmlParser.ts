// Structured statement-level parser for the SysML v2 visual subset
// (workbench-architecture-plan.md §8 S1). It replaces the line-regex scan
// with brace-aware scope tracking and produces:
//   - elements with precise source spans (declaration keyword through the
//     line that closes the body) and a `nameSpan` pointing at the identifier,
//   - pending relation references resolved by the projection layer,
//   - diagnostics from the stable SYxxxx family (see table below).
//
// Diagnostic codes (stable, documented):
//   SY0001 error   unrecognized statement syntax (source stays in editor)
//   SY0002 warning unresolved reference in a relation
//   SY0003 warning duplicate member name within one scope
//   SY0004 error   unbalanced braces ('}' without '{' or missing at EOF)
//   SY0005 warning no visual declarations recognized at all
//
// This remains a controlled subset: unsupported SysML constructs surface as
// SY0001 instead of being guessed, and the text editor stays authoritative.

import type {
  SysMLProjectionDiagnostic,
  SysMLRelationKind,
  SysMLSourceSpan,
  SysMLVisualKind,
} from './sysmlProjection';

export interface ParsedElement {
  kind: SysMLVisualKind;
  name: string;
  qualifiedName: string;
  ownerId?: string;
  declaration: 'definition' | 'usage' | 'unknown';
  /** Full declaration extent: keyword through the closing-brace line (or the
   *  same line for single-line members). */
  span: SysMLSourceSpan;
  /** The identifier token inside the declaration line. */
  nameSpan: SysMLSourceSpan;
}

export interface PendingRelation {
  kind: SysMLRelationKind;
  from: string;
  to: string;
  label: string;
  line: number;
}

export interface SysMLParseResult {
  elements: ParsedElement[];
  pending: PendingRelation[];
  diagnostics: SysMLProjectionDiagnostic[];
}

const DECLARATION =
  /^(package|part|item|port|interface|requirement|action|state|analysis|verification|attribute|constraint|usecase|view|viewpoint|enum|occurrence|stakeholder|flow)\s+(?:(def|usage)\s+)?([A-Za-z_][A-Za-z0-9_]*)/;

// Reference tokens exclude terminators (';') so they survive line syntax.
const REFERENCE = '[A-Za-z_][A-Za-z0-9_.:]*';

const RELATION_LINE_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpExecArray) => Omit<PendingRelation, 'line'> | null;
}> = [
  {
    re: new RegExp(`^satisfy\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'satisfies', from: m[2]!, to: m[1]!, label: 'satisfies' }),
  },
  {
    re: new RegExp(`^verify\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'verifies', from: m[2]!, to: m[1]!, label: 'verifies' }),
  },
  {
    re: new RegExp(`^flow\\s+(${REFERENCE})\\s+from\\s+(${REFERENCE})\\s+to\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'flows', from: m[2]!, to: m[3]!, label: m[1]! }),
  },
  {
    re: new RegExp(`^connect\\s+(${REFERENCE})\\s+(?:to|with)\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'connects', from: m[1]!, to: m[2]!, label: 'connects' }),
  },
  {
    re: new RegExp(`^transition\\s+(?:first\\s+)?(${REFERENCE})\\s+then\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'transitions', from: m[1]!, to: m[2]!, label: 'transitions' }),
  },
  {
    re: new RegExp(`^trace\\s+(${REFERENCE})\\s+(?:to|from)\\s+(${REFERENCE})`),
    build: (m) => ({ kind: 'traces', from: m[1]!, to: m[2]!, label: 'trace' }),
  },
  {
    re: new RegExp(
      `^(allocate|derive|refine|redefine|subset|expose|bind|include|dependsOn|depends_on)\\s+(${REFERENCE})\\s+(?:to|from|by|=)\\s+(${REFERENCE})`,
    ),
    build: (m) => ({
      kind:
        m[1] === 'allocate' ? 'allocates'
        : m[1] === 'derive' ? 'derives'
        : m[1] === 'refine' ? 'refines'
        : m[1] === 'redefine' ? 'redefines'
        : m[1] === 'subset' ? 'subsets'
        : m[1] === 'expose' ? 'exposes'
        : m[1] === 'bind' ? 'binds'
        : m[1] === 'include' ? 'includes'
        : 'depends_on',
      from: m[2]!,
      to: m[3]!,
      label: m[1]!,
    }),
  },
];

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, '').trimEnd();
}

/** Portable stable identity: fnv1a over kind + qualified name. Shared by the
 *  layout sidecar, so ids must stay byte-compatible across refactors. */
export function fnv1aHex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function elementIdFor(kind: SysMLVisualKind, qualifiedName: string): string {
  return `sysml-${fnv1aHex(`${kind}:${qualifiedName}`)}`;
}

/** Parse the controlled visual subset with error recovery: after a bad
 *  statement the scanner continues on the next line, so every problem gets
 *  reported instead of only the first one. */
export function parseSysMLSource(source: string): SysMLParseResult {
  const elements: ParsedElement[] = [];
  const pending: PendingRelation[] = [];
  const diagnostics: SysMLProjectionDiagnostic[] = [];
  // Open containers: popped (span closed) once the depth drops below their
  // recorded level - on the very line holding their closing brace.
  const openScopes: Array<{ elementIndex: number; closeDepth: number }> = [];
  const namesByOwner = new Map<string, Set<string>>();
  let negativeReported = false;
  let depth = 0;
  let offset = 0;

  const closeScopesBelow = (newDepth: number, lineEnd: number): void => {
    while (openScopes.length > 0 && openScopes[openScopes.length - 1]!.closeDepth > newDepth) {
      const closed = openScopes.pop()!;
      const element = elements[closed.elementIndex];
      if (element) {
        element.span.end = lineEnd;
      }
    }
  };

  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const lineEnd = offset + rawLine.length;
    const stripped = stripComments(rawLine);
    const opens = (stripped.match(/{/g) ?? []).length;
    const closes = (stripped.match(/}/g) ?? []).length;

    if (stripped.trim() !== '') {
      const indented = stripped.trimStart();
      const leadingWs = stripped.length - indented.length;
      const base = offset + leadingWs;
      const declaration = DECLARATION.exec(indented);
      const parentScope = openScopes[openScopes.length - 1];
      const owner = parentScope !== undefined ? elements[parentScope.elementIndex] : undefined;
      // Children reference their container by the SAME stable id scheme the
      // projection assigns, so ownerId needs no post-pass.
      const ownerId = owner ? elementIdFor(owner.kind, owner.qualifiedName) : undefined;

      if (declaration && !/^\s*[{}]/.test(indented)) {
        const kind = declaration[1] as SysMLVisualKind;
        const declarationKind =
          declaration[2] === 'def' ? 'definition' : declaration[2] === 'usage' ? 'usage' : 'unknown';
        const name = declaration[3]!;
        const nameStartInLine = declaration[0].lastIndexOf(name);
        const qualifiedName = owner ? `${owner.qualifiedName}::${name}` : name;

        const seen = namesByOwner.get(ownerId ?? '') ?? new Set<string>();
        if (seen.has(name)) {
          diagnostics.push({
            code: 'SY0003',
            severity: 'warning',
            message: `duplicate member name '${name}' in ${owner?.qualifiedName ?? 'the model root'}`,
            line: lineNumber,
          });
        }
        seen.add(name);
        namesByOwner.set(ownerId ?? '', seen);

        if (owner && ownerId !== undefined) {
          pushPending(pending, 'contains', owner.qualifiedName, qualifiedName, 'contains', lineNumber);
        }

        elements.push({
          kind,
          name,
          qualifiedName,
          ownerId,
          declaration: declarationKind,
          span: { start: base, end: lineEnd, line: lineNumber },
          nameSpan: {
            start: base + nameStartInLine,
            end: base + nameStartInLine + name.length,
            line: lineNumber,
          },
        });

        const specializes = /:>\s*REF/.exec(indented);
        if (specializes) {
          pushPending(pending, 'specializes', qualifiedName, specializes[1]!, ':>', lineNumber);
        }
        const typed = /:\s*([A-Za-z_][A-Za-z0-9_.:]*)/.exec(indented.replace(/:>/g, ''));
        if (typed && declarationKind !== 'definition') {
          pushPending(pending, 'typed_by', qualifiedName, typed[1]!, ':', lineNumber);
        }

        const delta = opens - closes;
        if (delta > 0) {
          openScopes.push({ elementIndex: elements.length - 1, closeDepth: depth + delta });
        }
      } else {
        const relation = matchRelationLine(indented);
        if (relation !== null) {
          pending.push({ ...relation, line: lineNumber });
        } else if (opens === 0 && closes === 0) {
          diagnostics.push({
            code: 'SY0001',
            severity: 'error',
            message: `unrecognized SysML statement: '${indented.slice(0, 60)}${indented.length > 60 ? '…' : ''}'`,
            line: lineNumber,
          });
        }
      }
    }

    depth += opens - closes;
    if (depth < 0 && !negativeReported) {
      diagnostics.push({
        code: 'SY0004',
        severity: 'error',
        message: "unbalanced '}': closing more blocks than were opened",
        line: lineNumber,
      });
      negativeReported = true;
      depth = 0; // resynchronize so remaining members land at the root
    }
    // Close any containers whose '}' was on THIS line.
    closeScopesBelow(depth, lineEnd);
    offset += rawLine.length + 1;
  });

  while (openScopes.length > 0) {
    const closed = openScopes.pop()!;
    const element = elements[closed.elementIndex];
    if (element) {
      element.span.end = offset;
    }
  }
  if (!negativeReported && depth > 0) {
    diagnostics.push({
      code: 'SY0004',
      severity: 'error',
      message: 'unbalanced braces: a block was opened but never closed',
      line: lines.length,
    });
  }

  if (elements.length === 0 && source.trim() !== '') {
    diagnostics.push({
      code: 'SY0005',
      severity: 'warning',
      message: 'no visual SysML declarations were recognized; the source remains available in the text editor',
    });
  }
  return { elements, pending, diagnostics };
}

function matchRelationLine(line: string): Omit<PendingRelation, 'line'> | null {
  for (const pattern of RELATION_LINE_PATTERNS) {
    const match = pattern.re.exec(line);
    if (match) {
      return pattern.build(match);
    }
  }
  return null;
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

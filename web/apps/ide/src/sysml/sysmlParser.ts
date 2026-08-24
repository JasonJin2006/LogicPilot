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
//   SY0006 warning multiple declarations on one line: only the first was parsed
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

/** A time trigger on a transition (`after 5 s` / `at 10`). Execution 0.2
 *  accepts NUMERIC literal amounts only; units are recorded verbatim and
 *  never converted - mixing units in one machine is not interpreted. */
export interface RelationTrigger {
  kind: 'after' | 'at';
  amount: number;
  unit?: string;
}

export interface PendingRelation {
  kind: SysMLRelationKind;
  from: string;
  to: string;
  label: string;
  line: number;
  trigger?: RelationTrigger;
}

export interface SysMLParseResult {
  elements: ParsedElement[];
  pending: PendingRelation[];
  diagnostics: SysMLProjectionDiagnostic[];
}

// Identifiers may be bare SysML ASCII names or single-quoted strings (the
// form used throughout the amphibious-robot model). Group layout keeps the
// kind/def indexes of the old DECLARATION: [1] kind, [2] def, [3] quoted
// inner name, [4] bare name.
const IDENT = String.raw`(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))`;

/** Qualified reference: `Name`, `'Chinese Name'`, `Pkg::'Named'::X`. */
const REFERENCE = String.raw`(?:'[^']*'|[A-Za-z_][A-Za-z0-9_]*)(?:::(?:'[^']*'|[A-Za-z_][A-Za-z0-9_]*))*`;

/** De-quote a raw identifier token: `'a b'` -> `a b`; bare stays bare. */
function dequoteName(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** De-quote a whole qualified reference, preserving `::` splits. Exported
 *  for the linked-model layer, which parses import directives itself. */
export function dequoteRef(raw: string): string {
  return raw.split('::').map(dequoteName).join('::');
}

const DECLARATION = new RegExp(
  '^(?:(?:assert|abstract|individual|variation)\\s+)?(package|part|item|port|interface|requirement|action|calculation|calc|state|analysis|verification|attribute|constraint|usecase|view|viewpoint|enum|occurrence|stakeholder|flow|interaction|actor)' +
    '\\s+(?:(def|usage)\\s+)?' +
    IDENT,
);

/** `calc` is the common shorthand; both project to the 'calculation' kind. */
function normalizeKind(raw: string): SysMLVisualKind {
  // `actor` renders with the stakeholder stick figure; `interaction` is the
  // sequence-diagram container of the controlled subset.
  if (raw === 'calc') return 'calculation';
  if (raw === 'actor') return 'stakeholder';
  return raw as SysMLVisualKind;
}

const RELATION_LINE_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpExecArray) => Omit<PendingRelation, 'line'> | null;
}> = [
  {
    // `message 'name' from A to B;` / `reply from A to B;` (name optional) -
    // the sequence-diagram subset (interaction bodies).
    re: new RegExp(
      `^(message|reply)(?:\\s+(${REFERENCE}))?\\s+from\\s+(${REFERENCE})\\s+to\\s+(${REFERENCE})`,
    ),
    build: (m) => ({
      kind: m[1] === 'reply' ? 'replies' : 'messages',
      from: dequoteRef(m[3]!),
      to: dequoteRef(m[4]!),
      label: m[2] !== undefined ? dequoteRef(m[2]!) : m[1]!,
    }),
  },
  {
    re: new RegExp(`^satisfy\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`),
    build: (m) => ({
      kind: 'satisfies',
      from: dequoteRef(m[2]!),
      to: dequoteRef(m[1]!),
      label: 'satisfies',
    }),
  },
  {
    re: new RegExp(`^verify\\s+requirement\\s+(${REFERENCE})\\s+by\\s+(${REFERENCE})`),
    build: (m) => ({
      kind: 'verifies',
      from: dequoteRef(m[2]!),
      to: dequoteRef(m[1]!),
      label: 'verifies',
    }),
  },
  {
    re: new RegExp(`^flow\\s+(${REFERENCE})\\s+from\\s+(${REFERENCE})\\s+to\\s+(${REFERENCE})`),
    build: (m) => ({
      kind: 'flows',
      from: dequoteRef(m[2]!),
      to: dequoteRef(m[3]!),
      label: dequoteRef(m[1]!),
    }),
  },
  {
    re: new RegExp(`^connect\\s+(${REFERENCE})\\s+(?:to|with)\\s+(${REFERENCE})`),
    build: (m) => ({
      kind: 'connects',
      from: dequoteRef(m[1]!),
      to: dequoteRef(m[2]!),
      label: 'connects',
    }),
  },
  {
    // Anchored to end-of-statement so unsupported trigger forms (guard
    // clauses, expression durations) fall through to SY0001 instead of
    // being silently truncated. Numeric literal durations only (0.2).
    re: new RegExp(
      `^transition\\s+(?:first\\s+)?(${REFERENCE})\\s+then\\s+(${REFERENCE})` +
        `(?:\\s+(after|at)\\s+([0-9]+(?:\\.[0-9]+)?)\\s*([A-Za-z_][A-Za-z0-9_]*)?)?\\s*;?$`,
    ),
    build: (m) => ({
      kind: 'transitions' as const,
      from: dequoteRef(m[1]!),
      to: dequoteRef(m[2]!),
      label: 'transitions',
      ...(m[3]
        ? {
            trigger: {
              kind: m[3] as 'after' | 'at',
              amount: Number(m[4]),
              ...(m[5] ? { unit: m[5] } : {}),
            },
          }
        : {}),
    }),
  },
  {
    re: new RegExp(`^trace\\s+(${REFERENCE})\\s+(?:to|from)\\s+(${REFERENCE})`),
    build: (m) => ({
      kind: 'traces',
      from: dequoteRef(m[1]!),
      to: dequoteRef(m[2]!),
      label: 'trace',
    }),
  },
  {
    re: new RegExp(
      `^(allocate|derive|refine|redefine|subset|expose|bind|include|dependsOn|depends_on)\\s+(${REFERENCE})\\s+(?:to|from|by|=)\\s+(${REFERENCE})`,
    ),
    build: (m) => ({
      kind:
        m[1] === 'allocate'
          ? 'allocates'
          : m[1] === 'derive'
            ? 'derives'
            : m[1] === 'refine'
              ? 'refines'
              : m[1] === 'redefine'
                ? 'redefines'
                : m[1] === 'subset'
                  ? 'subsets'
                  : m[1] === 'expose'
                    ? 'exposes'
                    : m[1] === 'bind'
                      ? 'binds'
                      : m[1] === 'include'
                        ? 'includes'
                        : 'depends_on',
      from: dequoteRef(m[2]!),
      to: dequoteRef(m[3]!),
      label: m[1]!,
    }),
  },
];

/** `exhibit <kind> 'name' : 'Type' { ... }` - a state machine/part usage
 *  applied inside a part body. Groups: 1 kind, 2 quoted name, 3 bare name,
 *  4 optional type reference. */
const EXHIBIT_LINE = new RegExp(
  `^exhibit\\s+(state|part|action|port|requirement|attribute)\\s+${IDENT}` +
    `(?:\\s*:\\s*(${REFERENCE}))?`,
);

type LooseTransition =
  | {
      ok: true;
      from: string;
      to: string;
      trigger?: { kind: 'after' | 'at'; amount: number; unit?: string };
    }
  | { ok: false };

/** Tolerant parse for multi-line transition statements - the SysML spec
 *  spelling this product targets ('first A ... effect action 'x'
 *  : 'P::Q' ... then B after N s;') plus the interactive form
 *  (transition A then B). `first start then B` marks the machine entry; it
 *  carries no resolvable 'from' state, so callers treat it as accepted
 *  (execution assumes the first declared state is initial). */
function parseTransitionStatement(text: string): LooseTransition {
  const clean = text.replace(/;\s*$/, '');
  const thenMatch = new RegExp(`then\\s+(${REFERENCE})`).exec(clean);
  const target = thenMatch?.[1];
  if (target === undefined) return { ok: false };
  const firstMatch = new RegExp(`first\\s+(?:start|(${REFERENCE}))`).exec(clean);
  let from = firstMatch?.[1];
  if (from === undefined) {
    const firstToken = clean.match(new RegExp(`transition\\s+(${REFERENCE})`));
    from = firstToken?.[1];
  }
  const triggerMatch = new RegExp(
    `(after|at)\\s+([0-9]+(?:\\.[0-9]+)?)\\s*([A-Za-z_][A-Za-z0-9_]*)?`,
  ).exec(clean);
  if (from === 'start' || from === undefined) {
    // Entry marker: accepted, no resolvable edge.
    return { ok: false };
  }
  return {
    ok: true,
    from: dequoteRef(from),
    to: dequoteRef(target),
    ...(triggerMatch
      ? {
          trigger: {
            kind: triggerMatch[1] as 'after' | 'at',
            amount: Number(triggerMatch[2]),
            ...(triggerMatch[3] ? { unit: triggerMatch[3] } : {}),
          },
        }
      : {}),
  };
}

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, '').trimEnd();
}

/** Strip a `/* ... *\/` block comment; callers carry `blockOpen` across
 *  lines until the closing `*\/` arrives. */
function stripBlockComment(line: string, blockOpen: boolean): { line: string; open: boolean } {
  if (blockOpen) {
    const end = line.indexOf('*/');
    if (end === -1) return { line: '', open: true };
    return { line: stripComments(line.slice(end + 2)), open: false };
  }
  const start = line.indexOf('/*');
  if (start === -1) return { line: stripComments(line), open: false };
  const end = line.indexOf('*/', start + 2);
  if (end === -1) return { line: stripComments(line.slice(0, start)), open: true };
  return { line: stripComments(line.slice(0, start) + line.slice(end + 2)), open: false };
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
  let blockCommentOpen = false;
  // Multi-line transition statements (`transition '连接至分离'\n first ...\n
  // then '分离';`) accumulate until the terminating ';'.
  let pendingTransition = '';
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const lineEnd = offset + rawLine.length;
    const commentClean = stripBlockComment(rawLine, blockCommentOpen);
    blockCommentOpen = commentClean.open;
    const stripped = commentClean.line;
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
        const kind = normalizeKind(declaration[1]!);
        // SysML semantics: a definition says `def`; a keyword-less part /
        // item / port / ... declaration IS a usage. Packages (and kinds
        // without the def/usage axis) stay 'unknown'.
        const USAGE_DEFAULT_KINDS = new Set([
          'part', 'item', 'port', 'attribute', 'action', 'calculation',
          'calc', 'state', 'constraint', 'occurrence', 'flow', 'interface',
        ]);
        const declarationKind =
          declaration[2] === 'def'
            ? 'definition'
            : declaration[2] === 'usage'
              ? 'usage'
              : USAGE_DEFAULT_KINDS.has(declaration[1]!)
                ? 'usage'
                : 'unknown';
        const name = declaration[3] ?? declaration[4]!;
        const nameStartInLine = declaration[0].lastIndexOf(name);
        const qualifiedName = owner ? `${owner.qualifiedName}::${name}` : name;

        // One declaration per line, keep the subset honest: a second block
        // on the same line would shift the brace bookkeeping. The first one
        // is still parsed; the rest is reported instead of silently folded.
        const rest = indented.slice(declaration[0].length);
        if (
          /(^|[\s{,;)}\]])+\b(?:part|item|port|interface|requirement|state|transition|action|calculation|attribute|package|analysis|verification)\s+[A-Za-z_]/.test(
            rest,
          )
        ) {
          diagnostics.push({
            code: 'SY0006',
            severity: 'warning',
            message:
              'multiple declarations on one line are not supported; split them into separate lines',
            line: lineNumber,
          });
        }

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
          pushPending(
            pending,
            'contains',
            owner.qualifiedName,
            qualifiedName,
            'contains',
            lineNumber,
          );
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
        const typed = new RegExp(`:\\s*(${REFERENCE})`).exec(indented.replace(/:>/g, ''));
        if (typed && declarationKind !== 'definition') {
          pushPending(pending, 'typed_by', qualifiedName, dequoteRef(typed[1]!), ':', lineNumber);
        }

        const delta = opens - closes;
        if (delta > 0) {
          openScopes.push({ elementIndex: elements.length - 1, closeDepth: depth + delta });
        }
      } else {
        // Multi-line transition statement: accumulate until ';'.
        if (pendingTransition !== '') {
          pendingTransition += ` ${stripped.trim()}`;
          if (indented.endsWith(';')) {
            const parsedTransition = parseTransitionStatement(pendingTransition);
            pendingTransition = '';
            if (parsedTransition.ok) {
              pending.push({
                kind: 'transitions',
                from: parsedTransition.from,
                to: parsedTransition.to,
                label: 'transitions',
                ...(parsedTransition.trigger ? { trigger: parsedTransition.trigger } : {}),
                line: lineNumber,
              });
            } else {
              diagnostics.push({
                code: 'SY0001',
                severity: 'error',
                message: `unrecognized SysML transition: '${pendingTransition.slice(0, 80)}'`,
                line: lineNumber,
              });
            }
          }
        } else if (
          indented.startsWith('transition') &&
          !indented.endsWith(';') &&
          !indented.includes('{')
        ) {
          pendingTransition = stripped.trim();
        } else if (/^(private\s+)?import\b/.test(indented)) {
          // Import directives are project-level: accepted as a directive and
          // resolved by the project index, never a visual element.
        } else if (/^(doc|metadata|language)\b/.test(indented)) {
          // Documentation/metadata keywords: accepted as prose, not elements.
        } else if (/^first\s+start\s+then\s+/.test(indented)) {
          // State-machine entry marker (initial state from `then`): accepted;
          // execution treats the first declared state as initial.
        } else if (
          /^(?:entry;\s*)?then\s+action\b/.test(indented) ||
          /^entry;?$/.test(indented) ||
          /^exit;?$/.test(indented)
        ) {
          // exhibit-body effect lines: accepted, not interpreted (matrix).
        } else if (/^'[^']+';?$/.test(indented)) {
          // Enumeration literal members (`'高';`): prose of the owning enum.
        } else if (/^(subject|actor|render|objective|stakeholders|doc)/.test(indented)) {
          // use-case/view body keywords: accepted as prose (matrix).
        } else if (/^'[^']*'\s*(>=|<=|==|>|<)/.test(indented)) {
          // Constraint comparison expression lines: prose of the owning
          // constraint; expressions are never evaluated (matrix).
        } else if (/^then\s+[^{}]*=[^=]/.test(indented)) {
          // `then <feature> = <value>;` action-effect assignments inside
          // state bodies: accepted as prose (matrix: never interpreted).
        } else if (/^:\s*['A-Za-z_]/.test(indented) && indented.endsWith(';')) {
          // Wrapped type clause of the previous declaration
          // (`exhibit state 'x'\n : 'Pkg'::'Type';`): accepted - typing is
          // recorded where it shares the declaration line.
        } else if (/^(?:not|and|or)\b|^\(/.test(indented)) {
          // Constraint expression fragments (`not ('a' and 'b')`): recorded
          // as prose of the owning constraint; expressions are not evaluated
          // by the visual subset (conformance matrix).
        } else if (/^(?:attribute\s+)?\s*:{1,2}>{1,2}\s/.test(indented)) {
          // Specialization/redefinition continuation lines (`:> base : T;`,
          // `attribute :>> 'name' = #.# [g];`): refinements of the previous
          // declaration. Accepted - the containment/projection tree does not
          // depend on them (matrix: recorded verbatim, never interpreted).
        } else if (/^'[^']+'\s*=/.test(indented) || /^[A-Za-z_][A-Za-z0-9_]*\s*=[^=]/.test(indented)) {
          // Feature value assignments ('制造商' = "自制"; /
          // '类别' = '零件类别'::'飞行器零件';): accepted as prose. The
          // assigned value belongs to the owning attribute's declaration;
          // re-deriving it here would duplicate state without a consumer.
        } else {
          const exhibit = EXHIBIT_LINE.exec(indented);
          if (exhibit !== null && !exhibit[1]!.startsWith('{')) {
            const exhibitKind = normalizeKind(exhibit[1]!);
            const exhibitName = exhibit[2] ?? exhibit[3]!;
            const exhibitOwnerId = ownerId;
            elements.push({
              kind: exhibitKind,
              name: exhibitName,
              qualifiedName: owner ? `${owner.qualifiedName}::${exhibitName}` : exhibitName,
              ownerId: exhibitOwnerId,
              declaration: 'usage',
              span: { start: base, end: lineEnd, line: lineNumber },
              nameSpan: {
                start: base + exhibit[0].lastIndexOf(exhibitName),
                end: base + exhibit[0].lastIndexOf(exhibitName) + exhibitName.length,
                line: lineNumber,
              },
            });
            if (owner && exhibitOwnerId !== undefined) {
              pushPending(
                pending,
                'contains',
                owner.qualifiedName,
                exhibitName,
                'contains',
                lineNumber,
              );
            }
            if (exhibit[4] !== undefined) {
              pushPending(
                pending,
                'typed_by',
                exhibitName,
                dequoteRef(exhibit[4]),
                ':',
                lineNumber,
              );
            }
            const exhibitDelta = opens - closes;
            if (exhibitDelta > 0) {
              openScopes.push({
                elementIndex: elements.length - 1,
                closeDepth: depth + exhibitDelta,
              });
            }
          } else {
            // Allman style: the opening brace sits on the line below the
            // declaration (or alone with a closing brace for an empty body).
            // Such a line carries no statement, but it still opens the scope of
            // the element declared on the previous line.
            const allmanOpen =
              (/^\{[^{}]*\}$/.test(indented) || /^\{;?$/.test(indented)) &&
              opens === 1 &&
              closes <= 1;
            if (allmanOpen) {
              const lastElement = elements[elements.length - 1];
              const lastScope = openScopes[openScopes.length - 1];
              if (
                lastElement !== undefined &&
                (lastScope === undefined || lastScope.elementIndex !== elements.length - 1)
              ) {
                openScopes.push({
                  elementIndex: elements.length - 1,
                  closeDepth: depth + 1,
                });
              }
            } else if (matchRelationLine(indented) !== null) {
              pending.push({ ...matchRelationLine(indented)!, line: lineNumber });
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
      message:
        'no visual SysML declarations were recognized; the source remains available in the text editor',
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

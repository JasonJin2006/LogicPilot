// Typed source-text transactions for the external SysML editor
// (workbench-architecture-plan.md §8 S1 "AI typed edits"). Every edit is a
// pure function over the authoritative source string - the projection is
// never hand-patched - so the regular refresh/reparse path stays the single
// route from text to visualization. Callers verify the result by re-running
// projectSysML and reporting any new SYxxxx diagnostics back to the model.

import type { SysMLProjection, SysMLVisualKind } from './sysmlProjection';

export type SysMLEditResult =
  | { ok: true; source: string; detail: string }
  | { ok: false; error: string };

const KIND_TOKENS: ReadonlySet<string> = new Set([
  'package', 'part', 'item', 'port', 'interface', 'requirement', 'action',
  'state', 'analysis', 'verification', 'attribute', 'constraint', 'usecase',
  'view', 'viewpoint', 'enum', 'occurrence', 'stakeholder', 'flow',
]);

function findElement(projection: SysMLProjection, query: string) {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return undefined;
  return projection.elements.find(
    (element) =>
      element.id.toLowerCase() === normalized ||
      element.name.toLowerCase() === normalized ||
      element.qualifiedName.toLowerCase() === normalized,
  );
}

/** Line-leading whitespace of the line containing `offset`. */
function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const line = source.slice(lineStart, offset);
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}

function insertBeforeLine(source: string, offset: number, insertion: string): string {
  // offset points at or past the closing '}'; walk back to its line start so
  // the new member lands on its own line above it.
  let lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  if (source.slice(lineStart, offset).includes('{')) {
    lineStart = offset; // degenerate one-line block: fall back to inline insert
  }
  return `${source.slice(0, lineStart)}${insertion}${source.slice(lineStart)}`;
}

export interface InsertElementOptions {
  kind: string;
  name: string;
  /** 'def' for definitions; omit for usages. */
  declaration?: 'def' | 'usage';
  /** Owner (id, name or qualified name); omit to append at model root. */
  parent?: string;
  /** Extra statement lines placed inside the new element's body. */
  bodyLines?: readonly string[];
}

/** Insert one typed declaration. The element id below assumes the standard
 *  identity hash so callers can select it right away. */
export function insertElement(
  source: string,
  projection: SysMLProjection,
  options: InsertElementOptions,
): SysMLEditResult & { elementId?: string } {
  const kindToken = options.kind.trim();
  if (!KIND_TOKENS.has(kindToken)) {
    return { ok: false, error: `unsupported element kind '${options.kind}'` };
  }
  const name = options.name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, error: `'${options.name}' is not a valid SysML identifier` };
  }
  if (findElement(projection, name) !== undefined) {
    return { ok: false, error: `an element named '${name}' already exists` };
  }

  const header =
    options.declaration === 'def'
      ? `${kindToken} def ${name}`
      : `${kindToken} ${name}`;
  const body = (options.bodyLines ?? []).map((line) => line.trimEnd());
  let qualifiedParent: string | undefined;

  let insertion: string;
  if (options.parent !== undefined && options.parent.trim() !== '') {
    const parent = findElement(projection, options.parent);
    if (parent === undefined) {
      return { ok: false, error: `no SysML element matches '${options.parent}'` };
    }
    const blockText = source.slice(parent.span.start, parent.span.end);
    if (!blockText.includes('{')) {
      return {
        ok: false,
        error: `'${parent.name}' has no block body to nest into; add a '{ }' body first`,
      };
    }
    const closeIndent = indentAt(source, parent.span.end);
    const memberIndent = `${closeIndent}  `;
    // Empty bodies stay single-line (`part def Pump;`) - cleaner SysML than
    // a two-line `{ }`.
    const memberLines =
      body.length > 0
        ? [`${memberIndent}${header} {`, ...body.map((line) => `${memberIndent}  ${line}`), `${memberIndent}}`]
        : [`${memberIndent}${header};`];
    insertion = `${memberLines.join('\n')}\n`;
    qualifiedParent = parent.qualifiedName;
    const braceOffset = parent.span.start + blockText.lastIndexOf('}') + 1;
    // Degenerate one-line body (`part P { }`): expand it so the member gets
    // a proper line instead of being glued behind the closing brace.
    const braceLineStart = source.lastIndexOf('\n', Math.max(0, braceOffset - 1)) + 1;
    const opensInline = source.slice(braceLineStart, braceOffset).includes('{');
    let nextSource: string;
    if (opensInline) {
      const expanded = `${source.slice(braceLineStart, braceOffset - 1).trimEnd()}\n${insertion}${closeIndent}}${source.slice(braceOffset)}`;
      nextSource = `${source.slice(0, braceLineStart)}${expanded}`;
    } else {
      nextSource = insertBeforeLine(source, braceOffset, insertion);
    }
    return {
      ok: true,
      source: nextSource,
      detail: `added ${header} inside ${parent.qualifiedName}`,
      // Same identity scheme as sysmlParser.elementIdFor.
      elementId: `sysml-${fnvOf(`${kindToken}:${qualifiedParent}::${name}`)}`,
    };
  }

  const memberLines = body.length > 0
    ? [`${header} {`, ...body.map((line) => `  ${line}`), `}`]
    : [`${header};`];
  const trimmedEnd = source.replace(/\s*$/, '');
  insertion = `\n${memberLines.join('\n')}\n`;
  return {
    ok: true,
    source: `${trimmedEnd}${insertion}`,
    detail: `added ${header} at the model root`,
    elementId: `sysml-${fnvOf(`${kindToken}:${name}`)}`,
  };
}

/** Replace the identifier token of one element (children keep resolving -
 *  textual nesting carries no parent names). */
export function renameElement(
  source: string,
  projection: SysMLProjection,
  query: string,
  newName: string,
): SysMLEditResult {
  const element = findElement(projection, query);
  if (element === undefined) {
    return { ok: false, error: `no SysML element matches '${query}'` };
  }
  const name = newName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, error: `'${newName}' is not a valid SysML identifier` };
  }
  if (element.name === name) {
    return { ok: false, error: `'${name}' is already this element's name` };
  }
  // A rename clashes only with a sibling under the SAME parent (qualified
  // name); same names in other scopes are legal SysML nesting.
  const parentPrefix = element.qualifiedName.slice(
    0,
    element.qualifiedName.length - element.name.length,
  );
  const clash = projection.elements.some(
    (candidate) => candidate !== element && candidate.qualifiedName === `${parentPrefix}${name}`,
  );
  if (clash) {
    return { ok: false, error: `an element named '${name}' already exists in the same scope` };
  }
  return {
    ok: true,
    source: `${source.slice(0, element.nameSpan.start)}${name}${source.slice(element.nameSpan.end)}`,
    detail: `renamed ${element.qualifiedName} to '${name}'`,
  };
}

export type RelationVerb =
  | 'satisfy'
  | 'verify'
  | 'trace'
  | 'connect'
  | 'allocate'
  | 'bind';

const RELATION_TEMPLATES: Record<RelationVerb, (from: string, to: string) => string> = {
  satisfy: (from, to) => `satisfy requirement ${to} by ${from}`,
  verify: (from, to) => `verify requirement ${to} by ${from}`,
  trace: (from, to) => `trace ${from} to ${to}`,
  connect: (from, to) => `connect ${from} to ${to}`,
  allocate: (from, to) => `allocate ${from} to ${to}`,
  bind: (from, to) => `bind ${from} to ${to}`,
};

/** Append one typed relation statement at the top level. References stay
 *  symbolic (names); resolution is the projection's job afterwards. */
export function addRelationStatement(
  source: string,
  verb: RelationVerb,
  from: string,
  to: string,
): SysMLEditResult {
  const template = RELATION_TEMPLATES[verb];
  if (template === undefined) {
    return { ok: false, error: `unsupported relation verb '${verb}'` };
  }
  const fromRef = from.trim();
  const toRef = to.trim();
  if (fromRef === '' || toRef === '') {
    return { ok: false, error: 'both endpoints must be non-empty' };
  }
  // A statement may only live at top level: refuse sources whose braces do
  // not balance instead of guessing where a block ends (plan §13 honesty).
  let depth = 0;
  for (const character of source) {
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0) {
    return { ok: false, error: 'cannot append a relation: the source has unbalanced braces' };
  }
  const trimmedEnd = source.replace(/\s*$/, '');
  return {
    ok: true,
    source: `${trimmedEnd}\n${template(fromRef, toRef)};\n`,
    detail: `added ${verb} relation ${fromRef} -> ${toRef}`,
  };
}

// Local fnv1a mirror (kept byte-compatible with sysmlParser.elementIdFor).
function fnvOf(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

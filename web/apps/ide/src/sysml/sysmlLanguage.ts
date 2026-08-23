// Cursor-aware language services over the parsed projection
// (workbench-architecture-plan.md §8 S1): completions, hover, go-to-
// definition and reference lookup. All functions are pure over the source
// text plus the projection - the textarea stays a plain editor while these
// power AI navigation and the reveal-in-source actions.

import type { SysMLElement, SysMLProjection, SysMLRelation } from './sysmlProjection';
import { renameElement } from './sysmlEdits';

export interface SysMLCompletionItem {
  label: string;
  kind: 'keyword' | 'element';
  insertText: string;
}

/** Declaration/statement starters of the visual subset. */
export const SYML_KEYWORDS: readonly string[] = [
  'package', 'part def', 'part', 'item', 'port def', 'port', 'interface',
  'requirement def', 'requirement', 'action def', 'action', 'state def',
  'state', 'analysis def', 'analysis', 'verification def', 'verification',
  'attribute', 'constraint def', 'constraint', 'usecase', 'view def', 'view',
  'viewpoint', 'enum', 'occurrence', 'stakeholder', 'flow',
  'satisfy requirement', 'verify requirement', 'connect', 'trace', 'allocate',
];

export function wordAt(source: string, offset: number): { word: string; start: number; end: number } {
  const clamped = Math.min(Math.max(0, offset), source.length);
  let start = clamped;
  let end = clamped;
  const isWordChar = (ch: string | undefined) =>
    ch !== undefined && /[A-Za-z0-9_.:]/.test(ch);
  while (start > 0 && isWordChar(source[start - 1])) start -= 1;
  while (end < source.length && isWordChar(source[end])) end += 1;
  return { word: source.slice(start, end), start, end };
}

/** Completions at a cursor: element references in traceability positions
 *  (`by/to/from`, or the target slot of satisfy/verify lines), otherwise
 *  declaration keywords filtered by the word being typed. */
export function completionsAt(
  source: string,
  offset: number,
  projection: SysMLProjection,
): SysMLCompletionItem[] {
  const before = source.slice(0, offset);
  const referenceContext =
    /(?:by|to|from)\s+([A-Za-z0-9_.:]*)$/.exec(before) ??
    // `satisfy requirement <target>` / `verify requirement <target>`: the
    // token being typed IS an element reference.
    /(?:^|\n)\s*(?:satisfy|verify)\s+requirement\s+([A-Za-z0-9_.:]*)$/.exec(before);
  if (referenceContext !== null) {
    const typedPrefix = referenceContext[1]!.toLowerCase();
    return projection.elements
      .filter((element) => element.qualifiedName.toLowerCase().includes(typedPrefix))
      .map((element) => ({
        label: element.qualifiedName,
        kind: 'element' as const,
        insertText: element.name,
      }));
  }
  const { word } = wordAt(before, before.length);
  const prefix = word.toLowerCase();
  return SYML_KEYWORDS.filter((keyword) => keyword.startsWith(prefix)).map((keyword) => ({
    label: keyword,
    kind: 'keyword' as const,
    insertText: keyword,
  }));
}

/** The innermost element whose declaration block contains the offset
 *  (outer scopes contain their children too - the smallest span wins). */
export function hoverAt(projection: SysMLProjection, offset: number): SysMLElement | null {
  let best: SysMLElement | null = null;
  for (const element of projection.elements) {
    if (offset >= element.span.start && offset <= element.span.end) {
      if (best === null || element.span.end - element.span.start < best.span.end - best.span.start) {
        best = element;
      }
    }
  }
  return best;
}

/** Go-to-definition: the element declared at the offset, or - when the word
 *  under the cursor is a reference - the element it names. */
export function definitionAt(
  source: string,
  projection: SysMLProjection,
  offset: number,
): SysMLElement | null {
  const containing = hoverAt(projection, offset);
  if (containing !== null && offset >= containing.nameSpan.start && offset <= containing.nameSpan.end) {
    return containing;
  }
  const { word } = wordAt(source, offset);
  if (word === '') return null;
  const normalized = word.replace(/^::/, '').toLowerCase();
  const exact = projection.elements.find((element) => element.qualifiedName.toLowerCase() === normalized);
  if (exact) return exact;
  const candidates = projection.elements.filter(
    (element) =>
      element.name.toLowerCase() === normalized ||
      element.qualifiedName.toLowerCase().endsWith(`::${normalized}`),
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/** Every relation touching the element (its references, traceability both ways). */
export function referencesOf(projection: SysMLProjection, elementId: string): SysMLRelation[] {
  return projection.relations.filter((relation) => relation.from === elementId || relation.to === elementId);
}

/** Rename driven by a cursor position instead of a query string. */
export function renameAt(
  source: string,
  projection: SysMLProjection,
  offset: number,
  newName: string,
): ReturnType<typeof renameElement> {
  const target = definitionAt(source, projection, offset);
  if (target === null) {
    return { ok: false, error: 'the cursor is not on a SysML element' };
  }
  return renameElement(source, projection, target.qualifiedName, newName);
}

// Bridge between the visual surfaces (palette, properties panel) and the
// typed source edits in sysmlEdits. The .sysml TEXT stays authoritative:
// every action reads the live document from its owning store (bundle first,
// then disk files), applies one pure edit, writes the text back, and lets
// the regular refresh/reparse path update projection, layout and
// diagnostics. No visual state is ever hand-patched.

import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useSysMLStore } from '../state/sysmlStore';
import { projectSysML } from './sysmlProjection';
import {
  addRelationStatement,
  deleteElement,
  insertElement,
  renameElement,
  type InsertElementOptions,
  type RelationVerb,
} from './sysmlEdits';

function activeDocument(): { path: string; source: string } | null {
  const ui = useUiStore.getState();
  const activeFile = ui.activeFile;
  if (activeFile === null) return null;
  const bundled = useProjectStore.getState().bundle?.files[activeFile];
  if (bundled !== undefined) return { path: activeFile, source: bundled };
  const disk = ui.diskFiles[activeFile];
  if (disk !== undefined) return { path: activeFile, source: disk };
  // Store fallback covers documents opened before this bridge existed.
  const store = useSysMLStore.getState();
  if (store.path === activeFile) return { path: activeFile, source: store.source };
  return null;
}

/** Write the edited text back to the owning store and refresh the
 *  projection through the normal path. */
function commitEditedSource(path: string, nextSource: string): void {
  const bundle = useProjectStore.getState().bundle;
  if (bundle !== null && bundle.files[path] !== undefined) {
    useProjectStore.getState().updateFiles((files) =>
      files[path] === nextSource ? files : { ...files, [path]: nextSource },
    );
  }
  const ui = useUiStore.getState();
  if (ui.diskFiles[path] !== undefined) {
    ui.updateDiskFile(path, nextSource);
  }
  useSysMLStore.getState().refresh(nextSource);
}

export type EditOutcome = { ok: true; detail: string; elementId?: string } | { ok: false; error: string };

function runEdit(
  edit: (source: string, projection: ReturnType<typeof projectSysML>) => SysMLEditLike,
): EditOutcome {
  const document = activeDocument();
  if (document === null) return { ok: false, error: 'no SysML document is open' };
  const store = useSysMLStore.getState();
  if (!store.projection || store.path !== document.path) {
    return { ok: false, error: 'the SysML projection is not ready' };
  }
  // Only the ACTIVE file's parse state blocks visual editing - a broken
  // sibling must not lock every other file's palette.
  const activeUnit = store.units.find((unit) => unit.path === document.path);
  if (activeUnit?.dirty) {
    return { ok: false, error: 'fix the parse errors before editing visually' };
  }
  const result = edit(document.source, store.projection);
  if (!result.ok) return result;
  commitEditedSource(document.path, result.source);
  return 'elementId' in result && result.elementId !== undefined
    ? { ok: true, detail: result.detail, elementId: result.elementId }
    : { ok: true, detail: result.detail };
}

type SysMLEditLike =
  | { ok: true; source: string; detail: string; elementId?: string }
  | { ok: false; error: string };

const CONTAINER_KINDS = new Set(['package', 'part', 'action', 'state', 'usecase', 'view', 'enum']);

/** First free `Base<n>` name inside the target scope. */
export function nextFreeName(
  projection: ReturnType<typeof projectSysML>,
  base: string,
  parentQualifiedName?: string,
): string {
  const taken = new Set(
    projection.elements
      .filter(
        (element) =>
          parentQualifiedName === undefined ||
          element.qualifiedName.startsWith(`${parentQualifiedName}::`),
      )
      .map((element) => element.name.toLowerCase()),
  );
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}${Date.now()}`;
}

/** Palette entry point: insert a definition/usage of a visual kind. When a
 *  container element is selected on the canvas the declaration nests into
 *  it, otherwise it lands at the model root. */
export function insertFromPalette(kind: string, declaration: 'def' | 'usage'): EditOutcome {
  const store = useSysMLStore.getState();
  if (!store.projection) return { ok: false, error: 'no SysML document is open' };
  const selected =
    store.selectedId !== null
      ? store.projection.elements.find((element) => element.id === store.selectedId)
      : undefined;
  const parent =
    selected !== undefined && CONTAINER_KINDS.has(selected.kind)
      ? selected
      : undefined;
  const baseName = kind.charAt(0).toUpperCase() + kind.slice(1);
  const options: InsertElementOptions = {
    kind,
    name: nextFreeName(store.projection, baseName, parent?.qualifiedName),
    declaration,
    ...(parent !== undefined ? { parent: parent.id } : {}),
  };
  const outcome = runEdit((source, projection) => insertElement(source, projection, options));
  if (outcome.ok && outcome.elementId !== undefined) {
    useSysMLStore.getState().select(outcome.elementId);
  }
  return outcome;
}

export function renameSelected(query: string, newName: string): EditOutcome {
  return runEdit((source, projection) => renameElement(source, projection, query, newName));
}

export function deleteSelected(query: string): EditOutcome {
  return runEdit((source, projection) => deleteElement(source, projection, query));
}

export function addRelation(verb: RelationVerb, from: string, to: string): EditOutcome {
  return runEdit((source) => addRelationStatement(source, verb, from, to));
}

/** Ctrl+C / Ctrl+V duplicate: re-inserts the same kind + declaration under
 *  the same parent with the next free name. The declaration BODY is not
 *  copied yet (v1 keeps the transaction simple); nested content is a
 *  documented follow-up. */
export function duplicateSelected(query: string): EditOutcome {
  const store = useSysMLStore.getState();
  if (!store.projection) return { ok: false, error: 'no SysML document is open' };
  const original = store.projection.elements.find((element) => element.id === query);
  if (original === undefined) return { ok: false, error: `no SysML element matches '${query}'` };
  const owner =
    original.ownerId !== undefined
      ? store.projection.elements.find((element) => element.id === original.ownerId)
      : undefined;
  const options: InsertElementOptions = {
    kind: original.kind,
    name: nextFreeName(
      store.projection,
      original.name.replace(/\d+$/, '') || original.name,
      owner?.qualifiedName,
    ),
    declaration: original.declaration === 'definition' ? 'def' : 'usage',
    ...(owner !== undefined ? { parent: owner.id } : {}),
  };
  return runEdit((source, projection) => insertElement(source, projection, options));
}

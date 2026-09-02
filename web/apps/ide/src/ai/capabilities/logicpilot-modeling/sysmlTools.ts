// AI tools for the external SysML projection. Read/layout tools edit only
// the visualization sidecar; the typed-edit tools are source-text
// transactions (sysmlEdits) that are re-verified by the parser before they
// may touch the authoritative file.

import type { AssistantTool } from '../../toolTypes';
import { useSysMLStore, type SysMLViewMode } from '../../../state/sysmlStore';
import { useProjectStore } from '../../../state/projectStore';
import { useUiStore } from '../../../state/uiStore';
import { projectSysML } from '../../../sysml/sysmlProjection';
import type { SysMLLayout } from '../../../sysml/sysmlProjection';
import {
  addRelationStatement,
  insertElement,
  renameElement,
  type RelationVerb,
} from '../../../sysml/sysmlEdits';
import { definitionAt, referencesOf } from '../../../sysml/sysmlLanguage';
import { lowerStateMachine } from '../../../sysml/sysmlLowering';
import { buildSysMLProjectIndex, resolveInIndex } from '../../../sysml/sysmlProjectIndex';
import {
  beginArtifactTransaction,
  commitArtifactTransaction,
  rollbackArtifactTransaction,
} from '../../../artifacts/artifactGraphClient';

function numberArg(args: Record<string, unknown>, key: string): number | null {
  return typeof args[key] === 'number' && Number.isFinite(args[key] as number)
    ? (args[key] as number)
    : null;
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  return typeof args[key] === 'string' && args[key].trim() !== '' ? (args[key] as string) : null;
}

/** Every .sysml source in the workspace, for project-level lookups. */
function collectSysmlSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  const bundle = useProjectStore.getState().bundle;
  for (const [path, content] of Object.entries(bundle?.files ?? {})) {
    if (/\.sysml$/i.test(path)) sources[path] = content;
  }
  for (const [path, content] of Object.entries(useUiStore.getState().diskFiles)) {
    if (/\.sysml$/i.test(path)) sources[path] = content;
  }
  return sources;
}

/** Read the CURRENT authoritative text straight from the owning store
 *  (bundle first, then disk files) - never from sysmlStore.source, which
 *  only updates when the workspace effect re-projects on the next render. */
function currentSysMLSource(): string | null {
  const activeFile = useUiStore.getState().activeFile;
  if (!activeFile) return null;
  const bundle = useProjectStore.getState().bundle;
  const bundled = bundle?.files[activeFile];
  if (bundled !== undefined) return bundled;
  return useUiStore.getState().diskFiles[activeFile] ?? null;
}

function persistLayoutEdit(
  path: string,
  before: SysMLLayout,
  after: SysMLLayout,
  operationType: string,
  restore: () => void,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  const success = { ok: true, persisted: true };
  if (typeof window === 'undefined') return success;
  return (async () => {
    let pending;
    try {
      pending = await beginArtifactTransaction({
        artifactId: `layout:${path}`,
        artifactKind: 'view-layout',
        operationType,
        payload: { path, before, after },
      });
      await commitArtifactTransaction(pending);
      return success;
    } catch (error) {
      restore();
      if (pending) {
        await rollbackArtifactTransaction(pending, 'sysml-layout-commit-failed').catch(
          () => undefined,
        );
      }
      return {
        ok: false,
        error: `artifact transaction could not be committed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  })();
}

/** Persist edited source to whichever store owns the open document. The
 *  SysMLWorkspace effect re-projects automatically; broken output would be
 *  caught by parseDirty retention, but we refuse before writing anyway. */
function writeSysMLSource(nextSource: string): { ok: false; error: string } | null {
  const state = useSysMLStore.getState();
  const activeFile = useUiStore.getState().activeFile;
  if (!state.path || !state.projection || !activeFile) {
    return { ok: false, error: 'no SysML document is open' };
  }
  if (activeFile !== state.path) {
    return { ok: false, error: 'the active file does not match the open projection' };
  }
  const bundle = useProjectStore.getState().bundle;
  if (bundle && bundle.files[activeFile] !== undefined) {
    useProjectStore.getState().updateFiles((files) => ({
      ...files,
      [activeFile]: nextSource,
    }));
    return null;
  }
  useUiStore.getState().updateDiskFile(activeFile, nextSource);
  return null;
}

/** Shared transaction tail: re-parse the candidate source and refuse the
 *  write when it would introduce error-level diagnostics (verified patch). */
type SysmlEdit =
  { ok: true; source: string; detail: string; elementId?: string } | { ok: false; error: string };

function commitEdit(edit: SysmlEdit): Record<string, unknown> | Promise<Record<string, unknown>> {
  if (!edit.ok) {
    return { ok: false, error: edit.error };
  }
  const nextProjection = projectSysML(edit.source);
  const newError = nextProjection.diagnostics.find((d) => d.severity === 'error');
  if (newError !== undefined) {
    return {
      ok: false,
      error:
        `edit rejected: generated source fails to parse (${newError.code}` +
        `${newError.line ? ` line ${newError.line}` : ''}) - source left unchanged`,
    };
  }
  const activeFile = useUiStore.getState().activeFile;
  const previousSource = currentSysMLSource();
  if (!activeFile || previousSource === null) {
    return { ok: false, error: 'no SysML source is available to edit' };
  }
  // Node/unit-test callers have no app server and historically expect this
  // tool to return synchronously. The browser path below adds persistence
  // without changing the pure parser/edit contract.
  if (typeof window === 'undefined') {
    const written = writeSysMLSource(edit.source);
    if (written !== null) return written;
    return {
      ok: true,
      detail: edit.detail,
      elementId: edit.elementId ?? null,
      warnings: nextProjection.diagnostics.filter((d) => d.severity === 'warning'),
    };
  }
  return commitEditPersisted(edit, nextProjection, activeFile, previousSource);
}

async function commitEditPersisted(
  edit: Extract<SysmlEdit, { ok: true }>,
  nextProjection: ReturnType<typeof projectSysML>,
  activeFile: string,
  previousSource: string,
): Promise<Record<string, unknown>> {
  let pending;
  try {
    pending = await beginArtifactTransaction({
      artifactId: `sysml:${activeFile}`,
      artifactKind: 'source-document',
      operationType: 'sysml-typed-edit',
      payload: {
        path: activeFile,
        beforeSource: previousSource,
        afterSource: edit.source,
        detail: edit.detail,
        elementId: edit.elementId ?? null,
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: `artifact transaction could not be prepared: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const written = writeSysMLSource(edit.source);
  if (written !== null) {
    await rollbackArtifactTransaction(pending, 'sysml-source-write-failed').catch(() => undefined);
    return written;
  }
  try {
    await commitArtifactTransaction(pending);
  } catch (error) {
    // Do not overwrite a concurrent user edit made while the server request
    // was in flight; only restore the exact source this operation wrote.
    if (currentSysMLSource() === edit.source) writeSysMLSource(previousSource);
    await rollbackArtifactTransaction(pending, 'sysml-typed-edit-commit-failed').catch(
      () => undefined,
    );
    return {
      ok: false,
      error: `artifact transaction could not be committed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return {
    ok: true,
    detail: edit.detail,
    elementId: edit.elementId ?? null,
    warnings: nextProjection.diagnostics.filter((d) => d.severity === 'warning'),
  };
}

const ELEMENT_KIND_ENUM = [
  'package',
  'part',
  'item',
  'port',
  'interface',
  'requirement',
  'action',
  'state',
  'analysis',
  'verification',
  'attribute',
  'constraint',
  'usecase',
  'view',
  'viewpoint',
  'enum',
  'occurrence',
  'stakeholder',
  'flow',
] as const;

export const SYSML_TOOLS: readonly AssistantTool[] = [
  {
    name: 'inspect_sysml_projection',
    executionMode: 'parallel',
    description: 'Inspect the currently open external SysML visual projection and its warnings.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.layout)
        return { ok: false, error: 'no SysML projection is open' };
      const layout = state.layout;
      return {
        ok: true,
        path: state.path,
        sourceHash: state.projection.sourceHash,
        viewMode: state.viewMode,
        elements: state.projection.elements.map((element) => ({
          id: element.id,
          kind: element.kind,
          name: element.name,
          qualifiedName: element.qualifiedName,
          ownerId: element.ownerId ?? null,
          line: element.span.line,
          position: layout.positions[element.id] ?? null,
        })),
        relations: state.projection.relations,
        diagnostics: state.projection.diagnostics,
        projectFiles: Object.keys(collectSysmlSources()),
      };
    },
  },
  {
    name: 'auto_layout_sysml_projection',
    description: 'Automatically arrange the currently open SysML structure/relationship diagram.',
    parameters: {},
    validate: () => null,
    execute: () => {
      const state = useSysMLStore.getState();
      if (!state.projection) return { ok: false, error: 'no SysML projection is open' };
      const before = state.layout;
      state.autoLayout();
      const after = useSysMLStore.getState().layout;
      const persisted =
        before && after && state.path
          ? persistLayoutEdit(state.path, before, after, 'sysml-layout-auto', () => {
              if (useSysMLStore.getState().layout === after) useSysMLStore.getState().undo();
            })
          : { ok: true, persisted: false };
      if (persisted instanceof Promise)
        return persisted.then((result) => ({
          ...result,
          message: 'SysML projection layout updated',
          elementCount: state.projection!.elements.length,
        }));
      return {
        ...persisted,
        message: 'SysML projection layout updated',
        elementCount: state.projection.elements.length,
      };
    },
  },
  {
    name: 'set_sysml_projection_view',
    description:
      'Focus the SysML projection on all, structure, requirements, behavior, or traceability elements.',
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['all', 'structure', 'requirements', 'behavior', 'traceability'],
      },
    },
    validate: (args) => {
      const mode = args.mode;
      return mode === 'all' ||
        mode === 'structure' ||
        mode === 'requirements' ||
        mode === 'behavior' ||
        mode === 'traceability'
        ? null
        : "mode must be one of 'all', 'structure', 'requirements', 'behavior', 'traceability'";
    },
    execute: (args) => {
      const mode = args.mode as SysMLViewMode;
      const state = useSysMLStore.getState();
      if (!state.projection) return { ok: false, error: 'no SysML projection is open' };
      state.setViewMode(mode);
      return { ok: true, viewMode: mode };
    },
  },
  {
    name: 'focus_sysml_element',
    description:
      'Select a SysML element by stable ID, name, or qualified name and reveal it in the projection.',
    parameters: { query: { type: 'string', required: true } },
    validate: (args) => {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const projection = useSysMLStore.getState().projection;
      if (!projection) return 'no SysML projection is open';
      if (!query) return 'query must be a non-empty string';
      const normalized = query.toLowerCase();
      const found = projection.elements.find(
        (element) =>
          element.id.toLowerCase() === normalized ||
          element.name.toLowerCase() === normalized ||
          element.qualifiedName.toLowerCase() === normalized,
      );
      return found ? null : `no SysML element matches '${query}'`;
    },
    execute: (args) => {
      const query = (args.query as string).trim().toLowerCase();
      const projection = useSysMLStore.getState().projection;
      if (!projection) return { ok: false, error: 'no SysML projection is open' };
      const found = projection.elements.find(
        (element) =>
          element.id.toLowerCase() === query ||
          element.name.toLowerCase() === query ||
          element.qualifiedName.toLowerCase() === query,
      );
      if (!found) return { ok: false, error: `no SysML element matches '${args.query as string}'` };
      useSysMLStore.getState().select(found.id);
      return { ok: true, element: found };
    },
  },
  {
    name: 'move_sysml_element',
    description: 'Move one SysML visual element in the current projection without changing source.',
    parameters: {
      elementId: { type: 'string', required: true },
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
    },
    validate: (args) => {
      const id = typeof args.elementId === 'string' ? args.elementId : null;
      const x = numberArg(args, 'x');
      const y = numberArg(args, 'y');
      const state = useSysMLStore.getState();
      if (!state.projection) return 'no SysML projection is open';
      if (!id || !state.projection.elements.some((element) => element.id === id))
        return 'elementId is not a visible SysML element';
      if (x === null || y === null || x < 0 || y < 0)
        return 'x and y must be non-negative finite numbers';
      return null;
    },
    execute: (args) => {
      const id = args.elementId as string;
      const x = numberArg(args, 'x')!;
      const y = numberArg(args, 'y')!;
      const state = useSysMLStore.getState();
      const before = state.layout;
      state.checkpoint();
      state.move(id, { x, y });
      const after = useSysMLStore.getState().layout;
      if (!before || !after || !state.path) return { ok: true, elementId: id, position: { x, y } };
      const persisted = persistLayoutEdit(state.path, before, after, 'sysml-layout-move', () => {
        if (useSysMLStore.getState().layout === after) useSysMLStore.getState().undo();
      });
      if (persisted instanceof Promise)
        return persisted.then((result) => ({ ...result, elementId: id, position: { x, y } }));
      return { ...persisted, elementId: id, position: { x, y } };
    },
  },
  {
    name: 'add_sysml_element',
    description:
      'Insert one typed SysML declaration (optionally nested in a parent block). ' +
      `Kind is one of: ${ELEMENT_KIND_ENUM.join(', ')}.`,
    parameters: {
      kind: { type: 'string', required: true, enum: ELEMENT_KIND_ENUM },
      name: { type: 'string', required: true },
      declaration: { type: 'string', enum: ['def', 'usage'] },
      parent: { type: 'string' },
    },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.path) return 'no SysML projection is open';
      if (stringArg(args, 'name') === null) return 'name must be a non-empty identifier';
      const declaration = args.declaration;
      if (declaration !== undefined && declaration !== 'def' && declaration !== 'usage') {
        return "declaration must be 'def' or 'usage'";
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const source = currentSysMLSource();
      if (source === null) {
        return { ok: false, error: 'no SysML source is available to edit' };
      }
      return commitEdit(
        insertElement(source, state.projection!, {
          kind: stringArg(args, 'kind')!,
          name: stringArg(args, 'name')!,
          declaration:
            args.declaration === 'def' ? 'def' : args.declaration === 'usage' ? 'usage' : undefined,
          parent: stringArg(args, 'parent') ?? undefined,
        }),
      );
    },
  },
  {
    name: 'rename_sysml_element',
    description:
      'Rename one SysML element by editing exactly its identifier token in the source. ' +
      'Children keep resolving - textual nesting carries no parent names.',
    parameters: {
      query: { type: 'string', required: true },
      newName: { type: 'string', required: true },
    },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.path) return 'no SysML projection is open';
      if (stringArg(args, 'query') === null) return 'query must name the element to rename';
      if (stringArg(args, 'newName') === null) return 'newName must be a non-empty identifier';
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const source = currentSysMLSource();
      if (source === null) {
        return { ok: false, error: 'no SysML source is available to edit' };
      }
      return commitEdit(
        renameElement(
          source,
          state.projection!,
          stringArg(args, 'query')!,
          stringArg(args, 'newName')!,
        ),
      );
    },
  },
  {
    name: 'connect_sysml_elements',
    description:
      'Append one typed relation statement between two elements: satisfy/verify ' +
      '(requirement traceability), trace, connect, allocate or bind.',
    parameters: {
      verb: {
        type: 'string',
        required: true,
        enum: ['satisfy', 'verify', 'trace', 'connect', 'allocate', 'bind'],
      },
      from: { type: 'string', required: true },
      to: { type: 'string', required: true },
    },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.path) return 'no SysML projection is open';
      const verb = args.verb;
      if (
        typeof verb !== 'string' ||
        !['satisfy', 'verify', 'trace', 'connect', 'allocate', 'bind'].includes(verb)
      ) {
        return "verb must be one of 'satisfy', 'verify', 'trace', 'connect', 'allocate', 'bind'";
      }
      if (stringArg(args, 'from') === null || stringArg(args, 'to') === null) {
        return 'from and to must reference existing elements';
      }
      return null;
    },
    execute: (args) => {
      const source = currentSysMLSource();
      if (source === null) {
        return { ok: false, error: 'no SysML source is available to edit' };
      }
      return commitEdit(
        addRelationStatement(
          source,
          args.verb as RelationVerb,
          stringArg(args, 'from')!,
          stringArg(args, 'to')!,
        ),
      );
    },
  },
  {
    name: 'find_sysml_definition',
    description:
      'Resolve what a SysML name or cursor reference points to. Pass `query` ' +
      '(name/qualified name) or `line` to inspect that line.',
    parameters: {
      query: { type: 'string' },
      line: { type: 'number' },
    },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection || !state.source) return 'no SysML projection is open';
      if (stringArg(args, 'query') === null && numberArg(args, 'line') === null) {
        return 'provide a query or a line number';
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      let offset: number;
      if (typeof args.query === 'string') {
        // Approximate the first occurrence of the token for span reporting.
        const idx = state.source.indexOf(stringArg(args, 'query')!);
        offset = idx === -1 ? 0 : idx;
      } else {
        const lines = state.source.split(/\r?\n/);
        const line = Math.min(Math.max(1, numberArg(args, 'line') ?? 1), lines.length);
        offset = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
      }
      let found = definitionAt(state.source, state.projection!, offset);
      let file: string | null = state.path;
      if (found === null) {
        // Project-wide fallback: other .sysml files may declare it.
        const word =
          typeof args.query === 'string'
            ? stringArg(args, 'query')!
            : (state.source.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_.:]*/)?.[0] ?? '');
        const hit = resolveInIndex(buildSysMLProjectIndex(collectSysmlSources()), word);
        if (hit !== null) {
          found = hit.element;
          file = hit.path;
        }
      }
      if (found === null) return { ok: false, error: 'no SysML element resolves at that position' };
      return {
        ok: true,
        file,
        id: found.id,
        kind: found.kind,
        qualifiedName: found.qualifiedName,
        declaration: found.declaration,
        line: found.span.line,
        owner: found.ownerId ?? null,
      };
    },
  },
  {
    name: 'find_sysml_references',
    description:
      'List every extracted relation touching one SysML element (traceability both ways).',
    parameters: { query: { type: 'string', required: true } },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection) return 'no SysML projection is open';
      const query = stringArg(args, 'query');
      if (query === null) return 'query must be a non-empty string';
      const normalized = query.toLowerCase();
      if (
        !state.projection.elements.some(
          (element) =>
            element.id.toLowerCase() === normalized ||
            element.name.toLowerCase() === normalized ||
            element.qualifiedName.toLowerCase() === normalized,
        )
      ) {
        return `no SysML element matches '${query}'`;
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const projection = state.projection!;
      const normalized = stringArg(args, 'query')!.toLowerCase();
      const element = projection.elements.find(
        (entry) =>
          entry.id.toLowerCase() === normalized ||
          entry.name.toLowerCase() === normalized ||
          entry.qualifiedName.toLowerCase() === normalized,
      )!;
      const relations = referencesOf(projection, element.id);
      return {
        ok: true,
        element: { id: element.id, qualifiedName: element.qualifiedName },
        references: relations.map((relation) => ({
          kind: relation.kind,
          label: relation.label,
          line: relation.line,
          from:
            projection.elements.find((e) => e.id === relation.from)?.qualifiedName ?? relation.from,
          to: projection.elements.find((e) => e.id === relation.to)?.qualifiedName ?? relation.to,
        })),
        count: relations.length,
      };
    },
  },
  {
    name: 'query_sysml_evidence',
    description:
      'Query the execution evidence journal of the open SysML document: ' +
      'recent runs bound to the exact revisions that produced them. ' +
      'Optional filters: target (name/qualified name) and outcome.',
    parameters: {
      target: { type: 'string' },
      outcome: { type: 'string', enum: ['ok', 'failed'] },
      limit: { type: 'number' },
    },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.path) return 'no SysML document is open';
      const outcome = args.outcome;
      if (outcome !== undefined && outcome !== 'ok' && outcome !== 'failed') {
        return "outcome must be 'ok' or 'failed'";
      }
      const limit = args.limit;
      if (limit !== undefined && (typeof limit !== 'number' || limit < 1 || limit > 20)) {
        return 'limit must be a number between 1 and 20';
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const targetQuery = stringArg(args, 'target')?.toLowerCase();
      const outcome = args.outcome as 'ok' | 'failed' | undefined;
      const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 10;
      const filtered = state.evidence.filter((record) => {
        if (
          targetQuery !== undefined &&
          !record.targetQualifiedName.toLowerCase().includes(targetQuery) &&
          record.targetId.toLowerCase() !== targetQuery
        ) {
          return false;
        }
        if (outcome === 'ok' && !record.ok) return false;
        if (outcome === 'failed' && record.ok) return false;
        return true;
      });
      return {
        ok: true,
        total: state.evidence.length,
        matched: filtered.length,
        runs: filtered.slice(0, limit).map((record) => ({
          id: record.id,
          target: record.targetQualifiedName,
          kind: record.targetKind,
          runOk: record.ok,
          revision: record.revision,
          startedAt: record.startedAt,
          durationMs: record.durationMs,
          stepCount: record.steps?.length ?? 0,
          result: record.result ?? null,
          error: record.error ?? null,
          conformanceVersion: record.conformanceVersion,
        })),
      };
    },
  },
  {
    name: 'explain_sysml_run',
    description:
      'Return the full execution trace of one evidence record by id, including ' +
      'per-step source lines and clock times - use it after query_sysml_evidence.',
    parameters: { evidenceId: { type: 'string', required: true } },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.path) return 'no SysML document is open';
      const id = stringArg(args, 'evidenceId');
      if (id === null) return 'evidenceId must be a non-empty string';
      if (!state.evidence.some((record) => record.id === id)) {
        return `no evidence record with id '${id}' (use query_sysml_evidence first)`;
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const record = state.evidence.find((entry) => entry.id === stringArg(args, 'evidenceId'))!;
      return {
        ok: true,
        target: record.targetQualifiedName,
        kind: record.targetKind,
        revision: record.revision,
        runOk: record.ok,
        startedAt: record.startedAt,
        durationMs: record.durationMs,
        conformanceVersion: record.conformanceVersion,
        steps: record.steps ?? [],
        result: record.result ?? null,
        error: record.error ?? null,
      };
    },
  },
  {
    name: 'lower_sysml_state_machine',
    description:
      'Lower one SysML state definition into equivalent .lp statechart DSL ' +
      '(kernel StatechartRuntime). Refuses faithfully-unsupported constructs ' +
      '(absolute triggers, nesting, trigger-less transitions) with stable SLxxxx codes.',
    parameters: { query: { type: 'string', required: true } },
    validate: (args) => {
      const state = useSysMLStore.getState();
      if (!state.projection) return 'no SysML projection is open';
      const query = stringArg(args, 'query');
      if (query === null) return 'query must name a state definition';
      const normalized = query.toLowerCase();
      const target = state.projection.elements.find(
        (element) =>
          element.id.toLowerCase() === normalized ||
          element.name.toLowerCase() === normalized ||
          element.qualifiedName.toLowerCase() === normalized,
      );
      if (target === undefined) return `no SysML element matches '${query}'`;
      if (target.kind !== 'state' || target.declaration !== 'definition') {
        return 'lowering target must be a `state def` element';
      }
      return null;
    },
    execute: (args) => {
      const state = useSysMLStore.getState();
      const query = stringArg(args, 'query')!.toLowerCase();
      const target = state.projection!.elements.find(
        (element) =>
          element.id.toLowerCase() === query ||
          element.name.toLowerCase() === query ||
          element.qualifiedName.toLowerCase() === query,
      )!;
      const result = lowerStateMachine(state.source, state.projection!, target.id);
      return {
        ok: result.ok,
        modelName: result.modelName || null,
        entryState: result.entryState,
        dsl: result.dsl || null,
        diagnostics: result.diagnostics,
      };
    },
  },
];

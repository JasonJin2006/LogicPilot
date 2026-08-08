// Project-format-v2 sync layer (§7): the two projections between the
// canonical in-memory model and the on-disk files.
//
//   load(files)  : parse each container .lp, expand instance references,
//                  read the layout files  -> canonical document + diagnostics
//   save(canonical): structure -> container .lp files (inline subtrees,
//                  instance references in the parent), layout -> .canvas.json
//
// Error families: LP2xxx structure parsing, LP3xxx references, LP4xxx layout,
// LP5xxx sync conflicts (external changes).

import { parseDsl } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import {
  DEFAULT_MODEL_PATH,
  createProjectBundle,
  mergeCanvasSplit,
  mergeModelSourceChecked,
  projectToDocument,
  sceneUid,
  sceneUidOf,
  splitModelSource,
  MODEL_SCENE_DIR,
  type ProjectBundle,
  type SyncDiagnostic,
} from './project';

export type { SyncDiagnostic } from './project';

export interface LoadProjectResult {
  ok: boolean;
  document?: ModelDocument;
  error?: string;
  diagnostics: SyncDiagnostic[];
}

/** Load a project bundle into the canonical document: expand instances,
 *  parse the full grammar, apply the layout and collect diagnostics. */
export function loadProject(bundle: ProjectBundle): LoadProjectResult {
  const result = projectToDocument(bundle);
  return {
    ok: result.ok,
    document: result.document,
    error: result.error,
    diagnostics: result.diagnostics ?? [],
  };
}

export interface SaveProjectResult {
  bundle: ProjectBundle;
  files: Record<string, string>;
  diagnostics: SyncDiagnostic[];
}

const emitsToDsl = (node: ModelDocument['nodes'][number]): boolean =>
  node.library === undefined || node.library === 'process' || node.library === 'statechart';

function structureSignature(document: ModelDocument): string[] {
  const emitted = document.nodes.filter(emitsToDsl);
  const byId = new Map(emitted.map((node) => [node.id, node]));
  const nodes = emitted.map((node) =>
    JSON.stringify(['node', node.kind, node.name, node.container ?? '']),
  );
  const edges = document.edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    return [
      JSON.stringify([
        'edge',
        from.container ?? '',
        from.name,
        edge.fromPort ?? 'out',
        to.container ?? '',
        to.name,
        edge.toPort ?? 'in',
      ]),
    ];
  });
  return [...nodes, ...edges].sort();
}

/** Serialize the canonical document back into files: structure -> main.lp
 *  plus one scene per container, layout -> the canvas file. A round-trip
 *  check guards against dropping members on save (LP4001). */
export function saveProject(
  document: ModelDocument,
  current: ProjectBundle | null,
): SaveProjectResult {
  const diagnostics: SyncDiagnostic[] = [];
  const emittedNames = new Map<string, number>();
  for (const node of document.nodes.filter(emitsToDsl)) {
    emittedNames.set(node.name, (emittedNames.get(node.name) ?? 0) + 1);
  }
  for (const [name, count] of emittedNames) {
    if (count > 1) {
      diagnostics.push({
        code: 'LP4002',
        severity: 'error',
        message:
          `cannot save ${count} DSL members named '${name}': member references ` +
          'currently require globally unique names',
      });
    }
  }

  const base = createProjectBundle(document);
  const split = splitModelSource(base.files[DEFAULT_MODEL_PATH] ?? '');
  const project = mergeCanvasSplit(base, split, current);
  // Stable container identities: every scene file records its uid and the
  // manifest maps uid -> path so renames can be repaired.
  const containerIds: Record<string, string> = {};
  for (const [path, content] of Object.entries(project.files)) {
    if (path.startsWith(`${MODEL_SCENE_DIR}/`)) {
      containerIds[sceneUidOf(content) ?? sceneUid(path)] = path;
    }
  }
  project.manifest.containerIds = containerIds;

  // Save-time round-trip guard: the generated DSL must parse back to the
  // same scoped members and couplings, otherwise saving would silently alter
  // model structure.
  const merged = mergeModelSourceChecked(
    project.files[DEFAULT_MODEL_PATH] ?? '',
    project.files,
    project.manifest.modelParts ?? [],
  );
  const reparsed = parseDsl(merged.source);
  if (!reparsed.ok) {
    diagnostics.push({
      code: 'LP4001',
      severity: 'error',
      message: `save produced unparseable DSL: ${reparsed.error ?? 'unknown error'}`,
      path: DEFAULT_MODEL_PATH,
    });
  } else {
    const before = structureSignature(document);
    const after = structureSignature(reparsed.document);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diagnostics.push({
        code: 'LP4001',
        severity: 'error',
        message: 'save would change the scoped member or coupling structure',
      });
    }
  }
  return { bundle: project, files: project.files, diagnostics };
}

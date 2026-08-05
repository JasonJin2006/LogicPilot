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

import { generateDsl, parseDsl } from '@logicpilot/editor';
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

/** Serialize the canonical document back into files: structure -> main.lp
 *  plus one scene per container, layout -> the canvas file. A round-trip
 *  check guards against dropping members on save (LP4001). */
export function saveProject(
  document: ModelDocument,
  current: ProjectBundle | null,
): SaveProjectResult {
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

  const diagnostics: SyncDiagnostic[] = [];
  // Save-time round-trip guard: the generated DSL must parse back to the
  // same member set, otherwise saving would silently drop model content.
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
    const before = new Set(document.nodes.map((node) => `${node.kind}:${node.name}`));
    const after = new Set(
      reparsed.document.nodes.map((node) => `${node.kind}:${node.name}`),
    );
    for (const key of before) {
      if (!after.has(key)) {
        diagnostics.push({
          code: 'LP4001',
          severity: 'error',
          message: `save would drop member '${key}' from the model`,
        });
      }
    }
  }
  return { bundle: project, files: project.files, diagnostics };
}

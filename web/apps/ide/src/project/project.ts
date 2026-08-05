// LogicPilot project serialization: a single-file `*.lpproj` bundle that
// carries the model source (DSL), the canvas presentation (layout) and the
// manifest. The bundle maps 1:1 onto the canonical on-disk directory layout
// (docs/specs/project-format.md) so it can later be unpacked to disk without
// data loss.

import { createDocument, generateDsl, parseDsl } from '@logicpilot/editor';
import type { ModelDocument, ModelEdge, ModelNode } from '@logicpilot/editor';
import { insertMember, parseProjectMembers, parseProjectSource } from './projectTree';

export const PROJECT_SCHEMA = 'logicpilot.project';
export const PROJECT_VERSION = 1;
export const DEFAULT_MODEL_PATH = 'model/main.lp';
export const DEFAULT_PRESENTATION_PATH = 'presentation/main.canvas.json';
/** Kind-based leaf part files. Container nodes (process/agent/atomic/...)
 *  are split into their own scene files under model/scenes/ so each
 *  container Node is a file (docs/specs/node-scene-model.md). */
export const MODEL_PART_PATHS = [
  'model/resources.lp',
  'model/experiments.lp',
] as const;
export const MODEL_SCENE_DIR = 'model/scenes';
export const DEFAULT_SEED = 42;
export const DEFAULT_SCHEMA_VERSION = 2;

export interface ProjectManifest {
  name: string;
  model: string;
  presentation: string;
  defaultExperiment: string | null;
  /** Per-concern fragment files merged into the model at compile time. */
  modelParts?: string[];
  defaults: { seed: number; schemaVersion: number };
}

export interface ProjectBundle {
  schema: typeof PROJECT_SCHEMA;
  format: 'bundle';
  version: typeof PROJECT_VERSION;
  manifest: ProjectManifest;
  files: Record<string, string>;
}

/** The on-disk file set for a project: logicpilot.json (the manifest with
 *  the schema marker) plus the bundled source files (model/main.lp and
 *  presentation/main.canvas.json). */
export function projectToDiskFiles(bundle: ProjectBundle): Record<string, string> {
  return {
    'logicpilot.json': `${JSON.stringify(
      { schema: bundle.schema, version: bundle.version, ...bundle.manifest },
      null,
      2,
    )}\n`,
    ...bundle.files,
  };
}

/** Create a fresh, empty project bundle (File > New Project). */
export function createProject(name: string, seed = DEFAULT_SEED): ProjectBundle {
  const bundle = createProjectBundle(createDocument(name));
  bundle.manifest.defaults.seed = seed;
  bundle.manifest.modelParts = [...MODEL_PART_PATHS];
  bundle.files[DEFAULT_MODEL_PATH] = `model ${name} {\n}\n`;
  for (const part of MODEL_PART_PATHS) {
    const label = part.split('/').pop()!.replace(/\.lp$/, '');
    bundle.files[part] = `// ${label} blocks\n`;
  }
  return bundle;
}

/** Split a single-model source into the main file, kind-based leaf parts and
 *  one scene file per container node. Members with no part stay in main.lp. */
export function splitModelSource(source: string): Record<string, string> {
  const parsed = parseProjectSource(source);
  const out: Record<string, string> = {};
  if (!parsed.ok || !parsed.model) {
    out[DEFAULT_MODEL_PATH] = source;
    return out;
  }
  const resources: string[] = [];
  const experiments: string[] = [];
  const scenes = new Map<string, string[]>();
  const remaining: string[] = [];
  for (const member of parsed.model.members) {
    // Keep the member's leading indentation (the span starts at the kind
    // token, so slice from the start of its line).
    const lineStart = source.lastIndexOf('\n', member.span.start - 1) + 1;
    const text = source.slice(lineStart, member.span.end).trimEnd();
    if (member.isLeaf) {
      remaining.push(text);
    } else if (member.kind === 'resource') {
      resources.push(text);
    } else if (member.kind === 'experiment') {
      experiments.push(text);
    } else if (['process', 'agent', 'atomic', 'continuous'].includes(member.kind)) {
      // One scene file per container node (the file is that node's subgraph).
      const blocks = scenes.get(member.name) ?? [];
      blocks.push(text);
      scenes.set(member.name, blocks);
    } else {
      remaining.push(text);
    }
  }
  const mainBody = remaining.length > 0 ? `\n${remaining.join('\n')}` : '';
  out[DEFAULT_MODEL_PATH] = `model ${parsed.model.name} {${mainBody}\n}\n`;
  if (resources.length > 0) {
    out['model/resources.lp'] = `${resources.join('\n')}\n`;
  }
  if (experiments.length > 0) {
    out['model/experiments.lp'] = `${experiments.join('\n')}\n`;
  }
  for (const [name, blocks] of scenes) {
    out[`${MODEL_SCENE_DIR}/${name}.lp`] = `${blocks.join('\n')}\n`;
  }
  return out;
}

/** Identify the container a scene file holds (process Flow in
 *  model/scenes/Flow.lp); null for non-scene files. */
export function sceneContainerFromFile(
  path: string,
  source: string,
): { kind: string; name: string } | null {
  if (!path.startsWith(`${MODEL_SCENE_DIR}/`)) {
    return null;
  }
  const parsed = parseProjectMembers(source);
  const first = parsed.ok ? (parsed.members ?? []).find((member) => !member.isLeaf) : undefined;
  return first ? { kind: first.kind, name: first.name } : null;
}

/** Part files present in `files` (kind-based + scenes), excluding main.lp. */
export function collectModelParts(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((path) => path.startsWith('model/') && path !== DEFAULT_MODEL_PATH)
    .sort();
}

/** Combine a fresh canvas-derived bundle with the current one on Save: the
 *  canvas owns resources/process (via `split`), while existing part files it
 *  does not write (experiments, scenes) are preserved from `current`. */
export function mergeCanvasSplit(
  base: ProjectBundle,
  split: Record<string, string>,
  current: ProjectBundle | null,
): ProjectBundle {
  const files = { ...base.files, ...split };
  for (const part of current?.manifest.modelParts ?? []) {
    if (files[part] === undefined && current?.files[part] !== undefined) {
      files[part] = current.files[part];
    }
  }
  return {
    ...base,
    files,
    manifest: { ...base.manifest, modelParts: collectModelParts(files) },
  };
}

/** Merge the main model source with its part fragments (parts are stored
 *  already indented as they appear inside the model body). */
export function mergeModelSource(
  mainSource: string,
  files: Record<string, string>,
  partPaths?: string[],
): string {
  const parsed = parseProjectSource(mainSource);
  if (!parsed.ok || !parsed.model) {
    return mainSource;
  }
  const chunks = (partPaths ?? collectModelParts(files))
    .map((path) => files[path])
    .filter((content) => content !== undefined && content.trim() !== '')
    .join('\n');
  if (chunks === '') {
    return mainSource;
  }
  return insertMember(mainSource, parsed.model.bodyClose, '', `${chunks.trimEnd()}\n`);
}

/** Serialize the current canvas document into a project bundle. The DSL is
 *  derived from the document (positions are kept in the canvas file). */
export function createProjectBundle(document: ModelDocument): ProjectBundle {
  const canvas = JSON.stringify(document, null, 2);
  return {
    schema: PROJECT_SCHEMA,
    format: 'bundle',
    version: PROJECT_VERSION,
    manifest: {
      name: document.name || 'Model',
      model: DEFAULT_MODEL_PATH,
      presentation: DEFAULT_PRESENTATION_PATH,
      defaultExperiment: null,
      defaults: { seed: DEFAULT_SEED, schemaVersion: DEFAULT_SCHEMA_VERSION },
    },
    files: {
      [DEFAULT_MODEL_PATH]: generateDsl(document),
      [DEFAULT_PRESENTATION_PATH]: canvas,
    },
  };
}

export function bundleToJson(bundle: ProjectBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export interface BundleParseResult {
  ok: boolean;
  bundle?: ProjectBundle;
  error?: string;
}

export function parseProjectBundle(text: string): BundleParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const bundle = parsed as Partial<ProjectBundle> | null;
  if (bundle === null || bundle.schema !== PROJECT_SCHEMA) {
    return {
      ok: false,
      error: `not a LogicPilot project (schema ${String(bundle?.schema)})`,
    };
  }
  if (bundle.format !== 'bundle') {
    return { ok: false, error: `unsupported project format '${String(bundle.format)}'` };
  }
  const manifest = bundle.manifest;
  if (manifest === undefined || typeof manifest.name !== 'string') {
    return { ok: false, error: 'project manifest is missing or invalid' };
  }
  if (bundle.files === undefined || typeof bundle.files !== 'object' || Array.isArray(bundle.files)) {
    return { ok: false, error: 'project has no files table' };
  }
  return {
    ok: true,
    bundle: {
      schema: PROJECT_SCHEMA,
      format: 'bundle',
      version: bundle.version ?? PROJECT_VERSION,
      manifest: {
        name: manifest.name,
        model: typeof manifest.model === 'string' ? manifest.model : DEFAULT_MODEL_PATH,
        presentation:
          typeof manifest.presentation === 'string'
            ? manifest.presentation
            : DEFAULT_PRESENTATION_PATH,
        defaultExperiment:
          typeof manifest.defaultExperiment === 'string' ? manifest.defaultExperiment : null,
        modelParts: Array.isArray(manifest.modelParts)
          ? manifest.modelParts.filter((part): part is string => typeof part === 'string')
          : [],
        defaults: {
          seed: typeof manifest.defaults?.seed === 'number' ? manifest.defaults.seed : DEFAULT_SEED,
          schemaVersion:
            typeof manifest.defaults?.schemaVersion === 'number'
              ? manifest.defaults.schemaVersion
              : DEFAULT_SCHEMA_VERSION,
        },
      },
      files: bundle.files as Record<string, string>,
    },
  };
}

export interface DocumentLoadResult {
  ok: boolean;
  document?: ModelDocument;
  error?: string;
}

/** Open a project bundle: prefer the canvas presentation (layout + ids +
 *  params), fall back to parsing the model source. */
export function projectToDocument(bundle: ProjectBundle): DocumentLoadResult {
  const canvasText = bundle.files[bundle.manifest.presentation];
  if (canvasText !== undefined) {
    const document = parseCanvas(canvasText, bundle.manifest.name);
    if (document !== null) {
      return { ok: true, document };
    }
  }
  const source = bundle.files[bundle.manifest.model];
  if (source !== undefined) {
    const parsed = parseDsl(source);
    if (parsed.ok) {
      return { ok: true, document: parsed.document };
    }
    return { ok: false, error: parsed.error ?? 'invalid model source' };
  }
  return { ok: false, error: `project is missing '${bundle.manifest.model}'` };
}

function parseCanvas(text: string, fallbackName: string): ModelDocument | null {
  try {
    const raw = JSON.parse(text) as { name?: unknown; nodes?: unknown; edges?: unknown };
    if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.nodes)) {
      return null;
    }
    const nodes: ModelNode[] = [];
    for (const entry of raw.nodes) {
      const node = entry as Partial<ModelNode> | null;
      if (node === null || typeof node !== 'object' || typeof node.id !== 'string') {
        continue;
      }
      nodes.push({
        id: node.id,
        kind: (node.kind ?? 'source') as ModelNode['kind'],
        name: typeof node.name === 'string' ? node.name : node.id,
        x: typeof node.x === 'number' ? node.x : 0,
        y: typeof node.y === 'number' ? node.y : 0,
        params: (node.params ?? {}) as Record<string, string | number | boolean>,
        library: typeof node.library === 'string' ? node.library : undefined,
      });
    }
    const edges: ModelEdge[] = Array.isArray(raw.edges)
      ? raw.edges
          .filter(
            (edge): edge is ModelEdge =>
              edge !== null &&
              typeof edge === 'object' &&
              typeof (edge as Partial<ModelEdge>).id === 'string' &&
              typeof (edge as Partial<ModelEdge>).from === 'string' &&
              typeof (edge as Partial<ModelEdge>).to === 'string',
          )
          .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to }))
      : [];
    return {
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : fallbackName,
      nodes,
      edges,
    };
  } catch {
    return null;
  }
}

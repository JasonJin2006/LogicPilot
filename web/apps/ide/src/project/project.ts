// LogicPilot project serialization: a single-file `*.lpproj` bundle that
// carries the model source (DSL), the canvas presentation (layout) and the
// manifest. The bundle maps 1:1 onto the canonical on-disk directory layout
// (docs/specs/project-format.md) so it can later be unpacked to disk without
// data loss.

import { generateDsl, parseDsl } from '@logicpilot/editor';
import type { ModelDocument, ModelEdge, ModelNode } from '@logicpilot/editor';

export const PROJECT_SCHEMA = 'logicpilot.project';
export const PROJECT_VERSION = 1;
export const DEFAULT_MODEL_PATH = 'model/main.lp';
export const DEFAULT_PRESENTATION_PATH = 'presentation/main.canvas.json';
export const DEFAULT_SEED = 42;
export const DEFAULT_SCHEMA_VERSION = 2;

export interface ProjectManifest {
  name: string;
  model: string;
  presentation: string;
  defaultExperiment: string | null;
  defaults: { seed: number; schemaVersion: number };
}

export interface ProjectBundle {
  schema: typeof PROJECT_SCHEMA;
  format: 'bundle';
  version: typeof PROJECT_VERSION;
  manifest: ProjectManifest;
  files: Record<string, string>;
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

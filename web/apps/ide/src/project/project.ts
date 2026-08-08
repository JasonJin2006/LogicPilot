// LogicPilot project serialization: a single-file `*.lpproj` bundle that
// carries the model source (DSL), the canvas presentation (layout) and the
// manifest. The bundle maps 1:1 onto the canonical on-disk directory layout
// (docs/specs/project-format-v2.md) so it can later be unpacked to disk without
// data loss.

import {
  createDocument,
  freshId,
  generateDsl,
  normalizeGraphicNode,
  parseDsl,
} from '@logicpilot/editor';
import type { GraphicNode, ModelDocument, ModelEdge, ModelNode } from '@logicpilot/editor';
import { insertMember, parseProjectMembers, parseProjectSource, replaceSpan } from './projectTree';

export const PROJECT_SCHEMA = 'logicpilot.project';
export const PROJECT_VERSION = 1;
export const DEFAULT_MODEL_PATH = 'model/main.lp';
export const DEFAULT_PRESENTATION_PATH = 'presentation/main.canvas.json';
export const MODEL_SCENE_DIR = 'model/scenes';
export const DEFAULT_SEED = 42;
export const DEFAULT_SCHEMA_VERSION = 2;

/** Deterministic stable uid for a container scene: `lp_` + FNV-1a of the
 *  relative path, so re-saving a scene keeps its identity (and a rename
 *  produces a new identity the manifest records). */
export function sceneUid(path: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(path)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `lp_${hash.toString(16).padStart(16, '0')}`;
}

/** The uid recorded in a scene file's leading `// @uid lp_...` comment. */
export function sceneUidOf(source: string): string | null {
  const newline = source.indexOf('\n');
  const firstLine = newline === -1 ? source : source.slice(0, newline);
  const match = /@uid\s+(lp_[0-9a-f]{16})/.exec(firstLine);
  return match ? match[1]! : null;
}

export interface ProjectManifest {
  name: string;
  model: string;
  presentation: string;
  defaultExperiment: string | null;
  /** Per-concern fragment files merged into the model at compile time. */
  modelParts?: string[];
  /** Stable container identities: scene uid -> relative path
   *  (project-format-v2 §6). Keeps instance references intact across
   *  renames. */
  containerIds?: Record<string, string>;
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
  // project-format-v2: every member lives in its owning container file -
  // the model root keeps resource/param/experiment members, containers go to
  // model/scenes/*.lp. There are no kind-based part files anymore.
  bundle.manifest.modelParts = [];
  bundle.files[DEFAULT_MODEL_PATH] = `model ${name} {\n}\n`;
  return bundle;
}

/** Initialize a project bundle from a bare folder's model/main.lp (or an
 *  empty model when missing). Used by the first Save after opening a folder
 *  without logicpilot.json (project-format-v2: Save initializes). */
export function initializeProject(
  mainContent: string | undefined,
  folderName: string,
): { document: ModelDocument; bundle: ProjectBundle } {
  const parsed = mainContent !== undefined ? parseDsl(mainContent) : null;
  const document = parsed?.ok ? parsed.document : createDocument(folderName);
  const bundle = createProjectBundle(document);
  bundle.manifest.name = folderName;
  return { document, bundle };
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
  const scenes = new Map<string, string[]>();
  const remaining: string[] = [];
  for (const member of parsed.model.members) {
    // Keep the member's leading indentation (the span starts at the kind
    // token, so slice from the start of its line).
    const lineStart = source.lastIndexOf('\n', member.span.start - 1) + 1;
    const text = source.slice(lineStart, member.span.end).trimEnd();
    if (['agent', 'atomic', 'continuous', 'experiment'].includes(member.kind)) {
      // One scene file per container node (the file is that node's subgraph).
      const blocks = scenes.get(member.name) ?? [];
      blocks.push(text);
      scenes.set(member.name, blocks);
      // The model references the scene by path instead of inlining it.
      remaining.push(`  instance ${member.name} = "${MODEL_SCENE_DIR}/${member.name}.lp"`);
    } else {
      // Leaf members (resource/param/use/...) stay in their owning file.
      remaining.push(text);
    }
  }
  const mainBody = remaining.length > 0 ? `\n${remaining.join('\n')}` : '';
  out[DEFAULT_MODEL_PATH] = `model ${parsed.model.name} {${mainBody}\n}\n`;
  for (const [name, blocks] of scenes) {
    const path = `${MODEL_SCENE_DIR}/${name}.lp`;
    // A stable uid line keeps the container's identity across renames
    // (project-format-v2 §6).
    out[path] = `// @uid ${sceneUid(path)}\n${blocks.join('\n')}\n`;
  }
  return out;
}

/** Identify the container a scene file holds (agent Drone in
 *  model/scenes/Drone.lp); null for non-scene files. */
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

/** Insert an `instance <name> = "<scene-path>"` member into the model body. */
export function addInstanceLine(source: string, path: string, name: string): string {
  const parsed = parseProjectSource(source);
  if (!parsed.ok || !parsed.model) {
    return source;
  }
  return insertMember(source, parsed.model.bodyClose, '  ', `instance ${name} = "${path}"`);
}

/** A unique member name based on `baseName` (Flow, Flow2, Flow3, ...). */
export function nextInstanceName(source: string, baseName: string): string {
  const parsed = parseProjectSource(source);
  const names = new Set(
    parsed.ok && parsed.model ? parsed.model.members.map((member) => member.name) : [],
  );
  let n = 1;
  for (;;) {
    const candidate = n === 1 ? baseName : `${baseName}${n}`;
    if (!names.has(candidate)) {
      return candidate;
    }
    n += 1;
  }
}

/** Part files present in `files` (kind-based leaf parts), excluding main.lp
 *  and scene files (scenes are referenced by `instance` members instead). */
export function collectModelParts(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter(
      (path) =>
        path.startsWith('model/') &&
        path !== DEFAULT_MODEL_PATH &&
        !path.startsWith(`${MODEL_SCENE_DIR}/`),
    )
    .sort();
}

/** The expanded text for an `instance` member: load the referenced scene and
 *  take its container declaration (renamed to the instance's name). */
export function instanceContainerText(sceneSource: string, instanceName: string): string {
  const parsed = parseProjectMembers(sceneSource);
  const container = parsed.ok ? (parsed.members ?? []).find((member) => !member.isLeaf) : undefined;
  if (!container) {
    return '';
  }
  const text = sceneSource.slice(container.span.start, container.span.end);
  if (container.nameSpan && container.name !== instanceName) {
    const relativeStart = container.nameSpan.start - container.span.start;
    const relativeEnd = container.nameSpan.end - container.span.start;
    return `${text.slice(0, relativeStart)}${instanceName}${text.slice(relativeEnd)}`;
  }
  return text;
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
  // Preserve scene files the canvas does not own (hand-authored containers
  // referenced by instance) plus legacy kind-based part files.
  for (const part of current?.manifest.modelParts ?? []) {
    if (files[part] === undefined && current?.files[part] !== undefined) {
      files[part] = current.files[part];
    }
  }
  for (const [path, content] of Object.entries(current?.files ?? {})) {
    if (path.startsWith(`${MODEL_SCENE_DIR}/`) && files[path] === undefined) {
      files[path] = content;
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
  return mergeModelSourceChecked(mainSource, files, partPaths).source;
}

/** One structured load/save diagnostic (project-format-v2 error families:
 *  LP2xxx structure, LP3xxx references, LP4xxx layout, LP5xxx sync). */
export interface SyncDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

/** Merge the model source like mergeModelSource, additionally collecting
 *  reference diagnostics: LP3100 unresolved instance, LP3101 cyclic
 *  instance. */
export function mergeModelSourceChecked(
  mainSource: string,
  files: Record<string, string>,
  partPaths?: string[],
  aliases?: Record<string, string>,
): { source: string; diagnostics: SyncDiagnostic[] } {
  const diagnostics: SyncDiagnostic[] = [];
  const parsed = parseProjectSource(mainSource);
  if (!parsed.ok || !parsed.model) {
    return { source: mainSource, diagnostics };
  }
  const chunks = (partPaths ?? collectModelParts(files))
    .map((path) => files[path])
    .filter((content) => content !== undefined && content.trim() !== '')
    .join('\n');
  let merged =
    chunks === ''
      ? mainSource
      : insertMember(mainSource, parsed.model.bodyClose, '', `${chunks.trimEnd()}\n`);

  // Expand `instance` members: replace each instance line with the referenced
  // scene's container. Done after part insertion so spans are re-parsed.
  const seen = new Set<string>();
  let guard = 0;
  while (guard++ < 64) {
    const reparsed = parseProjectSource(merged);
    if (!reparsed.ok || !reparsed.model) {
      break;
    }
    const instance = reparsed.model.members.find(
      (member) => member.kind === 'instance' && member.path !== undefined,
    );
    if (!instance || instance.kind !== 'instance' || instance.path === undefined) {
      break;
    }
    if (seen.has(instance.path)) {
      diagnostics.push({
        code: 'LP3101',
        severity: 'error',
        message: `cyclic instance reference '${instance.path}'`,
        path: instance.path,
      });
      break;
    }
    seen.add(instance.path);
    const scene = files[instance.path];
    if (scene === undefined) {
      // The scene may have been renamed outside the IDE: its file keeps the
      // uid comment, so find the current path by uid and repair the
      // reference (project-format-v2 §6).
      const expectedUid = sceneUid(instance.path);
      const repairedPath = aliases?.[expectedUid];
      const repaired = repairedPath !== undefined ? files[repairedPath] : undefined;
      if (repaired === undefined) {
        diagnostics.push({
          code: 'LP3100',
          severity: 'error',
          message: `instance '${instance.name}' references missing scene '${instance.path}'`,
          path: instance.path,
        });
        break;
      }
      diagnostics.push({
        code: 'LP3102',
        severity: 'warning',
        message: `scene '${instance.path}' was renamed to '${repairedPath}' - reference repaired`,
        path: instance.path,
      });
      const repairedContainer = instanceContainerText(repaired, instance.name);
      if (repairedContainer !== '') {
        merged = replaceSpan(merged, instance.span.start, instance.span.end, repairedContainer);
      }
      continue;
    }
    const containerText = instanceContainerText(scene, instance.name);
    if (containerText === '') {
      diagnostics.push({
        code: 'LP3100',
        severity: 'error',
        message: `scene '${instance.path}' has no container to expand`,
        path: instance.path,
      });
      break;
    }
    merged = replaceSpan(merged, instance.span.start, instance.span.end, containerText);
  }
  return { source: merged, diagnostics };
}

/** Serialize the current canvas document into a project bundle. The DSL is
 *  derived from the document (positions are kept in the canvas file). */
export function createProjectBundle(document: ModelDocument): ProjectBundle {
  const canvas = canvasLayoutJson(document);
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

/** A stable, path-like identity for a node (root `name`, nested
 *  `container/name`). The layout file keys positions/edges by this instead
 *  of runtime ids, so a round trip through parse/generate restores the
 *  canvas even though node ids are regenerated on load. */
export function nodePath(node: ModelNode, nodes: ModelNode[]): string {
  if (node.container === undefined) {
    // Agent-centric root: every member at the model root uses its name
    // (process blocks included).
    return node.name;
  }
  const parent = nodes.find((candidate) => candidate.name === node.container);
  const prefix = parent ? nodePath(parent, nodes) : node.container;
  return `${prefix}/${node.name}`;
}

/** The v2 layout-only canvas file: node positions and couplings keyed by
 *  stable node paths. Structure lives in main.lp (project-format-v2). */
export function canvasLayoutJson(document: ModelDocument): string {
  const layout: Record<string, { x: number; y: number }> = {};
  for (const node of document.nodes) {
    layout[nodePath(node, document.nodes)] = { x: node.x, y: node.y };
  }
  const edges = document.edges.flatMap((edge) => {
    const from = document.nodes.find((node) => node.id === edge.from);
    const to = document.nodes.find((node) => node.id === edge.to);
    if (!from || !to) {
      return [];
    }
    return [{ from: nodePath(from, document.nodes), to: nodePath(to, document.nodes) }];
  });
  // Presentation shapes live outside the DSL, so the canvas file carries the
  // full vector objects (v3). They are restored by applyCanvasLayout.
  const shapes = document.nodes
    .filter((node) => node.presentation)
    .map((node) => ({
      kind: node.kind,
      name: node.name,
      object: node.presentation as GraphicNode,
    }));
  return JSON.stringify(
    { schema: 'logicpilot.canvas', version: 3, layout, edges, shapes },
    null,
    2,
  );
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
  if (
    bundle.files === undefined ||
    typeof bundle.files !== 'object' ||
    Array.isArray(bundle.files)
  ) {
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
  diagnostics?: SyncDiagnostic[];
}

/** Open a project bundle: prefer the canvas presentation (layout + ids +
 *  params), fall back to parsing the model source. */
export function projectToDocument(bundle: ProjectBundle): DocumentLoadResult {
  const canvasText = bundle.files[bundle.manifest.presentation];
  const source = bundle.files[bundle.manifest.model];
  // Legacy v1 canvas: a whole document (structure + layout) - keep using it.
  if (canvasText !== undefined && !isLayoutCanvas(canvasText)) {
    const document = parseCanvas(canvasText, bundle.manifest.name);
    if (document !== null) {
      return { ok: true, document };
    }
  }
  if (source !== undefined) {
    // uid -> current path, from the scene files' leading uid comments: used
    // to repair instance references whose scene was renamed outside the IDE.
    const aliases: Record<string, string> = {};
    for (const [path, content] of Object.entries(bundle.files)) {
      if (path.startsWith(`${MODEL_SCENE_DIR}/`)) {
        const uid = sceneUidOf(content);
        if (uid !== null) {
          aliases[uid] = path;
        }
      }
    }
    const merged = mergeModelSourceChecked(
      source,
      bundle.files,
      bundle.manifest.modelParts ?? [],
      aliases,
    );
    const parsed = parseDsl(merged.source);
    if (parsed.ok) {
      if (canvasText !== undefined) {
        applyCanvasLayout(parsed.document, canvasText);
      }
      return {
        ok: true,
        document: parsed.document,
        diagnostics: [...(parsed.diagnostics ?? []), ...merged.diagnostics],
      };
    }
    return {
      ok: false,
      error: parsed.error ?? 'invalid model source',
      diagnostics: [...(parsed.diagnostics ?? []), ...merged.diagnostics],
    };
  }
  return { ok: false, error: `project is missing '${bundle.manifest.model}'` };
}

function isLayoutCanvas(text: string): boolean {
  try {
    const raw = JSON.parse(text) as { schema?: unknown } | null;
    return raw !== null && typeof raw === 'object' && 'layout' in raw;
  } catch {
    return false;
  }
}

/** Apply a v2 layout-only canvas file (positions + couplings by node path)
 *  onto a freshly parsed document. */
function applyCanvasLayout(document: ModelDocument, text: string): void {
  let raw: {
    layout?: Record<string, { x?: unknown; y?: unknown }>;
    edges?: Array<{ from?: unknown; to?: unknown }>;
  } | null;
  try {
    raw = JSON.parse(text);
  } catch {
    return;
  }
  if (raw === null || typeof raw !== 'object' || !raw.layout) {
    return;
  }
  const byPath = new Map<string, ModelNode>();
  for (const node of document.nodes) {
    byPath.set(nodePath(node, document.nodes), node);
  }
  for (const [path, position] of Object.entries(raw.layout)) {
    const node = byPath.get(path);
    if (node && position && typeof position.x === 'number' && typeof position.y === 'number') {
      node.x = position.x;
      node.y = position.y;
    }
  }
  if (Array.isArray(raw.edges)) {
    const next: ModelEdge[] = [];
    for (const entry of raw.edges) {
      const from = typeof entry?.from === 'string' ? byPath.get(entry.from) : undefined;
      const to = typeof entry?.to === 'string' ? byPath.get(entry.to) : undefined;
      if (from && to && from.id !== to.id) {
        next.push({ id: freshId('edge'), from: from.id, to: to.id });
      }
    }
    // The persisted couplings replace the parse-time default ones.
    document.edges = next;
  }
  // v3: presentation shapes (vector objects) are restored by creating (or
  // attaching to) their nodes - they have no DSL representation.
  const shapes = (raw as { shapes?: unknown }).shapes;
  if (Array.isArray(shapes)) {
    for (const entry of shapes) {
      const shape = entry as { kind?: unknown; name?: unknown; object?: unknown } | null;
      if (shape === null || typeof shape !== 'object' || typeof shape.object !== 'object') {
        continue;
      }
      const kind = typeof shape.kind === 'string' ? shape.kind : 'rect';
      const name = typeof shape.name === 'string' ? shape.name : kind;
      const object = normalizeGraphicNode(shape.object);
      if (!object) {
        continue;
      }
      const existing = document.nodes.find(
        (node) => node.kind === kind && node.name === name && node.library === 'presentation',
      );
      if (existing) {
        existing.presentation = object;
        existing.x = object.transform.x;
        existing.y = object.transform.y;
      } else {
        document.nodes.push({
          id: freshId('shape'),
          kind,
          name,
          x: object.transform.x,
          y: object.transform.y,
          params: {},
          library: 'presentation',
          presentation: object,
        });
      }
    }
  }
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

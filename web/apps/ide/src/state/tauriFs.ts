// Tauri filesystem bridge for on-disk projects (desktop client only). The
// native folder picker comes from @tauri-apps/plugin-dialog and the write
// commands are implemented in desktop/src-tauri/src/main.rs. Outside Tauri
// (browser dev) these helpers are inert and the IDE falls back to in-memory
// projects + .lpproj downloads.

export interface TauriFsResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function pickProjectFolder(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === 'string' && selected !== '' ? selected : null;
  } catch (error) {
    console.error('folder picker failed', error);
    return null;
  }
}

function invokeCommand(
  command: string,
  args: Record<string, unknown>,
): Promise<TauriFsResult> {
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<string>(command, args).then(
        (path) => ({ ok: true, path }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

/** Create <baseDir>/<name> and write the blank project structure to disk. */
export function createProjectDir(
  baseDir: string,
  name: string,
  files: Record<string, string>,
): Promise<TauriFsResult> {
  return invokeCommand('create_project_dir', { baseDir, name, files });
}

/** Write the current source files into an existing project directory. */
export function writeProjectFiles(
  projectDir: string,
  files: Record<string, string>,
): Promise<TauriFsResult> {
  return invokeCommand('write_project_files', { projectDir, files });
}

export interface ProjectDirReadResult {
  ok: boolean;
  manifestJson?: string;
  files?: Record<string, string>;
  error?: string;
}

/** Read an on-disk project directory back into the bundle envelope. */
export function readProjectDir(projectDir: string): Promise<ProjectDirReadResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<{ manifest_json: string; files: Record<string, string> }>(
        'read_project_dir',
        { projectDir },
      ).then(
        (result) => ({
          ok: true,
          manifestJson: result.manifest_json,
          files: result.files,
        }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

export interface ProjectTreeResult {
  ok: boolean;
  files?: string[];
  error?: string;
}

/** The real on-disk file tree of a project (relative paths, incl. derived
 *  folders like build/ and results/). Used by the Explorer as a workspace
 *  browser, VS Code style. */
export function readProjectTree(projectDir: string): Promise<ProjectTreeResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<string[]>('read_project_tree', { projectDir }).then(
        (files) => ({ ok: true, files }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

export interface ProjectFileReadResult {
  ok: boolean;
  content?: string;
  error?: string;
}

/** Read one project file as text (viewing files outside the bundle). */
export function readProjectFile(
  projectDir: string,
  rel: string,
): Promise<ProjectFileReadResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<string>('read_project_file', { projectDir, rel }).then(
        (content) => ({ ok: true, content }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

/** Write (or overwrite) one project file; parents are created. */
export function writeProjectFile(
  projectDir: string,
  rel: string,
  content: string,
): Promise<TauriFsResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<void>('write_project_file', { projectDir, rel, content }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

/** Create one directory inside the project. */
export function createDirectory(
  projectDir: string,
  rel: string,
): Promise<TauriFsResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<void>('create_directory', { projectDir, rel }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

/** Rename or move a file/folder inside the project. */
export function renameProjectEntry(
  projectDir: string,
  oldRel: string,
  newRel: string,
): Promise<TauriFsResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<void>('rename_project_entry', { projectDir, oldRel, newRel }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

/** Delete a file or folder (recursive for folders). */
export function deleteProjectEntry(
  projectDir: string,
  rel: string,
): Promise<TauriFsResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<void>('delete_project_entry', { projectDir, rel }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

export interface ProjectHashesResult {
  ok: boolean;
  hashes?: Record<string, string>;
  error?: string;
}

/** Per-file content fingerprints, for detecting external edits before Save
 *  (project-format-v2 LP5xxx sync conflicts). */
export function readProjectHashes(projectDir: string): Promise<ProjectHashesResult> {
  if (!isTauri()) {
    return Promise.resolve({ ok: false, error: 'desktop client required' });
  }
  return import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke<Record<string, string>>('read_project_hashes', { projectDir }).then(
        (hashes) => ({ ok: true, hashes }),
        (error) => ({ ok: false, error: String(error) }),
      ),
    )
    .catch((error) => ({ ok: false, error: String(error) }));
}

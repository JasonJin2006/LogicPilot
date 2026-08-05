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

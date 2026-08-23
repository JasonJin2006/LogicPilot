import type { AssistantTool } from '../../toolTypes';
import { refreshCanvasDocument } from '../../../state/projectSync';
import { useProjectStore } from '../../../state/projectStore';
import { useWorkspaceStore } from '../../../state/workspaceStore';
import { readProjectFile } from '../../../state/tauriFs';

const SOURCE_ROOTS = ['model/', 'presentation/', 'experiments/'];
const MAX_SOURCE_BYTES = 512 * 1024;

function pathArg(args: Record<string, unknown>): string | null {
  return typeof args.path === 'string' ? args.path.trim().replaceAll('\\', '/') : null;
}

function validSourcePath(path: string | null): path is string {
  return (
    path !== null &&
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    SOURCE_ROOTS.some((root) => path.startsWith(root)) &&
    /\.(lp|json|yaml|yml|csv|md)$/i.test(path)
  );
}

function checksum(text: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function readSource(
  path: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const project = useProjectStore.getState();
  if (!useWorkspaceStore.getState().isOpen()) return { ok: false, error: 'no workspace is open' };
  const bundled = project.bundle?.files[path];
  if (bundled !== undefined) return { ok: true, content: bundled };
  if (project.path !== null) {
    const disk = await readProjectFile(project.path, path);
    if (disk.ok && disk.content !== undefined) return { ok: true, content: disk.content };
    return { ok: false, error: disk.error ?? 'source file could not be read' };
  }
  return { ok: false, error: `source file '${path}' is not present in the workspace bundle` };
}

export const SOURCE_EDITING_TOOLS: readonly AssistantTool[] = [
  {
    name: 'read_workspace_file',
    executionMode: 'serial',
    description: 'Read a bounded source file inside the active workspace.',
    parameters: { path: { type: 'string', required: true } },
    validate: (args) =>
      validSourcePath(pathArg(args))
        ? null
        : 'path must be a model, presentation or experiments source path',
    execute: async (args) => {
      const path = pathArg(args)!;
      const result = await readSource(path);
      if (!result.ok) return result;
      if (new TextEncoder().encode(result.content).byteLength > MAX_SOURCE_BYTES)
        return { ok: false, error: 'source file exceeds the 512 KiB read limit' };
      return { ok: true, path, checksum: checksum(result.content), content: result.content };
    },
  },
  {
    name: 'apply_source_patch',
    executionMode: 'serial',
    requiresApproval: true,
    description: 'Apply an exact source patch after checksum and oldText validation.',
    parameters: {
      path: { type: 'string', required: true },
      expectedChecksum: { type: 'string', required: true },
      oldText: { type: 'string', required: true },
      newText: { type: 'string', required: true },
      summary: { type: 'string', required: true },
    },
    validate: (args) => {
      if (!validSourcePath(pathArg(args)))
        return 'path must be a model, presentation or experiments source path';
      for (const key of ['expectedChecksum', 'oldText', 'newText', 'summary'])
        if (typeof args[key] !== 'string') return `${key} must be a string`;
      if (String(args.summary).trim() === '') return 'summary must not be empty';
      return null;
    },
    execute: async (args) => {
      const path = pathArg(args)!;
      const result = await readSource(path);
      if (!result.ok) return result;
      const current = result.content;
      const expected = String(args.expectedChecksum);
      if (checksum(current) !== expected)
        return {
          ok: false,
          error: 'source file changed since it was inspected; read it again before patching',
        };
      const oldText = String(args.oldText);
      if (!current.includes(oldText))
        return { ok: false, error: 'oldText was not found exactly in the source file' };
      const next = current.replace(oldText, String(args.newText));
      if (new TextEncoder().encode(next).byteLength > MAX_SOURCE_BYTES)
        return { ok: false, error: 'patched source exceeds the 512 KiB limit' };
      const project = useProjectStore.getState();
      project.updateFiles((files) => ({ ...files, [path]: next }));
      // Keep the user's tabs/views; only the parsed projection swaps.
      if (path.startsWith('model/')) refreshCanvasDocument();
      return {
        ok: true,
        path,
        checksum: checksum(next),
        summary: String(args.summary),
        changed: true,
      };
    },
  },
];

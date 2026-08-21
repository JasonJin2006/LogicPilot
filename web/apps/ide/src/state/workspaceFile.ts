import type { WorkspaceFolder } from './workspaceStore';

export interface WorkspaceFile {
  schema: 'logicpilot.workspace';
  version: 1;
  name: string;
  folders: WorkspaceFolder[];
}

export function workspaceToJson(folders: WorkspaceFolder[], name = 'LogicPilot Workspace'): string {
  const value: WorkspaceFile = {
    schema: 'logicpilot.workspace',
    version: 1,
    name,
    folders,
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseWorkspaceFile(
  value: string,
): { ok: true; workspace: WorkspaceFile } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value) as Partial<WorkspaceFile>;
    if (
      parsed.schema !== 'logicpilot.workspace' ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.folders) ||
      parsed.folders.some(
        (folder) =>
          folder === null ||
          typeof folder !== 'object' ||
          typeof folder.path !== 'string' ||
          typeof folder.name !== 'string',
      )
    ) {
      return { ok: false, error: 'invalid LogicPilot workspace file' };
    }
    return {
      ok: true,
      workspace: {
        schema: 'logicpilot.workspace',
        version: 1,
        name: typeof parsed.name === 'string' ? parsed.name : 'LogicPilot Workspace',
        folders: parsed.folders as WorkspaceFolder[],
      },
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

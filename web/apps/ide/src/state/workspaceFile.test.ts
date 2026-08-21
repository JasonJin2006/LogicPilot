import { describe, expect, it } from 'vitest';
import { parseWorkspaceFile, workspaceToJson } from './workspaceFile';

describe('workspace file format', () => {
  it('round-trips workspace roots', () => {
    const json = workspaceToJson([{ path: 'C:/models', name: 'Models' }], 'Demo');
    const parsed = parseWorkspaceFile(json);
    expect(parsed).toEqual({
      ok: true,
      workspace: {
        schema: 'logicpilot.workspace',
        version: 1,
        name: 'Demo',
        folders: [{ path: 'C:/models', name: 'Models' }],
      },
    });
  });

  it('rejects unrelated JSON', () => {
    expect(parseWorkspaceFile('{"folders":[]}').ok).toBe(false);
  });
});

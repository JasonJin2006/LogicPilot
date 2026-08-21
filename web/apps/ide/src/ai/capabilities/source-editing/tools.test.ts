import { describe, expect, it, beforeEach } from 'vitest';
import { createProject } from '../../../project/project';
import { useProjectStore } from '../../../state/projectStore';
import { useWorkspaceStore } from '../../../state/workspaceStore';
import { SOURCE_EDITING_TOOLS } from './tools';

describe('source editing capability', () => {
  beforeEach(() => {
    const bundle = createProject('Demo');
    useProjectStore.setState({
      bundle,
      path: null,
      diskFiles: null,
      diskHashes: null,
      dirty: false,
    });
    useWorkspaceStore.getState().openVirtual('Demo');
  });

  it('reads source with a checksum and applies an exact patch', async () => {
    const read = SOURCE_EDITING_TOOLS.find((tool) => tool.name === 'read_workspace_file')!;
    const patch = SOURCE_EDITING_TOOLS.find((tool) => tool.name === 'apply_source_patch')!;
    const first = await read.execute({ path: 'model/main.lp' }, {} as never);
    expect(first.ok).toBe(true);
    const content = String(first.content);
    const checksum = String(first.checksum);
    const result = await patch.execute(
      {
        path: 'model/main.lp',
        expectedChecksum: checksum,
        oldText: content,
        newText: 'model Demo {\n  parameter arrival = 0.8\n}\n',
        summary: 'add an arrival parameter',
      },
      {} as never,
    );
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().bundle?.files['model/main.lp']).toContain('arrival');
  });

  it('rejects stale checksums and paths outside source roots', async () => {
    const patch = SOURCE_EDITING_TOOLS.find((tool) => tool.name === 'apply_source_patch')!;
    expect(
      patch.validate({
        path: 'build/model.lp',
        expectedChecksum: 'x',
        oldText: '',
        newText: '',
        summary: 'x',
      }),
    ).not.toBeNull();
    const result = await patch.execute(
      {
        path: 'model/main.lp',
        expectedChecksum: 'deadbeef',
        oldText: '',
        newText: 'x',
        summary: 'x',
      },
      {} as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('changed');
  });
});

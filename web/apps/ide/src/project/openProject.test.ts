import { describe, expect, it } from 'vitest';
import { openProjectFromFile } from './openProject';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useModelStore } from '../state/modelStore';

// A model whose DSL name differs from the file name, so the two cannot be
// confused by accident.
const DSL = 'model MM1 {\n  param arrival_rate: float = 0.8\n}\n';

describe('opening a bare model file', () => {
  it('names the workspace after the file, not the model inside it', async () => {
    // The Explorer root is a file-browser row. Labelling it `MM1` - the name
    // declared inside the DSL - reads as neither a file nor a folder, which is
    // how it was reported.
    await openProjectFromFile(new File([DSL], 'mm1.lp', { type: 'text/plain' }));
    expect(useWorkspaceStore.getState().name).toBe('mm1.lp');
  });

  it('leaves the loaded document its own model name', async () => {
    // The document keeps the name from the DSL; only the workspace row (and the
    // AI conversation scope, and the recent-list key) follow the file.
    await openProjectFromFile(new File([DSL], 'mm1.lp', { type: 'text/plain' }));
    expect(useModelStore.getState().document.name).toBe('MM1');
  });

  it('separates two files whose models share a name', async () => {
    // Both files declare `model MM1`. Keying the workspace on the model name
    // made them share one AI conversation and overwrite each other in Open
    // Recent; keying on the file keeps them apart.
    await openProjectFromFile(new File([DSL], 'first.lp', { type: 'text/plain' }));
    expect(useWorkspaceStore.getState().name).toBe('first.lp');
    await openProjectFromFile(new File([DSL], 'second.lp', { type: 'text/plain' }));
    expect(useWorkspaceStore.getState().name).toBe('second.lp');
  });

  it('reports a parse failure instead of opening a broken workspace', async () => {
    // Park a known name, then open something unparseable: the name must not
    // move, or a rejected file would still have renamed the Explorer.
    useWorkspaceStore.getState().openVirtual('before.lp');
    await openProjectFromFile(new File(['model X {'], 'broken.lp', { type: 'text/plain' }));
    expect(useWorkspaceStore.getState().name).toBe('before.lp');
  });
});

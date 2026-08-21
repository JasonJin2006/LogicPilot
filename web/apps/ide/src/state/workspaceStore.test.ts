import { afterEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

describe('workspaceStore', () => {
  afterEach(() => useWorkspaceStore.getState().closeWorkspace());

  it('opens a plain folder as a writable workspace before a project exists', () => {
    useWorkspaceStore.getState().openFolder('C:/models/call-center');
    expect(useWorkspaceStore.getState().isOpen()).toBe(true);
    expect(useWorkspaceStore.getState().folders[0]).toEqual({
      path: 'C:/models/call-center',
      name: 'call-center',
    });
  });

  it('supports virtual workspaces for standalone bundles and recent models', () => {
    useWorkspaceStore.getState().openVirtual('Demo');
    expect(useWorkspaceStore.getState().folders[0]).toEqual({ path: '', name: 'Demo' });
    useWorkspaceStore.getState().addFolder('C:/libraries', 'Libraries');
    expect(useWorkspaceStore.getState().folders).toHaveLength(2);
  });
});

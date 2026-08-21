import { describe, expect, it } from 'vitest';
import { createProject } from '../project/project';
import { changedPaths, useProjectStore } from './projectStore';

describe('project store', () => {
  it('finds added, removed and modified disk files deterministically', () => {
    expect(
      changedPaths(
        { 'model/main.lp': 'a', 'presentation/main.canvas.json': 'old', 'removed.txt': 'x' },
        { 'model/main.lp': 'b', 'presentation/main.canvas.json': 'old', 'added.txt': 'y' },
      ),
    ).toEqual(['added.txt', 'model/main.lp', 'removed.txt']);
    expect(changedPaths(null, { 'model/main.lp': 'a' })).toEqual([]);
  });

  it('clearProject resets bundle, path and on-disk state', () => {
    useProjectStore.getState().openBundle(createProject('M'));
    useProjectStore.getState().setPath('C:/proj');
    useProjectStore.getState().setDiskFiles(['model/main.lp']);
    useProjectStore.getState().setDiskHashes({ 'model/main.lp': 'abc' });
    useProjectStore.getState().clearProject();
    expect(useProjectStore.getState().bundle).toBeNull();
    expect(useProjectStore.getState().path).toBeNull();
    expect(useProjectStore.getState().diskFiles).toBeNull();
    expect(useProjectStore.getState().diskHashes).toBeNull();
    expect(useProjectStore.getState().externalChanges).toEqual([]);
    expect(useProjectStore.getState().dirty).toBe(false);
  });
});

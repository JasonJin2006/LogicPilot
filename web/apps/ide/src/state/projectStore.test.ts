import { describe, expect, it } from 'vitest';
import { createProject } from '../project/project';
import { useProjectStore } from './projectStore';

describe('project store', () => {
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
    expect(useProjectStore.getState().dirty).toBe(false);
  });
});

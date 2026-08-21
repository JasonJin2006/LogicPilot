// The active LogicPilot model inside the current workspace plus its dirty
// state. A workspace may be a plain folder before it contains logicpilot.json;
// in that case bundle remains null until the first Save initializes it.
// `dirty` tracks whether the canvas has diverged from the last saved bundle
// (or from the folder's initial state).

import { create } from 'zustand';
import type { ProjectBundle } from '../project/project';
import { readProjectHashes, readProjectTree } from './tauriFs';

interface ProjectState {
  bundle: ProjectBundle | null;
  /** Absolute directory of the on-disk project (desktop client). */
  path: string | null;
  /** The real on-disk file tree (relative paths) for the Explorer, or null
   *  when there is no on-disk project (browser mode shows the bundle). */
  diskFiles: string[] | null;
  /** Content fingerprints of the on-disk files at last load/save, used to
   *  detect external edits before Save (LP5xxx conflicts). */
  diskHashes: Record<string, string> | null;
  /** Files observed to differ from the last known on-disk baseline. */
  externalChanges: string[];
  dirty: boolean;
  openBundle: (bundle: ProjectBundle) => void;
  setPath: (path: string | null) => void;
  setDiskFiles: (files: string[] | null) => void;
  setDiskHashes: (hashes: Record<string, string> | null) => void;
  setExternalChanges: (paths: string[]) => void;
  /** Re-read the disk fingerprints (after save / Explorer mutations). */
  refreshDiskHashes: () => Promise<void>;
  /** Poll the disk without moving the save-conflict baseline. */
  scanDiskChanges: () => Promise<void>;
  /** Re-read the on-disk tree (Explorer refresh / after disk mutations). */
  refreshDiskTree: () => Promise<void>;
  /** Apply an edit to the bundle's files and mark the project dirty. */
  updateFiles: (updater: (files: Record<string, string>) => Record<string, string>) => void;
  markDirty: () => void;
  markClean: () => void;
  setDirty: (dirty: boolean) => void;
  clearProject: () => void;
}

export function changedPaths(
  baseline: Record<string, string> | null,
  current: Record<string, string>,
): string[] {
  if (baseline === null) return [];
  return [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
    .filter((path) => baseline[path] !== current[path])
    .sort();
}

export const useProjectStore = create<ProjectState>()((set) => ({
  bundle: null,
  path: null,
  diskFiles: null,
  diskHashes: null,
  externalChanges: [],
  dirty: false,
  openBundle: (bundle) => set({ bundle, dirty: false, externalChanges: [] }),
  setPath: (path) => set({ path }),
  setDiskFiles: (files) => set({ diskFiles: files }),
  setDiskHashes: (hashes) => set({ diskHashes: hashes }),
  setExternalChanges: (paths) => set({ externalChanges: paths }),
  refreshDiskHashes: async () => {
    const { path: dir } = useProjectStore.getState();
    if (!dir) {
      return;
    }
    const result = await readProjectHashes(dir);
    if (result.ok && result.hashes) {
      set({ diskHashes: result.hashes, externalChanges: [] });
    }
  },
  scanDiskChanges: async () => {
    const { path: dir, diskHashes: baseline } = useProjectStore.getState();
    if (!dir || baseline === null) return;
    const result = await readProjectHashes(dir);
    if (result.ok && result.hashes) {
      useProjectStore.getState().setExternalChanges(changedPaths(baseline, result.hashes));
    }
  },
  refreshDiskTree: async () => {
    const { path: dir } = useProjectStore.getState();
    if (!dir) {
      return;
    }
    const tree = await readProjectTree(dir);
    if (tree.ok && tree.files) {
      useProjectStore.getState().setDiskFiles(tree.files);
    }
    const hashes = await readProjectHashes(dir);
    if (hashes.ok && hashes.hashes) {
      const state = useProjectStore.getState();
      // Preserve the old baseline while an external edit is outstanding so
      // Save still raises the LP5xxx overwrite confirmation.
      if (state.externalChanges.length === 0) state.setDiskHashes(hashes.hashes);
    }
  },
  updateFiles: (updater) =>
    set((state) => {
      if (!state.bundle) return {};
      return {
        bundle: { ...state.bundle, files: updater(state.bundle.files) },
        dirty: true,
      };
    }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false }),
  setDirty: (dirty) => set({ dirty }),
  clearProject: () =>
    set({
      bundle: null,
      path: null,
      dirty: false,
      diskFiles: null,
      diskHashes: null,
      externalChanges: [],
    }),
}));

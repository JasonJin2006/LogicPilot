// The project currently open in the IDE (a *.lpproj bundle) plus its dirty
// state. The bundle is set when a project is created/saved/opened and cleared
// on legacy opens; it is session-only, so every launch starts with no open
// project and previous projects are reopened via Open / Open Recent. `dirty`
// tracks whether the canvas has diverged from the last saved bundle (the
// Explorer shows a dot). The Explorer panel renders its file tree from the
// bundle (docs/specs/project-format.md).

import { create } from 'zustand';
import type { ProjectBundle } from '../project/project';

interface ProjectState {
  bundle: ProjectBundle | null;
  /** Absolute directory of the on-disk project (desktop client). */
  path: string | null;
  /** The real on-disk file tree (relative paths) for the Explorer, or null
   *  when there is no on-disk project (browser mode shows the bundle). */
  diskFiles: string[] | null;
  dirty: boolean;
  openBundle: (bundle: ProjectBundle) => void;
  setPath: (path: string | null) => void;
  setDiskFiles: (files: string[] | null) => void;
  /** Apply an edit to the bundle's files and mark the project dirty. */
  updateFiles: (updater: (files: Record<string, string>) => Record<string, string>) => void;
  markDirty: () => void;
  markClean: () => void;
  setDirty: (dirty: boolean) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>()((set) => ({
  bundle: null,
  path: null,
  diskFiles: null,
  dirty: false,
  openBundle: (bundle) => set({ bundle, dirty: false }),
  setPath: (path) => set({ path }),
  setDiskFiles: (files) => set({ diskFiles: files }),
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
  clearProject: () => set({ bundle: null, dirty: false, diskFiles: null }),
}));

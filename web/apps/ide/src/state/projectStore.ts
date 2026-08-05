// The project currently open in the IDE (a *.lpproj bundle) plus its dirty
// state. The bundle is set when a project is created/saved/opened and cleared
// on legacy opens; it persists to localStorage so a reload restores the
// project identity. `dirty` tracks whether the canvas has diverged from the
// last saved bundle (the Explorer shows a dot). The Explorer panel renders
// its file tree from the bundle (docs/specs/project-format.md).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ProjectBundle } from '../project/project';

interface ProjectState {
  bundle: ProjectBundle | null;
  /** Absolute directory of the on-disk project (desktop client). */
  path: string | null;
  dirty: boolean;
  openBundle: (bundle: ProjectBundle) => void;
  setPath: (path: string | null) => void;
  /** Apply an edit to the bundle's files and mark the project dirty. */
  updateFiles: (
    updater: (files: Record<string, string>) => Record<string, string>,
  ) => void;
  markDirty: () => void;
  markClean: () => void;
  setDirty: (dirty: boolean) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      bundle: null,
      path: null,
      dirty: false,
      openBundle: (bundle) => set({ bundle, dirty: false }),
      setPath: (path) => set({ path }),
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
      clearProject: () => set({ bundle: null, dirty: false }),
    }),
    {
      name: 'logicpilot.project',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ bundle: state.bundle, path: state.path, dirty: state.dirty }),
    },
  ),
);

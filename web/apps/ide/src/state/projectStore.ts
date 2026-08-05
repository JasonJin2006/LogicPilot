// The project currently open in the IDE (a *.lpproj bundle). The bundle is
// set when a project is saved or opened and cleared on New/legacy opens; the
// Explorer panel renders its file tree from it (docs/specs/project-format.md).

import { create } from 'zustand';
import type { ProjectBundle } from '../project/project';

interface ProjectState {
  bundle: ProjectBundle | null;
  openBundle: (bundle: ProjectBundle) => void;
  clearProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  bundle: null,
  openBundle: (bundle) => set({ bundle }),
  clearProject: () => set({ bundle: null }),
}));

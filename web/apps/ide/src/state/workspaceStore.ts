// VS Code-style workspace state. A workspace owns one or more roots; a
// LogicPilot project bundle is only one possible model inside a workspace.
// Keeping this separate from projectStore lets a plain folder become a valid
// authoring surface before it contains logicpilot.json.

import { create } from 'zustand';

export interface WorkspaceFolder {
  path: string;
  name: string;
}

interface WorkspaceState {
  folders: WorkspaceFolder[];
  filesByFolder: Record<string, string[]>;
  workspaceFile: string | null;
  name: string | null;
  openFolder: (path: string, name?: string) => void;
  openVirtual: (name: string) => void;
  addFolder: (path: string, name?: string) => void;
  removeFolder: (path: string) => void;
  setWorkspaceFile: (path: string | null) => void;
  setFolderFiles: (path: string, files: string[]) => void;
  closeWorkspace: () => void;
  isOpen: () => boolean;
}

function folderName(path: string, fallback = 'Workspace'): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || fallback;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  folders: [],
  filesByFolder: {},
  workspaceFile: null,
  name: null,
  openFolder: (path, name) =>
    set({
      folders: [{ path, name: name?.trim() || folderName(path) }],
      filesByFolder: {},
      workspaceFile: null,
      name: name?.trim() || folderName(path),
    }),
  openVirtual: (name) =>
    set({
      folders: [{ path: '', name: name.trim() || 'Workspace' }],
      filesByFolder: {},
      workspaceFile: null,
      name: name.trim() || 'Workspace',
    }),
  addFolder: (path, name) =>
    set((state) => {
      if (state.folders.some((folder) => folder.path === path)) return state;
      return {
        ...state,
        folders: [...state.folders, { path, name: name?.trim() || folderName(path) }],
      };
    }),
  removeFolder: (path) =>
    set((state) => ({
      ...state,
      folders: state.folders.filter((folder) => folder.path !== path),
    })),
  setWorkspaceFile: (path) => set({ workspaceFile: path }),
  setFolderFiles: (path, files) =>
    set((state) => ({ filesByFolder: { ...state.filesByFolder, [path]: files } })),
  closeWorkspace: () => set({ folders: [], filesByFolder: {}, workspaceFile: null, name: null }),
  isOpen: () => get().folders.length > 0,
}));

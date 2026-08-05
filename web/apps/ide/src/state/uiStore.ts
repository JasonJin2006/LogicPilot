// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  runDialogOpen: boolean;
  newProjectOpen: boolean;
  /** Bundle files open as code tabs (one tab per file, VS Code style). */
  openFiles: string[];
  /** The file tab currently in front. */
  activeFile: string | null;
  /** Multi-action confirm dialog (e.g. Close project with unsaved work). */
  confirm: {
    title: string;
    body: string;
    actions: Array<{ label: string; primary?: boolean; onSelect: () => void }>;
  } | null;
  prompt: {
    title: string;
    label: string;
    initial: string;
    submitLabel?: string;
    onSubmit: (value: string) => void;
  } | null;
  info: { title: string; body: string } | null;
  openSettings: () => void;
  closeSettings: () => void;
  openRunDialog: () => void;
  closeRunDialog: () => void;
  openNewProject: () => void;
  closeNewProject: () => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  closeAllFiles: () => void;
  openPrompt: (prompt: UiState['prompt']) => void;
  closePrompt: () => void;
  openConfirm: (confirm: NonNullable<UiState['confirm']>) => void;
  closeConfirm: () => void;
  openInfo: (title: string, body: string) => void;
  closeInfo: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  runDialogOpen: false,
  newProjectOpen: false,
  openFiles: [],
  activeFile: null,
  confirm: null,
  prompt: null,
  info: null,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openRunDialog: () => set({ runDialogOpen: true }),
  closeRunDialog: () => set({ runDialogOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openFile: (path) =>
    set((state) => ({
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
      activeFile: path,
    })),
  closeFile: (path) =>
    set((state) => {
      const openFiles = state.openFiles.filter((entry) => entry !== path);
      const activeFile =
        state.activeFile === path
          ? (openFiles[0] ?? null)
          : state.activeFile;
      return { openFiles, activeFile };
    }),
  closeAllFiles: () => set({ openFiles: [], activeFile: null }),
  openPrompt: (prompt) => set({ prompt }),
  closePrompt: () => set({ prompt: null }),
  openConfirm: (confirm) => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),
  openInfo: (title, body) => set({ info: { title, body } }),
  closeInfo: () => set({ info: null }),
}));

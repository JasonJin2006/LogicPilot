// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  runDialogOpen: boolean;
  newProjectOpen: boolean;
  /** The bundle file currently open in the center DSL editor (null = the
   *  canvas-derived DSL view). */
  dslEditorFile: string | null;
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
  openDslEditor: (path: string) => void;
  closeDslEditor: () => void;
  openPrompt: (prompt: UiState['prompt']) => void;
  closePrompt: () => void;
  openInfo: (title: string, body: string) => void;
  closeInfo: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  runDialogOpen: false,
  newProjectOpen: false,
  dslEditorFile: null,
  prompt: null,
  info: null,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openRunDialog: () => set({ runDialogOpen: true }),
  closeRunDialog: () => set({ runDialogOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openDslEditor: (path) => set({ dslEditorFile: path }),
  closeDslEditor: () => set({ dslEditorFile: null }),
  openPrompt: (prompt) => set({ prompt }),
  closePrompt: () => set({ prompt: null }),
  openInfo: (title, body) => set({ info: { title, body } }),
  closeInfo: () => set({ info: null }),
}));

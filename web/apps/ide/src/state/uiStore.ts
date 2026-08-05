// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  runDialogOpen: boolean;
  newProjectOpen: boolean;
  info: { title: string; body: string } | null;
  openSettings: () => void;
  closeSettings: () => void;
  openRunDialog: () => void;
  closeRunDialog: () => void;
  openNewProject: () => void;
  closeNewProject: () => void;
  openInfo: (title: string, body: string) => void;
  closeInfo: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  runDialogOpen: false,
  newProjectOpen: false,
  info: null,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openRunDialog: () => set({ runDialogOpen: true }),
  closeRunDialog: () => set({ runDialogOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openInfo: (title, body) => set({ info: { title, body } }),
  closeInfo: () => set({ info: null }),
}));

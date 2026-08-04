// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  runDialogOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openRunDialog: () => void;
  closeRunDialog: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  runDialogOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openRunDialog: () => set({ runDialogOpen: true }),
  closeRunDialog: () => set({ runDialogOpen: false }),
}));

// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));

// Presentation multi-selection (Shift+click on shapes). Kept separate from
// the model store's single `selectedId` so grouping/alignment can act on a
// set of shapes without touching the process-block selection semantics.

import { create } from 'zustand';

interface ShapeSelectionState {
  ids: string[];
  toggle: (id: string) => void;
  clear: () => void;
  set: (ids: string[]) => void;
}

export const useShapeSelection = create<ShapeSelectionState>((set) => ({
  ids: [],
  toggle: (id) =>
    set((state) => ({
      ids: state.ids.includes(id) ? state.ids.filter((entry) => entry !== id) : [...state.ids, id],
    })),
  clear: () => set({ ids: [] }),
  set: (ids) => set({ ids }),
}));

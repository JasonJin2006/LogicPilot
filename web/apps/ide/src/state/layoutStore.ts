// Layout store: panel areas (size / collapse / active tab / panel order),
// persisted to localStorage. Panel *content* lives in the registry
// (layout/panels.tsx); this store only describes the workspace geometry.
// See docs/specs/ide-layout.md.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LAYOUT, PANELS, type AreaId, type PanelId } from '../layout/panels';

export interface AreaState {
  size: number; // left/right width, bottom height (px)
  collapsed: boolean;
  activePanel: PanelId;
  panels: PanelId[];
}

export type Areas = Record<AreaId, AreaState>;

export interface LayoutState {
  areas: Areas;
  setSize: (area: AreaId, size: number) => void;
  setSizeOrClose: (area: AreaId, size: number) => void;
  reopenArea: (area: AreaId, size: number) => void;
  removePanel: (area: AreaId, panel: PanelId) => void;
  toggleCollapse: (area: AreaId) => void;
  setActive: (area: AreaId, panel: PanelId) => void;
  openPanel: (area: AreaId, panel: PanelId) => void;
  resetLayout: () => void;
}

export const SIZE_RANGE: Record<AreaId, { min: number; max: number }> = {
  left: { min: 120, max: 560 },
  center: { min: 0, max: 0 },
  right: { min: 120, max: 560 },
  bottom: { min: 60, max: 480 },
};

// Hysteresis: closing requires dragging this many px past the minimum, so a
// stray nudge at the edge does not snap the panel shut.
export const CLOSE_OFFSET = 24;

const DEFAULT_SIZE: Record<AreaId, number> = {
  left: 280,
  center: 0,
  right: 360,
  bottom: 180,
};

function defaultAreas(): Areas {
  const areas = {} as Areas;
  for (const area of ['left', 'center', 'right', 'bottom'] as const) {
    areas[area] = {
      size: DEFAULT_SIZE[area],
      collapsed: false,
      activePanel: DEFAULT_LAYOUT[area].active,
      panels: [...DEFAULT_LAYOUT[area].panels],
    };
  }
  return areas;
}

// Merge a persisted layout with the current defaults: drop panels that are
// no longer registered (a stale localStorage layout must not crash
// rendering), append newly registered panels that the persisted layout does
// not know about yet (e.g. Explorer), and fix the active panel.
export function mergePersistedLayout(persisted: unknown, current: LayoutState): LayoutState {
  const stored = (persisted ?? {}) as Partial<LayoutState>;
  const areas = {} as Areas;
  for (const area of ['left', 'center', 'right', 'bottom'] as const) {
    const merged = {
      ...current.areas[area],
      ...(stored.areas?.[area] ?? {}),
    };
    const persistedPanels = (merged.panels ?? []).filter(
      (panel): panel is PanelId => panel in PANELS,
    );
    const panels = [
      ...persistedPanels,
      ...DEFAULT_LAYOUT[area].panels.filter((panel) => !persistedPanels.includes(panel)),
    ];
    if (panels.length === 0) {
      panels.push(...DEFAULT_LAYOUT[area].panels);
    }
    const active = panels.includes(merged.activePanel as PanelId) ? merged.activePanel : panels[0]!;
    areas[area] = { ...merged, panels, activePanel: active };
  }
  return { ...current, ...stored, areas };
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      areas: defaultAreas(),
      setSize: (area, size) =>
        set((state) => {
          const range = SIZE_RANGE[area];
          const clamped = Math.min(range.max, Math.max(range.min, size));
          return { areas: { ...state.areas, [area]: { ...state.areas[area], size: clamped } } };
        }),
      // Dragging past the minimum closes the panel instead of stalling.
      setSizeOrClose: (area, size) =>
        set((state) => {
          const range = SIZE_RANGE[area];
          const current = state.areas[area];
          if (size < range.min - CLOSE_OFFSET) {
            return { areas: { ...state.areas, [area]: { ...current, collapsed: true } } };
          }
          const clamped = Math.min(range.max, Math.max(range.min, size));
          return { areas: { ...state.areas, [area]: { ...current, size: clamped } } };
        }),
      // Re-open a collapsed panel, expanding it to (at least) the minimum.
      reopenArea: (area, size) =>
        set((state) => {
          const range = SIZE_RANGE[area];
          const clamped = Math.min(range.max, Math.max(range.min, size));
          return {
            areas: {
              ...state.areas,
              [area]: { ...state.areas[area], collapsed: false, size: clamped },
            },
          };
        }),
      // Close one tab inside an area (center workspace tabs).
      removePanel: (area, panel) =>
        set((state) => {
          const areaState = state.areas[area];
          const panels = areaState.panels.filter((entry) => entry !== panel);
          const active =
            areaState.activePanel === panel && panels.length > 0
              ? panels[0]!
              : areaState.activePanel;
          return {
            areas: {
              ...state.areas,
              [area]: { ...areaState, panels, activePanel: active },
            },
          };
        }),
      toggleCollapse: (area) =>
        set((state) => ({
          areas: {
            ...state.areas,
            [area]: { ...state.areas[area], collapsed: !state.areas[area].collapsed },
          },
        })),
      setActive: (area, panel) =>
        set((state) => ({
          areas: { ...state.areas, [area]: { ...state.areas[area], activePanel: panel } },
        })),
      // Show a panel, adding it back to the area if it was closed.
      openPanel: (area, panel) =>
        set((state) => {
          const areaState = state.areas[area];
          const panels = areaState.panels.includes(panel)
            ? areaState.panels
            : [...areaState.panels, panel];
          return {
            areas: {
              ...state.areas,
              [area]: { ...areaState, panels, activePanel: panel },
            },
          };
        }),
      resetLayout: () => set({ areas: defaultAreas() }),
    }),
    {
      name: 'logicpilot.layout',
      version: 2,
      merge: mergePersistedLayout,
    },
  ),
);

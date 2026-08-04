import { beforeEach, describe, expect, it } from 'vitest';
import { mergePersistedLayout, useLayoutStore } from './layoutStore';
import type { LayoutState } from './layoutStore';

describe('layoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({ areas: useLayoutStore.getInitialState().areas });
  });

  it('clamps resized areas to the configured range', () => {
    const store = useLayoutStore.getState();
    store.setSize('right', 10_000);
    expect(useLayoutStore.getState().areas.right.size).toBe(560);
    store.setSize('right', 10);
    expect(useLayoutStore.getState().areas.right.size).toBe(120);
  });

  it('toggles collapse and switches active panels', () => {
    const store = useLayoutStore.getState();
    expect(store.areas.left.collapsed).toBe(false);
    store.toggleCollapse('left');
    expect(useLayoutStore.getState().areas.left.collapsed).toBe(true);
    store.setActive('right', 'ai');
    expect(useLayoutStore.getState().areas.right.activePanel).toBe('ai');
  });

  it('setSizeOrClose collapses when dragged below the minimum', () => {
    const store = useLayoutStore.getState();
    store.setSizeOrClose('right', 300);
    expect(useLayoutStore.getState().areas.right.size).toBe(300);
    expect(useLayoutStore.getState().areas.right.collapsed).toBe(false);
    // Within the close hysteresis: clamped to the minimum, not closed.
    store.setSizeOrClose('right', 100);
    expect(useLayoutStore.getState().areas.right.size).toBe(120);
    expect(useLayoutStore.getState().areas.right.collapsed).toBe(false);
    // Past min - CLOSE_OFFSET (120 - 24 = 96): the panel closes.
    store.setSizeOrClose('right', 95);
    expect(useLayoutStore.getState().areas.right.collapsed).toBe(true);
  });

  it('reopenArea expands a collapsed panel to at least the minimum', () => {
    const store = useLayoutStore.getState();
    store.setSizeOrClose('left', 0); // collapse via the close path
    expect(useLayoutStore.getState().areas.left.collapsed).toBe(true);
    store.reopenArea('left', 60);
    expect(useLayoutStore.getState().areas.left.collapsed).toBe(false);
    expect(useLayoutStore.getState().areas.left.size).toBe(120); // clamped
    store.reopenArea('left', 300);
    expect(useLayoutStore.getState().areas.left.size).toBe(300);
  });

  it('removePanel closes a center tab and falls the active tab back', () => {
    const store = useLayoutStore.getState();
    store.removePanel('center', 'model');
    const center = useLayoutStore.getState().areas.center;
    expect(center.panels).toEqual([]);
    // Removing the only panel leaves the center empty; defaults come back
    // on the next rehydrate (mergePersistedLayout).
    expect(center.activePanel).toBe('model');
  });

  it('defaults areas to the registry layout', () => {
    const { areas } = useLayoutStore.getState();
    expect(areas.center.panels).toEqual(['model']);
    expect(areas.right.panels).toEqual(['ai']);
    expect(areas.left.panels).toEqual(['modelInfo', 'palette']);
    expect(areas.bottom.panels).toEqual(['console']);
  });

  it('merge drops panels that are no longer registered', () => {
    const current = useLayoutStore.getState();
    const stale = {
      areas: {
        ...current.areas,
        center: {
          ...current.areas.center,
          panels: ['model', 'counters', 'results'],
          activePanel: 'counters',
        },
      },
    };
    const merged = mergePersistedLayout(stale, current);
    // counters/results were removed from the registry; only model survives
    // and the active panel falls back to it.
    expect(merged.areas.center.panels).toEqual(['model']);
    expect(merged.areas.center.activePanel).toBe('model');
  });

  it('merge restores defaults when a persisted area is empty', () => {
    const current = useLayoutStore.getState();
    const stale = {
      areas: {
        ...current.areas,
        right: { ...current.areas.right, panels: [] },
      },
    };
    const merged = mergePersistedLayout(stale, current);
    expect(merged.areas.right.panels).toEqual(['ai']);
  });
});

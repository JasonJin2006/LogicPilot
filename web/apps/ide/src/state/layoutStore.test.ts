import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from './layoutStore';

describe('layoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({ areas: useLayoutStore.getInitialState().areas });
  });

  it('clamps resized areas to the configured range', () => {
    const store = useLayoutStore.getState();
    store.setSize('right', 10_000);
    expect(useLayoutStore.getState().areas.right.size).toBe(560);
    store.setSize('right', 10);
    expect(useLayoutStore.getState().areas.right.size).toBe(240);
  });

  it('toggles collapse and switches active panels', () => {
    const store = useLayoutStore.getState();
    expect(store.areas.left.collapsed).toBe(false);
    store.toggleCollapse('left');
    expect(useLayoutStore.getState().areas.left.collapsed).toBe(true);
    store.setActive('right', 'results');
    expect(useLayoutStore.getState().areas.right.activePanel).toBe('results');
  });

  it('defaults areas to the registry layout', () => {
    const { areas } = useLayoutStore.getState();
    expect(areas.center.panels).toEqual(['queue', 'counters', 'results']);
    expect(areas.right.panels).toEqual(['ai']);
    expect(areas.left.panels).toEqual(['modelInfo', 'palette', 'runInfo']);
    expect(areas.bottom.panels).toEqual(['console']);
  });
});

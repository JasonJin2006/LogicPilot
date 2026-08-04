import { describe, expect, it } from 'vitest';
import { ACTIVITY_VIEWS, DEFAULT_LAYOUT, PANELS } from './panels';

describe('panel registry', () => {
  it('defines every panel with a unique id and a default area', () => {
    const ids = Object.keys(PANELS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(PANELS[id as keyof typeof PANELS].title.length).toBeGreaterThan(0);
    }
  });

  it('default layout references only registered panels', () => {
    for (const area of Object.values(DEFAULT_LAYOUT)) {
      for (const panel of area.panels) {
        expect(PANELS[panel as keyof typeof PANELS]).toBeDefined();
      }
      expect(area.panels).toContain(area.active);
    }
  });

  it('activity views map onto left-side panels', () => {
    for (const view of ACTIVITY_VIEWS) {
      expect(PANELS[view.panel].area).toBe('left');
    }
  });
});

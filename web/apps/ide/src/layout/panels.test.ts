import { describe, expect, it } from 'vitest';
import { ACTIVITY_VIEWS, DEFAULT_LAYOUT, PANELS, focusedPanelId, registerPanel } from './panels';

describe('panel registry', () => {
  it('defines every panel with a unique id and a default area', () => {
    const ids = Object.keys(PANELS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(PANELS[id]?.title.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('default layout references only registered panels', () => {
    for (const area of Object.values(DEFAULT_LAYOUT)) {
      for (const panel of area.panels) {
        expect(PANELS[panel]).toBeDefined();
      }
      expect(area.panels).toContain(area.active);
    }
  });

  it('activity views map onto left-side panels', () => {
    for (const view of ACTIVITY_VIEWS) {
      expect(PANELS[view.panel]?.area).toBe('left');
    }
  });
});

describe('open panel registration', () => {
  it('registers a panel and rejects duplicate ids', () => {
    const component = () => null;
    const dispose = registerPanel('test.extra', { title: 'Extra', area: 'right', component });
    expect(PANELS['test.extra']?.title).toBe('Extra');
    expect(() =>
      registerPanel('test.extra', { title: 'Clone', area: 'right', component }),
    ).toThrow();
    dispose();
    expect(PANELS['test.extra']).toBeUndefined();
  });

  it('focuses the first right-area panel whose probe fires', () => {
    expect(focusedPanelId('right')).toBeNull();
    const dispose = registerPanel('test.focus', {
      title: 'Focus',
      area: 'right',
      component: () => null,
      focus: () => true,
    });
    expect(focusedPanelId('right')).toBe('test.focus');
    // Built-ins registered earlier win when several probes fire.
    const disposeEarly = registerPanel('test.focusEarly', {
      title: 'Earlier',
      area: 'right',
      component: () => null,
      focus: () => false,
    });
    expect(focusedPanelId('right')).toBe('test.focus');
    dispose();
    disposeEarly();
    expect(focusedPanelId('right')).toBeNull();
  });
});

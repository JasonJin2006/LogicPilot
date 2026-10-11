import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_VIEWS,
  DEFAULT_LAYOUT,
  PANELS,
  containerOf,
  containerViews,
  focusedPanelId,
  registerPanel,
  replacePanel,
} from './panels';

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

  it('hosts the semantic outline as a section of the Explorer container', () => {
    // The old generic "Project" panel is gone for good, and the outline that
    // replaced it now stacks inside Explorer instead of owning an activity-bar
    // entry: the activity bar lists view *containers*, not individual views.
    expect(PANELS.modelInfo).toBeUndefined();
    expect(PANELS.navigator?.title).toBe('Outline');
    expect(containerOf('navigator')).toBe('explorer');
    expect(ACTIVITY_VIEWS.some((view) => view.id === 'navigator')).toBe(false);
    expect(ACTIVITY_VIEWS.some((view) => view.panel === 'explorer')).toBe(true);
  });

  it('resolves a container to its ordered views', () => {
    const left = DEFAULT_LAYOUT.left.panels;
    // Anchoring on either member yields the same stack, in layout order.
    expect(containerViews(left, 'explorer')).toEqual(['explorer', 'navigator']);
    expect(containerViews(left, 'navigator')).toEqual(['explorer', 'navigator']);
    // A panel that declares no container is its own container, so single-view
    // panels (and every pre-container registration) keep their old rendering.
    expect(containerOf('palette')).toBe('palette');
    expect(containerViews(left, 'palette')).toEqual(['palette']);
    expect(containerOf('no.such.panel')).toBe('no.such.panel');
  });

  it('mounts a contributed view from its container declaration alone', () => {
    // The contribution seam: a plugin adds a section to a container it does
    // not own by declaring that container - no openPanel(), no DEFAULT_LAYOUT
    // entry, no shell edit.
    const left = DEFAULT_LAYOUT.left.panels;
    expect(left).not.toContain('test.view');
    const dispose = registerPanel('test.view', {
      title: 'Contributed',
      area: 'left',
      container: 'explorer',
      component: () => null,
    });
    expect(containerViews(left, 'explorer')).toEqual(['explorer', 'navigator', 'test.view']);
    expect(containerViews(left, 'palette')).toEqual(['palette']);
    dispose();
    expect(containerViews(left, 'explorer')).toEqual(['explorer', 'navigator']);
  });

  it('keeps a container-less registration out of a stacking area', () => {
    // Without a container a panel is its own container, so it must NOT be
    // auto-mounted into someone else's stack (that is what stops the tabbed
    // areas from filling up with every registered panel).
    const dispose = registerPanel('test.detached', {
      title: 'Detached',
      area: 'left',
      component: () => null,
    });
    expect(containerViews(DEFAULT_LAYOUT.left.panels, 'explorer')).toEqual([
      'explorer',
      'navigator',
    ]);
    dispose();
  });

  it('keeps plugin draft governance out of the daily activity bar', () => {
    expect(PANELS.pluginDrafts).toBeUndefined();
    expect(ACTIVITY_VIEWS.some((view) => view.id === 'plugin-drafts')).toBe(false);
  });

  it('activity views map onto left-side panels', () => {
    for (const view of ACTIVITY_VIEWS) {
      expect(PANELS[view.panel]?.area).toBe('left');
    }
  });
});

describe('open panel registration', () => {
  it('restores a fallback panel after a plugin replacement is disposed', () => {
    const previous = PANELS.model!.component;
    const replacement = () => null;
    const dispose = replacePanel('model', {
      title: 'Model replacement',
      area: 'center',
      component: replacement,
    });
    expect(PANELS.model?.component).toBe(replacement);
    dispose();
    expect(PANELS.model?.component).toBe(previous);
  });

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

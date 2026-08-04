import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'system' });
  });

  it('defaults to system mode', () => {
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('setMode updates the mode', () => {
    useThemeStore.getState().setMode('light');
    expect(useThemeStore.getState().mode).toBe('light');
    useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('resolveTheme maps explicit modes directly', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolveTheme follows the OS preference in system mode', () => {
    const globals = globalThis as { window?: unknown };
    const original = globals.window;
    const stubWindow = (matches: boolean) => ({
      matchMedia: () => ({ matches }),
    });
    globals.window = stubWindow(true);
    expect(resolveTheme('system')).toBe('light');
    globals.window = stubWindow(false);
    expect(resolveTheme('system')).toBe('dark');
    globals.window = original;
  });
});

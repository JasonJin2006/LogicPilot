// Theme store: light / dark / system, persisted. `applyTheme` writes the
// resolved theme onto <html data-theme>, and the CSS variables in base.css
// switch the whole design system (custom themes can add more attribute
// values later). While in 'system' mode the OS preference is tracked live.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const MEDIA_QUERY = '(prefers-color-scheme: light)';

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') {
    return mode;
  }
  return typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERY).matches ? 'light' : 'dark';
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolveTheme(mode);
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'logicpilot.theme',
      version: 1,
      storage:
        typeof localStorage !== 'undefined' ? createJSONStorage(() => localStorage) : undefined,
    },
  ),
);

// Keep the resolved attribute in sync while 'system' mode is active.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const media = window.matchMedia(MEDIA_QUERY);
  const onChange = () => applyTheme(useThemeStore.getState().mode);
  media.addEventListener('change', onChange);
}

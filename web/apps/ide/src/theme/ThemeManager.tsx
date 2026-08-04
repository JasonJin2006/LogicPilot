// Applies the resolved theme to <html data-theme> and keeps it in sync
// while the store mode changes (including live OS preference in 'system'
// mode, tracked by themeStore).

import { useEffect } from 'react';
import { applyTheme, useThemeStore } from '../state/themeStore';

export function ThemeManager() {
  const mode = useThemeStore((state) => state.mode);
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);
  return null;
}

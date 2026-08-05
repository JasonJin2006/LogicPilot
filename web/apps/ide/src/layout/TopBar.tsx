// Top bar: small logo on the left, a centered search box, and (inside the
// Tauri desktop client) the window controls on the right. The bar doubles as
// a drag region for the frameless window.

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { AppMenu } from './AppMenu';

// Standard Windows title-bar glyphs (Segoe Fluent Icons / Segoe MDL2 Assets).
const GLYPHS = {
  minimize: '\uE921',
  maximize: '\uE922',
  restore: '\uE923',
  close: '\uE8BB',
};

function useTauri(): boolean {
  const [isTauri, setIsTauri] = useState(false);
  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  }, []);
  return isTauri;
}

export function TopBar() {
  const isTauri = useTauri();
  const [maximized, setMaximized] = useState(false);

  // Track the maximized state so the button flips between the maximize and
  // restore glyphs. Polling is more reliable than resize events (which can
  // fire mid-transition on Windows); the poll only runs inside Tauri.
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let timer: number | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        const update = async () => {
          try {
            const state = await window.isMaximized();
            if (!disposed) setMaximized(state);
          } catch {
            // ignore transient errors
          }
        };
        await update();
        timer = setInterval(() => void update(), 500);
      } catch (error) {
        console.error('maximize state tracking failed', error);
      }
    })();
    return () => {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [isTauri]);

  const startDrag = async (event: MouseEvent) => {
    if (!isTauri) return;
    event.preventDefault();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.error('start dragging failed', error);
    }
  };

  const windowAction = async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window = getCurrentWindow();
      if (action === 'minimize') {
        await window.minimize();
      } else if (action === 'toggleMaximize') {
        await window.toggleMaximize();
        setMaximized(await window.isMaximized());
      } else {
        await window.close();
      }
    } catch (error) {
      console.error('window action failed', error);
    }
  };

  return (
    <div className="top-bar">
      <div className="top-bar-drag" onMouseDown={(event) => void startDrag(event)}>
        <img className="top-logo" src="/logo.svg" alt="LogicPilot" />
      </div>
      <AppMenu />
      <div className="top-bar-fill" onMouseDown={(event) => void startDrag(event)} />
      <input
        id="lp-search"
        className="search-box"
        type="search"
        placeholder="Search models, blocks, commands"
        spellCheck={false}
        aria-label="Search"
      />
      {isTauri && (
        <div className="window-controls">
          <button
            className="window-control"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => void windowAction('minimize')}
          >
            <span className="win-glyph" aria-hidden>
              {GLYPHS.minimize}
            </span>
          </button>
          <button
            className="window-control"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void windowAction('toggleMaximize')}
          >
            <span className="win-glyph" aria-hidden>
              {maximized ? GLYPHS.restore : GLYPHS.maximize}
            </span>
          </button>
          <button
            className="window-control window-control-close"
            aria-label="Close"
            title="Close"
            onClick={() => void windowAction('close')}
          >
            <span className="win-glyph" aria-hidden>
              {GLYPHS.close}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

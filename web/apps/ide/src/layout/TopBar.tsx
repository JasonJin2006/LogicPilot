// Top bar: small logo on the left, a centered search box, and (inside the
// Tauri desktop client) the window controls on the right. The bar doubles as
// a drag region for the frameless window.

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { Minus, Square, X } from 'lucide-react';

function useTauri(): boolean {
  const [isTauri, setIsTauri] = useState(false);
  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  }, []);
  return isTauri;
}

export function TopBar() {
  const isTauri = useTauri();

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
      <input
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
            <Minus size={14} />
          </button>
          <button
            className="window-control"
            aria-label="Maximize"
            title="Maximize"
            onClick={() => void windowAction('toggleMaximize')}
          >
            <Square size={11} />
          </button>
          <button
            className="window-control window-control-close"
            aria-label="Close"
            title="Close"
            onClick={() => void windowAction('close')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

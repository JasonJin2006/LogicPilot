// Top bar: small logo on the left, a centered search box, and (inside the
// Tauri desktop client) the window controls on the right. The bar doubles as
// a drag region for the frameless window.

import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';

function useTauri(): boolean {
  const [isTauri, setIsTauri] = useState(false);
  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  }, []);
  return isTauri;
}

async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
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
  } catch {
    // not running inside Tauri
  }
}

export function TopBar() {
  const isTauri = useTauri();
  return (
    <div className="top-bar" data-tauri-drag-region={isTauri ? '' : undefined}>
      <img className="top-logo" src="/logo.svg" alt="LogicPilot" />
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

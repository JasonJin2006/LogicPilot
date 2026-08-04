// Connection settings dialog: gateway URL + connect/disconnect. Opened from
// the activity bar gear; the connection is a one-time setup, not a pinned
// header control.

import { useConnectionStore } from '../state/connectionStore';
import { useThemeStore, type ThemeMode } from '../state/themeStore';
import { useUiStore } from '../state/uiStore';

export function SettingsDialog() {
  const url = useConnectionStore((state) => state.url);
  const conn = useConnectionStore((state) => state.conn);
  const setUrl = useConnectionStore((state) => state.setUrl);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  const connected = conn === 'connected';
  const connecting = conn === 'connecting';

  return (
    <div className="dialog-backdrop" onClick={closeSettings}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>Settings</h2>
          <button className="btn-ghost" onClick={closeSettings}>
            ✕
          </button>
        </div>
        <label className="dialog-field">
          <span>Gateway URL</span>
          <input
            className="url-input"
            value={url}
            spellCheck={false}
            disabled={connected || connecting}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://127.0.0.1:8089/sim"
          />
        </label>
        <div className="dialog-actions">
          {connected || connecting ? (
            <button onClick={disconnect} disabled={connecting}>
              Disconnect
            </button>
          ) : (
            <button className="btn-primary" onClick={connect} disabled={connecting}>
              Connect
            </button>
          )}
          <span className={`conn-badge conn-${conn}`}>{conn}</span>
        </div>
        <div className="dialog-section">
          <span className="dialog-label">Appearance</span>
          <div className="theme-options">
            {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
              <button
                key={mode}
                className={`theme-option${themeMode === mode ? ' active' : ''}`}
                onClick={() => setThemeMode(mode)}
              >
                {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
              </button>
            ))}
          </div>
        </div>
        <p className="dialog-hint">
          The simulation gateway streams telemetry frames over WebSocket (wire.fbs contract F2).
        </p>
      </div>
    </div>
  );
}

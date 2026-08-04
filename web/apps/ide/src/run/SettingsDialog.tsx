// Settings dialog: connection (gateway URL) + run parameters/controls +
// appearance (theme). Opened from the activity bar gear; these are one-time
// configuration surfaces, not pinned header/toolbar controls.

import { useState } from 'react';
import type { StartOptions } from '../client/simClient';
import { useConnectionStore } from '../state/connectionStore';
import { useThemeStore, type ThemeMode } from '../state/themeStore';
import { useUiStore } from '../state/uiStore';

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function NumberField({ label, value, onChange, disabled }: NumberFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function parseNum(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

export function SettingsDialog() {
  const url = useConnectionStore((state) => state.url);
  const conn = useConnectionStore((state) => state.conn);
  const setUrl = useConnectionStore((state) => state.setUrl);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const start = useConnectionStore((state) => state.start);
  const pause = useConnectionStore((state) => state.pause);
  const resume = useConnectionStore((state) => state.resume);
  const step = useConnectionStore((state) => state.step);
  const stop = useConnectionStore((state) => state.stop);
  const setSpeed = useConnectionStore((state) => state.setSpeed);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  const [seed, setSeed] = useState('42');
  const [reps, setReps] = useState('3');
  const [arrivals, setArrivals] = useState('4000');
  const [warmup, setWarmup] = useState('400');
  const [speed, setSpeedField] = useState('10');

  const connected = conn === 'connected';
  const connecting = conn === 'connecting';
  const buildOptions = (): StartOptions => ({
    seed: parseNum(seed),
    reps: parseNum(reps),
    arrivals: parseNum(arrivals),
    warmup: parseNum(warmup),
    speed: parseNum(speed),
  });

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

        <div className="dialog-section">
          <span className="dialog-label">Connection</span>
          <input
            className="url-input"
            value={url}
            spellCheck={false}
            disabled={connected || connecting}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://127.0.0.1:8089/sim"
          />
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
        </div>

        <div className="dialog-section">
          <span className="dialog-label">Run</span>
          <div className="run-fields">
            <NumberField label="seed" value={seed} onChange={setSeed} disabled={!connected} />
            <NumberField label="reps" value={reps} onChange={setReps} disabled={!connected} />
            <NumberField
              label="arrivals"
              value={arrivals}
              onChange={setArrivals}
              disabled={!connected}
            />
            <NumberField label="warmup" value={warmup} onChange={setWarmup} disabled={!connected} />
            <NumberField
              label="speed"
              value={speed}
              onChange={setSpeedField}
              disabled={!connected}
            />
          </div>
          <div className="dialog-actions">
            <button
              className="btn-primary"
              disabled={!connected}
              onClick={() => start(buildOptions())}
            >
              Start
            </button>
            <button disabled={!connected} onClick={pause}>
              Pause
            </button>
            <button disabled={!connected} onClick={resume}>
              Resume
            </button>
            <button disabled={!connected} onClick={step}>
              Step
            </button>
            <button disabled={!connected} onClick={stop}>
              Stop
            </button>
            <button
              disabled={!connected}
              onClick={() => {
                const value = parseNum(speed);
                if (value !== undefined) setSpeed(value);
              }}
            >
              Set speed
            </button>
          </div>
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
          The gateway streams telemetry frames over WebSocket (wire.fbs contract F2); run parameters
          are applied when Start is pressed.
        </p>
      </div>
    </div>
  );
}

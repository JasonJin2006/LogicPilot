// Connection + run control panel: server URL, start parameters and the
// start / pause / resume / step / stop command buttons.

import { useState } from 'react';
import type { ConnState, StartOptions } from '../client/simClient';

interface ConnectionPanelProps {
  conn: ConnState;
  url: string;
  onUrlChange: (url: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onStart: (options: StartOptions) => void;
  onPause: () => void;
  onResume: () => void;
  onStep: () => void;
  onStop: () => void;
  onSetSpeed: (speed: number) => void;
}

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

export function ConnectionPanel(props: ConnectionPanelProps) {
  const [seed, setSeed] = useState('42');
  const [reps, setReps] = useState('3');
  const [arrivals, setArrivals] = useState('4000');
  const [warmup, setWarmup] = useState('400');
  const [speed, setSpeed] = useState('10');

  const connected = props.conn === 'connected';
  const connecting = props.conn === 'connecting';

  return (
    <div className="connection-panel">
      <div className="panel-row">
        <input
          className="url-input"
          value={props.url}
          spellCheck={false}
          disabled={connected || connecting}
          onChange={(e) => props.onUrlChange(e.target.value)}
        />
        {connected || connecting ? (
          <button onClick={props.onDisconnect}>Disconnect</button>
        ) : (
          <button onClick={props.onConnect} disabled={connecting}>
            Connect
          </button>
        )}
      </div>
      <div className="panel-row">
        <NumberField label="seed" value={seed} onChange={setSeed} disabled={!connected} />
        <NumberField label="reps" value={reps} onChange={setReps} disabled={!connected} />
        <NumberField
          label="arrivals"
          value={arrivals}
          onChange={setArrivals}
          disabled={!connected}
        />
        <NumberField label="warmup" value={warmup} onChange={setWarmup} disabled={!connected} />
        <NumberField label="speed" value={speed} onChange={setSpeed} disabled={!connected} />
        <button
          disabled={!connected}
          onClick={() =>
            props.onStart({
              seed: parseNum(seed),
              reps: parseNum(reps),
              arrivals: parseNum(arrivals),
              warmup: parseNum(warmup),
              speed: parseNum(speed),
            })
          }
        >
          Start
        </button>
      </div>
      <div className="panel-row">
        <button disabled={!connected} onClick={props.onPause}>
          Pause
        </button>
        <button disabled={!connected} onClick={props.onResume}>
          Resume
        </button>
        <button disabled={!connected} onClick={props.onStep}>
          Step
        </button>
        <button disabled={!connected} onClick={props.onStop}>
          Stop
        </button>
        <button
          disabled={!connected}
          onClick={() => {
            const s = parseNum(speed);
            if (s !== undefined) props.onSetSpeed(s);
          }}
        >
          Set speed
        </button>
      </div>
    </div>
  );
}

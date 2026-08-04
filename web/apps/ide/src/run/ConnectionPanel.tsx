// Connection + run control panel: server URL, start parameters and the
// start / pause / resume / step / stop command buttons. Reads the
// connection store directly; the parameter fields are local form state.

import { useState } from 'react';
import type { StartOptions } from '../client/simClient';
import { useConnectionStore } from '../state/connectionStore';

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

export function ConnectionPanel() {
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

  const [seed, setSeed] = useState('42');
  const [reps, setReps] = useState('3');
  const [arrivals, setArrivals] = useState('4000');
  const [warmup, setWarmup] = useState('400');
  const [speed, setSpeedField] = useState('10');

  const connected = conn === 'connected';
  const connecting = conn === 'connecting';

  return (
    <div className="connection-panel">
      <div className="panel-row">
        <input
          className="url-input"
          value={url}
          spellCheck={false}
          disabled={connected || connecting}
          onChange={(e) => setUrl(e.target.value)}
        />
        {connected || connecting ? (
          <button onClick={disconnect}>Disconnect</button>
        ) : (
          <button onClick={connect} disabled={connecting}>
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
        <NumberField label="speed" value={speed} onChange={setSpeedField} disabled={!connected} />
        <button
          disabled={!connected}
          onClick={() =>
            start({
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
  );
}

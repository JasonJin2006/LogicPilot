// Run control toolbar: replication parameters + playback controls. The
// connection setup (URL / connect) lives in the settings dialog; this bar
// is the always-available run control surface.

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

export function RunToolbar() {
  const conn = useConnectionStore((state) => state.conn);
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
  const buildOptions = (): StartOptions => ({
    seed: parseNum(seed),
    reps: parseNum(reps),
    arrivals: parseNum(arrivals),
    warmup: parseNum(warmup),
    speed: parseNum(speed),
  });

  return (
    <div className="run-toolbar">
      <span className="toolbar-label">Run</span>
      <div className="params">
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
      </div>
      <div className="divider" />
      <div className="controls">
        <button className="btn-primary" disabled={!connected} onClick={() => start(buildOptions())}>
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
  );
}

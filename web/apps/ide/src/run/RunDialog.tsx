// Run dialog: per-experiment run configuration + controls. A simulation run
// belongs to a specific model/experiment, so it is not part of the IDE
// settings (which hold only peripheral preferences). Opened from the canvas
// Run button.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { StartOptions } from '../client/simClient';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { useRunStore } from '../state/runStore';
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
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function parseNum(text: string): number | undefined {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) ? value : undefined;
}

export function RunDialog() {
  const open = useUiStore((state) => state.runDialogOpen);
  const closeRunDialog = useUiStore((state) => state.closeRunDialog);
  const conn = useConnectionStore((state) => state.conn);
  const start = useConnectionStore((state) => state.start);
  const pause = useConnectionStore((state) => state.pause);
  const resume = useConnectionStore((state) => state.resume);
  const step = useConnectionStore((state) => state.step);
  const stop = useConnectionStore((state) => state.stop);
  const runCanvasModel = useConnectionStore((state) => state.runCanvasModel);
  const nodeCount = useModelStore((state) => state.document.nodes.length);
  const runOptions = useRunStore((state) => state.runOptions);
  const setRunOptions = useRunStore((state) => state.setRunOptions);

  const initial = useRef(runOptions);
  const [seed, setSeed] = useState(String(runOptions.seed));
  const [reps, setReps] = useState(String(runOptions.reps));
  const [arrivals, setArrivals] = useState(String(runOptions.arrivals));
  const [warmup, setWarmup] = useState(String(runOptions.warmup));
  const [speed, setSpeedField] = useState(String(runOptions.speed));

  useEffect(() => {
    setRunOptions({
      seed: parseNum(seed) ?? initial.current.seed,
      reps: parseNum(reps) ?? initial.current.reps,
      arrivals: parseNum(arrivals) ?? initial.current.arrivals,
      warmup: parseNum(warmup) ?? initial.current.warmup,
      speed: parseNum(speed) ?? initial.current.speed,
    });
  }, [seed, reps, arrivals, warmup, speed, setRunOptions]);

  if (!open) {
    return null;
  }

  const connected = conn === 'connected';
  const buildOptions = (): StartOptions => ({
    seed: parseNum(seed),
    reps: parseNum(reps),
    arrivals: parseNum(arrivals),
    warmup: parseNum(warmup),
    speed: parseNum(speed),
  });
  const onStart = () => {
    if (nodeCount === 0) {
      // Empty canvas: run the served model with the configured parameters.
      start(buildOptions());
    } else {
      // Canvas model: compile first, then run with the model's parameters.
      runCanvasModel();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={closeRunDialog}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label="Run"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>Run</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeRunDialog}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-section">
          <span className="dialog-label">Parameters</span>
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
            <button className="btn-primary" disabled={!connected} onClick={onStart}>
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
          </div>
          <p className="dialog-hint">
            {nodeCount > 0
              ? 'Runs the model on the canvas (compiled first); parameters use the model\u2019s own rates.'
              : 'The canvas is empty: runs the model served by the gateway.'}
          </p>
        </div>
      </div>
    </div>
  );
}

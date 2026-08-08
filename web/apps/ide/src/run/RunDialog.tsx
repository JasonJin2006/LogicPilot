// Run dialog: per-experiment run configuration + controls. A simulation run
// belongs to a specific model/experiment, so it is not part of the IDE
// settings (which hold only peripheral preferences). Opened from the canvas
// Run button.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { StartOptions } from '../client/simClient';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { useRunStore, validateRunOptions } from '../state/runStore';
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
  const [seedMode, setSeedMode] = useState(runOptions.seedMode);
  const [reps, setReps] = useState(String(runOptions.reps));
  const [replicationMode, setReplicationMode] = useState(runOptions.replicationMode);
  const [minReps, setMinReps] = useState(String(runOptions.minReps));
  const [maxReps, setMaxReps] = useState(String(runOptions.maxReps));
  const [errorPercent, setErrorPercent] = useState(String(runOptions.errorPercent));
  const [precisionMetric, setPrecisionMetric] = useState(runOptions.precisionMetric);
  const [arrivals, setArrivals] = useState(String(runOptions.arrivals));
  const [warmup, setWarmup] = useState(String(runOptions.warmup));
  const [confidence, setConfidence] = useState(String(runOptions.confidence));
  const [speed, setSpeedField] = useState(String(runOptions.speed));

  useEffect(() => {
    setRunOptions({
      seed: parseNum(seed) ?? initial.current.seed,
      seedMode,
      reps: parseNum(reps) ?? initial.current.reps,
      replicationMode,
      minReps: parseNum(minReps) ?? initial.current.minReps,
      maxReps: parseNum(maxReps) ?? initial.current.maxReps,
      errorPercent: parseNum(errorPercent) ?? initial.current.errorPercent,
      precisionMetric,
      arrivals: parseNum(arrivals) ?? initial.current.arrivals,
      warmup: parseNum(warmup) ?? initial.current.warmup,
      confidence: parseNum(confidence) ?? initial.current.confidence,
      speed: parseNum(speed) ?? initial.current.speed,
    });
  }, [
    seed,
    seedMode,
    reps,
    replicationMode,
    minReps,
    maxReps,
    errorPercent,
    precisionMetric,
    arrivals,
    warmup,
    confidence,
    speed,
    setRunOptions,
  ]);

  if (!open) {
    return null;
  }

  const connected = conn === 'connected';
  const draftOptions = {
    seed: parseNum(seed) ?? Number.NaN,
    seedMode,
    reps: parseNum(reps) ?? Number.NaN,
    replicationMode,
    minReps: parseNum(minReps) ?? Number.NaN,
    maxReps: parseNum(maxReps) ?? Number.NaN,
    errorPercent: parseNum(errorPercent) ?? Number.NaN,
    precisionMetric,
    arrivals: parseNum(arrivals) ?? Number.NaN,
    warmup: parseNum(warmup) ?? Number.NaN,
    confidence: parseNum(confidence) ?? Number.NaN,
    speed: parseNum(speed) ?? Number.NaN,
  };
  const validationError = validateRunOptions(draftOptions);
  const buildOptions = (): StartOptions => ({
    seed: parseNum(seed),
    seedMode,
    reps: parseNum(reps),
    replicationMode,
    minReps: parseNum(minReps),
    maxReps: parseNum(maxReps),
    errorPercent: parseNum(errorPercent),
    precisionMetric,
    arrivals: parseNum(arrivals),
    warmup: parseNum(warmup),
    confidence: parseNum(confidence),
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
            <label className="field">
              <span>seed mode</span>
              <select
                value={seedMode}
                disabled={!connected}
                onChange={(event) => setSeedMode(event.target.value as typeof seedMode)}
              >
                <option value="fixed">Fixed (reproducible)</option>
                <option value="random">Random (unique run)</option>
              </select>
            </label>
            <NumberField
              label="seed"
              value={seed}
              onChange={setSeed}
              disabled={!connected || seedMode === 'random'}
            />
            <label className="field">
              <span>replications</span>
              <select
                value={replicationMode}
                disabled={!connected}
                onChange={(event) =>
                  setReplicationMode(event.target.value as typeof replicationMode)
                }
              >
                <option value="fixed">Fixed count</option>
                <option value="precision">Until confidence target</option>
              </select>
            </label>
            {replicationMode === 'fixed' ? (
              <NumberField label="reps" value={reps} onChange={setReps} disabled={!connected} />
            ) : (
              <>
                <NumberField
                  label="minimum reps"
                  value={minReps}
                  onChange={setMinReps}
                  disabled={!connected}
                />
                <NumberField
                  label="maximum reps"
                  value={maxReps}
                  onChange={setMaxReps}
                  disabled={!connected}
                />
                <NumberField
                  label="error percent"
                  value={errorPercent}
                  onChange={setErrorPercent}
                  disabled={!connected}
                />
                <label className="field">
                  <span>precision metric</span>
                  <select
                    value={precisionMetric}
                    disabled={!connected}
                    onChange={(event) =>
                      setPrecisionMetric(event.target.value as typeof precisionMetric)
                    }
                  >
                    {['throughput', 'L', 'Lq', 'W', 'Wq', 'utilization', 'availability'].map(
                      (metric) => (
                        <option key={metric} value={metric}>
                          {metric}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </>
            )}
            <NumberField
              label="arrivals"
              value={arrivals}
              onChange={setArrivals}
              disabled={!connected}
            />
            <NumberField label="warmup" value={warmup} onChange={setWarmup} disabled={!connected} />
            <NumberField
              label="confidence"
              value={confidence}
              onChange={setConfidence}
              disabled={!connected}
            />
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
              disabled={!connected || validationError !== null}
              onClick={onStart}
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
          </div>
          {validationError !== null && <p className="ai-error">{validationError}</p>}
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

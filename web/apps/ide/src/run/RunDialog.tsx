// Run dialog: per-experiment run configuration + controls. A simulation run
// belongs to a specific model/experiment, so it is not part of the IDE
// settings (which hold only peripheral preferences). Opened from the canvas
// Run button.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { generateDsl } from '@logicpilot/editor';
import type { JsonValue } from '@logicpilot/contracts';
import type { StartOptions } from '../client/simClient';
import { createExecutionClient, type ExecutionEventStream } from '../client/executionClient';
import {
  pluginRegistryGeneration,
  runParameterDeclarations,
  subscribePluginRegistry,
} from '../plugins/registry';
import { useLegacyGatewayStore } from '../state/legacyGateway';
import { useEscapeToClose } from '../components/useEscapeToClose';
import { useModelStore } from '../state/modelStore';
import { useRunStore, validateRunOptions } from '../state/runStore';
import { useUiStore } from '../state/uiStore';
import { diagnoseDocument } from '../workbench/diagnostics';
import {
  applyExperimentFields,
  experimentSignature,
  readExperiments,
} from '../workbench/experiments';
import { useExecutionStore } from '../state/executionStore';
import { projectExecutionEvent } from '../state/executionProjector';
import { resetVizState, vizState } from '../state/vizState';

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Tooltip, used to surface a pack-declared parameter's hint. */
  title?: string;
}

function NumberField({ label, value, onChange, disabled, title }: NumberFieldProps) {
  return (
    <label className="field" title={title}>
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
  const conn = useLegacyGatewayStore((state) => state.conn);
  const controlState = useLegacyGatewayStore((state) => state.controlState);
  useEscapeToClose(open, closeRunDialog);
  const pause = useLegacyGatewayStore((state) => state.pause);
  const resume = useLegacyGatewayStore((state) => state.resume);
  const step = useLegacyGatewayStore((state) => state.step);
  const stop = useLegacyGatewayStore((state) => state.stop);
  const runCanvasModel = useLegacyGatewayStore((state) => state.runCanvasModel);
  const document = useModelStore((state) => state.document);
  const runOptions = useRunStore((state) => state.runOptions);
  const setRunOptions = useRunStore((state) => state.setRunOptions);
  const nativeSession = useExecutionStore((state) => state.session);
  const beginNative = useExecutionStore((state) => state.begin);
  const applyNativeEvent = useExecutionStore((state) => state.applyEvent);
  const applyNativeQuery = useExecutionStore((state) => state.applyQuery);
  const executionClient = useRef(createExecutionClient());
  const nativeStream = useRef<ExecutionEventStream | null>(null);
  const [nativeTargetId, setNativeTargetId] = useState<string | null>(null);
  const [nativeRunId, setNativeRunId] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void executionClient.current
      .listTargets()
      .then((targets) => {
        if (!cancelled)
          setNativeTargetId(
            targets.some((target) => target.id === 'logicpilot.native.session')
              ? 'logicpilot.native.session'
              : null,
          );
      })
      .catch(() => {
        if (!cancelled) setNativeTargetId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  useEffect(
    () => () => {
      nativeStream.current?.close();
      nativeStream.current = null;
    },
    [],
  );

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
  const [executionMode, setExecutionMode] = useState(runOptions.executionMode);
  const [speed, setSpeedField] = useState(String(runOptions.speed));

  // The run knobs and the precision-metric vocabulary are declared by the
  // active packs (docs/specs/dsl-freeze.md section 3), never by the shell.
  // Read the declarations once here so the draft sync below and the rendered
  // form share one source, and so an unspecified metric can fall back to the
  // pack's own first choice instead of a name the shell invented.
  const declarations = runParameterDeclarations();
  const metricDeclaration = declarations.find(
    (entry) => entry.parameter.id === 'metric' && entry.parameter.owner === 'model',
  );
  const defaultMetric = metricDeclaration?.parameter.choices?.[0]?.value ?? '';

  // The experiment the model declares (docs/specs/dsl-freeze.md section 3):
  // seed and the replication/precision settings belong to the revision, not to
  // this dialog. The dialog presents them and writes them to the model's
  // owner, it does not invent a second source.
  const experiments = useMemo(() => readExperiments(document), [document]);
  const [experimentName, setExperimentName] = useState<string | null>(null);
  const activeExperiment = useMemo(() => {
    if (experiments.length === 0) return null;
    return experiments.find((entry) => entry.name === experimentName) ?? experiments[0]!;
  }, [experiments, experimentName]);
  // Signature of the last applied declaration. The document re-parses on every
  // keystroke, so without this guard the model's values would overwrite what
  // the user is typing.
  const appliedExperiment = useRef<string | null>(null);
  useEffect(() => {
    if (activeExperiment === null) {
      appliedExperiment.current = null;
      return;
    }
    const signature = `${activeExperiment.name}|${experimentSignature(activeExperiment)}`;
    if (signature === appliedExperiment.current) return;
    appliedExperiment.current = signature;
    const next = applyExperimentFields(useRunStore.getState().runOptions, activeExperiment);
    setSeed(String(next.seed));
    setSeedMode(next.seedMode);
    setReps(String(next.reps));
    setReplicationMode(next.replicationMode);
    setMinReps(String(next.minReps));
    setMaxReps(String(next.maxReps));
    setErrorPercent(String(next.errorPercent));
    setPrecisionMetric(next.precisionMetric);
    setConfidence(String(next.confidence));
  }, [activeExperiment]);

  useEffect(() => {
    setRunOptions({
      seed: parseNum(seed) ?? initial.current.seed,
      seedMode,
      reps: parseNum(reps) ?? initial.current.reps,
      replicationMode,
      minReps: parseNum(minReps) ?? initial.current.minReps,
      maxReps: parseNum(maxReps) ?? initial.current.maxReps,
      errorPercent: parseNum(errorPercent) ?? initial.current.errorPercent,
      // An empty draft means nothing has declared one yet, so fall back to the
      // pack's own first choice: the store never holds a shell-invented name.
      precisionMetric: precisionMetric !== '' ? precisionMetric : defaultMetric,
      executionMode,
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
    defaultMetric,
    executionMode,
    arrivals,
    warmup,
    confidence,
    speed,
    setRunOptions,
  ]);

  // The run knobs are contributed by the active paradigm packs, so re-render
  // when the registry changes (a pack activating or unloading).
  useSyncExternalStore(subscribePluginRegistry, pluginRegistryGeneration);

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
    executionMode,
    arrivals: parseNum(arrivals) ?? Number.NaN,
    warmup: parseNum(warmup) ?? Number.NaN,
    confidence: parseNum(confidence) ?? Number.NaN,
    speed: parseNum(speed) ?? Number.NaN,
  };
  const validationError = validateRunOptions(draftOptions);
  const modelDiagnostics = diagnoseDocument('dsl', document);
  const blockingModelDiagnostics = modelDiagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  const nodeCount = document.nodes.length;

  // Run knobs come from the active packs (docs/specs/dsl-freeze.md section 3),
  // never from the shell. The bridge below maps a declared id onto the draft
  // value the dialog already keeps: `RunOptions` is still a fixed shape, so an
  // id with no storage here is skipped rather than guessed at (see
  // ide-layout.md section 7).
  const runKnobs = declarations.filter((entry) => entry.parameter.owner === 'run');
  const knobBindings: Record<string, { value: string; onChange: (next: string) => void }> = {
    arrivals: { value: arrivals, onChange: setArrivals },
    warmup: { value: warmup, onChange: setWarmup },
  };
  // A metric the model declares is always kept, even when the pack does not
  // list it, so nothing the model says is silently dropped; an empty draft is
  // dropped instead, so the select never renders a nameless option.
  const metricChoices = [
    ...new Set([
      ...(metricDeclaration?.parameter.choices ?? []).map((choice) => choice.value),
      precisionMetric,
    ]),
  ].filter((metric) => metric !== '');
  // What the run will actually stop on: the declared/drafted metric, or the
  // pack's first declared choice while nothing has declared one.
  const effectiveMetric = precisionMetric !== '' ? precisionMetric : (metricChoices[0] ?? '');

  const buildOptions = (): StartOptions => ({
    seed: parseNum(seed),
    seedMode,
    reps: parseNum(reps),
    replicationMode,
    minReps: parseNum(minReps),
    maxReps: parseNum(maxReps),
    errorPercent: parseNum(errorPercent),
    precisionMetric: effectiveMetric,
    executionMode,
    arrivals: parseNum(arrivals),
    warmup: parseNum(warmup),
    confidence: parseNum(confidence),
    speed: parseNum(speed),
  });
  const onNativeEvent = (event: Parameters<typeof applyNativeEvent>[0]) => {
    applyNativeEvent(event);
    projectExecutionEvent(event);
  };
  const onStart = () => {
    if (nativeTargetId !== null && nodeCount > 0) {
      setNativeError(null);
      void (async () => {
        try {
          const nativeSeed = seedMode === 'random' ? undefined : parseNum(seed);
          const session = await executionClient.current.start({
            requestId: `ide-${Date.now().toString(36)}`,
            targetId: nativeTargetId,
            ...(nativeSeed === undefined ? {} : { seed: nativeSeed }),
            budget: { maxWallMs: 10 * 60 * 1000 },
            inputs: {
              dsl: generateDsl(document),
              runParams: JSON.parse(JSON.stringify(buildOptions())) as JsonValue,
              executionMode,
              autoFinish: executionMode !== 'animated',
            },
          });
          resetVizState(vizState);
          beginNative(session);
          setNativeRunId(session.runId);
          nativeStream.current = await executionClient.current.subscribe(
            session.runId,
            -1,
            onNativeEvent,
            applyNativeQuery,
          );
        } catch (error) {
          setNativeError(error instanceof Error ? error.message : String(error));
        }
      })();
      return;
    }
    if (nodeCount === 0) {
      setNativeError('There is no executable model on the canvas. Add blocks or open a model first.');
    } else {
      // Canvas model: compile first, then run with the model's parameters.
      runCanvasModel();
    }
  };

  const nativeActive =
    nativeRunId !== null &&
    nativeSession !== null &&
    !['completed', 'failed', 'cancelled'].includes(nativeSession.status);
  const nativeControlState = nativeActive ? nativeSession?.status : 'idle';
  const canRun = nodeCount > 0 && (connected || nativeTargetId !== null);
  const sendNativeCommand = (action: 'pause' | 'resume' | 'step' | 'stop') => {
    if (!nativeSession) return;
    void executionClient.current
      .command({
        schema: 'logicpilot.execution-command/v1',
        contractVersion: 1,
        commandId: `ide-command-${Date.now().toString(36)}`,
        runId: nativeSession.runId,
        action,
        expectedStateVersion: nativeSession.stateVersion,
      })
      .catch((error) => setNativeError(error instanceof Error ? error.message : String(error)));
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
          <div className="run-field-group">
            <span className="run-field-group-label">Experiment (declared by the model)</span>
            {experiments.length > 0 && (
              <label className="field">
                <span>experiment</span>
                <select
                  value={activeExperiment?.name ?? ''}
                  disabled={!canRun}
                  onChange={(event) => setExperimentName(event.target.value)}
                >
                  {experiments.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="run-fields">
              <label className="field">
                <span>seed mode</span>
                <select
                  value={seedMode}
                  disabled={!canRun}
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
                disabled={!canRun || seedMode === 'random'}
              />
              <label className="field">
                <span>replications</span>
                <select
                  value={replicationMode}
                  disabled={!canRun}
                  onChange={(event) =>
                    setReplicationMode(event.target.value as typeof replicationMode)
                  }
                >
                  <option value="fixed">Fixed count</option>
                  <option value="precision">Until confidence target</option>
                </select>
              </label>
              {replicationMode === 'fixed' ? (
                <NumberField label="reps" value={reps} onChange={setReps} disabled={!canRun} />
              ) : (
                <>
                  <NumberField
                    label="minimum reps"
                    value={minReps}
                    onChange={setMinReps}
                    disabled={!canRun}
                  />
                  <NumberField
                    label="maximum reps"
                    value={maxReps}
                    onChange={setMaxReps}
                    disabled={!canRun}
                  />
                  <NumberField
                    label="error percent"
                    value={errorPercent}
                    onChange={setErrorPercent}
                    disabled={!canRun}
                  />
                  <label className="field" title={metricDeclaration?.parameter.hint ?? undefined}>
                    <span>{metricDeclaration?.parameter.label ?? 'precision metric'}</span>
                    <select
                      value={effectiveMetric}
                      disabled={!canRun}
                      onChange={(event) => setPrecisionMetric(event.target.value)}
                    >
                      {metricChoices.map((metric) => (
                        <option key={metric} value={metric}>
                          {metric}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <NumberField
                label="confidence"
                value={confidence}
                onChange={setConfidence}
                disabled={!canRun}
              />
            </div>
            <p className="dialog-hint">
              {activeExperiment !== null
                ? `Seed, replications and precision come from experiment ${activeExperiment.name} in the model; edit the \`experiment\` block to change them.`
                : 'The model declares no `experiment` block, so these values are placeholders. Add one to fix reproducibility and precision in the revision.'}
            </p>
          </div>
          <div className="run-field-group">
            <span className="run-field-group-label">This run</span>
            <div className="run-fields">
              {/* Knobs declared by the active paradigm pack for this run. A pack
                  that declares none contributes nothing here. */}
              {runKnobs.map(({ pluginId, parameter }) => {
                const binding = knobBindings[parameter.id];
                if (binding === undefined) return null;
                const title = parameter.hint ?? `Declared by ${pluginId}`;
                if (parameter.choices !== undefined && parameter.choices.length > 0) {
                  return (
                    <label className="field" key={parameter.id} title={title}>
                      <span>{parameter.label}</span>
                      <select
                        value={binding.value}
                        disabled={!canRun}
                        onChange={(event) => binding.onChange(event.target.value)}
                      >
                        {parameter.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label ?? choice.value}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (parameter.kind === 'boolean') {
                  return (
                    <label className="field" key={parameter.id} title={title}>
                      <span>{parameter.label}</span>
                      <select
                        value={binding.value}
                        disabled={!canRun}
                        onChange={(event) => binding.onChange(event.target.value)}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </label>
                  );
                }
                if (parameter.kind === 'integer' || parameter.kind === 'number') {
                  return (
                    <NumberField
                      key={parameter.id}
                      label={parameter.label}
                      value={binding.value}
                      onChange={binding.onChange}
                      disabled={!canRun}
                      title={title}
                    />
                  );
                }
                return (
                  <label className="field" key={parameter.id} title={title}>
                    <span>{parameter.label}</span>
                    <input
                      value={binding.value}
                      disabled={!canRun}
                      onChange={(event) => binding.onChange(event.target.value)}
                    />
                  </label>
                );
              })}
              {/* Pacing is the shell's own concern: batch vs animated changes
                  how a run is watched, not what the model means. */}
              <label className="field">
                <span>execution mode</span>
                <select
                  value={executionMode}
                  disabled={!canRun}
                  onChange={(event) => setExecutionMode(event.target.value as typeof executionMode)}
                >
                  <option value="fast">Fast (batch) - run at full speed</option>
                  <option value="animated">Animated (realtime) - pace by speed</option>
                </select>
              </label>
              <NumberField
                label="speed"
                value={speed}
                onChange={setSpeedField}
                disabled={!canRun || executionMode !== 'animated'}
              />
            </div>
            {executionMode === 'fast' && (
              <p className="dialog-hint">
                Fast mode ignores speed and runs without animation pacing; telemetry frames are
                rate-limited. Use Animated mode when you want to watch the simulation.
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="btn-primary"
              disabled={!canRun || validationError !== null || blockingModelDiagnostics.length > 0}
              onClick={onStart}
            >
              Start
            </button>
            <button
              disabled={
                nativeActive
                  ? nativeControlState !== 'running'
                  : !connected || controlState !== 'running'
              }
              title={
                (nativeActive ? nativeControlState !== 'running' : controlState !== 'running')
                  ? 'Pause needs a running simulation'
                  : undefined
              }
              onClick={() => (nativeActive ? sendNativeCommand('pause') : pause())}
            >
              Pause
            </button>
            <button
              disabled={
                nativeActive
                  ? nativeControlState !== 'paused'
                  : !connected || controlState !== 'paused'
              }
              title={
                (nativeActive ? nativeControlState !== 'paused' : controlState !== 'paused')
                  ? 'Resume needs a paused simulation'
                  : undefined
              }
              onClick={() => (nativeActive ? sendNativeCommand('resume') : resume())}
            >
              Resume
            </button>
            <button
              disabled={
                nativeActive
                  ? nativeControlState !== 'paused'
                  : !connected || controlState !== 'paused'
              }
              title={
                (nativeActive ? nativeControlState !== 'paused' : controlState !== 'paused')
                  ? 'Step requires a paused run'
                  : undefined
              }
              onClick={() => (nativeActive ? sendNativeCommand('step') : step())}
            >
              Step
            </button>
            <button
              disabled={nativeActive ? false : !connected || controlState === 'idle'}
              title={
                nativeActive
                  ? undefined
                  : controlState === 'idle'
                    ? 'Nothing is running'
                    : undefined
              }
              onClick={() => (nativeActive ? sendNativeCommand('stop') : stop())}
            >
              Stop
            </button>
          </div>
          {validationError !== null && <p className="ai-error">{validationError}</p>}
          {nativeError !== null && <p className="ai-error">{nativeError}</p>}
          {nodeCount > 0 && modelDiagnostics.length > 0 && (
            <div className="run-model-diagnostics" aria-label="Model diagnostics">
              <strong>
                Model preflight: {blockingModelDiagnostics.length} error(s),{' '}
                {modelDiagnostics.length - blockingModelDiagnostics.length} warning(s)
              </strong>
              <ul>
                {modelDiagnostics.map((diagnostic, index) => (
                  <li className={diagnostic.severity} key={`${diagnostic.code}-${index}`}>
                    <span>{diagnostic.code}</span> {diagnostic.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="dialog-hint">
            {nodeCount > 0
              ? 'Runs the model on the canvas (compiled first); parameters use the model\u2019s own rates.'
              : 'No executable model is open. Add blocks to the canvas or open a model file before running.'}
          </p>
        </div>
      </div>
    </div>
  );
}

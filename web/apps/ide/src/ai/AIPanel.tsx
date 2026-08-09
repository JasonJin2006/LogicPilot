// AI model panel: bootstrap an empty canvas, propose a structured ModelPatch
// for an existing model, validate/apply/run it, or query the last run's
// structured metrics. Optimization remains a separate experiment action.

import { useRef, useState } from 'react';
import { generateDsl } from '@logicpilot/editor';
import {
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  Eraser,
  FlaskConical,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import { mergeModelSource } from '../project/project';
import { saveProject } from '../project/syncEngine';
import {
  aiBuild,
  aiCompareMetrics,
  aiOptimize,
  aiProposePatch,
  aiQueryMetrics,
  aiRunDsl,
  runParameterVariation,
  aiValidateDsl,
} from './api';
import type {
  AiMetrics,
  AiResult,
  ExperimentSettings,
  MetricComparisonResult,
  MetricQueryResult,
  OptimizeResult,
  ParameterVariationResult,
} from './api';
import { OptimizeChart, TrajectoryChart } from './charts';
import { useAiConversationStore } from './conversationStore';
import { routeAiIntent, type AiAction } from './intentRouter';
import { createModelProposal, createPatchProposal, type ModelProposal } from './modelProposal';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useRunStore } from '../state/runStore';
import { ScrollArea } from '../components/ScrollArea';
import { useCanvasView } from '../state/canvasView';

const EXAMPLE_PROMPT = 'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0';

function sameExperiment(left: ExperimentSettings | undefined, right: ExperimentSettings): boolean {
  return (
    left != null &&
    left.seed === right.seed &&
    left.seedMode === right.seedMode &&
    left.reps === right.reps &&
    left.replicationMode === right.replicationMode &&
    left.minReps === right.minReps &&
    left.maxReps === right.maxReps &&
    left.errorPercent === right.errorPercent &&
    left.precisionMetric === right.precisionMetric &&
    left.arrivals === right.arrivals &&
    left.warmup === right.warmup &&
    left.confidence === right.confidence
  );
}

export function AIPanel() {
  const dslRef = useRef<HTMLPreElement>(null);
  const runRef = useRef<HTMLPreElement>(null);
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [proposal, setProposal] = useState<ModelProposal | null>(null);
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [variation, setVariation] = useState<ParameterVariationResult | null>(null);
  const [explained, setExplained] = useState<MetricQueryResult | null>(null);
  const [baselineMetrics, setBaselineMetrics] = useState<AiMetrics | null>(null);
  const [proposalExperiment, setProposalExperiment] = useState<ExperimentSettings | null>(null);
  const [comparison, setComparison] = useState<MetricComparisonResult | null>(null);
  const [proposalPrompt, setProposalPrompt] = useState('');
  const [error, setError] = useState('');
  const document = useModelStore((state) => state.document);
  const projectPath = useProjectStore((state) => state.path);
  const projectBundle = useProjectStore((state) => state.bundle);
  const runOptions = useRunStore((state) => state.runOptions);
  const experimentSettings = {
    seed: runOptions.seed,
    seedMode: runOptions.seedMode,
    reps: runOptions.reps,
    replicationMode: runOptions.replicationMode,
    minReps: runOptions.minReps,
    maxReps: runOptions.maxReps,
    errorPercent: runOptions.errorPercent,
    precisionMetric: runOptions.precisionMetric,
    arrivals: runOptions.arrivals,
    warmup: runOptions.warmup,
    confidence: runOptions.confidence,
  };
  const conversationScope = projectPath ?? `model:${document.name}`;
  const histories = useAiConversationStore((state) => state.histories);
  const conversation = histories[conversationScope] ?? [];
  const appendConversation = useAiConversationStore((state) => state.append);
  const clearConversation = useAiConversationStore((state) => state.clear);
  const moveConversation = useAiConversationStore((state) => state.move);
  const proposalStale = proposal !== null && proposal.baseDocument !== document;
  const loadToCanvas = async () => {
    if (proposal?.patch == null) return;
    if (proposal.baseDocument !== useModelStore.getState().document) {
      setError('The model changed after this proposal was generated. Generate a fresh patch.');
      return;
    }
    setError('');
    const applied = useModelStore.getState().applyPatch(proposal.patch);
    if (!applied.ok) {
      setError(applied.diagnostics.map((entry) => entry.message).join('; '));
      return;
    }
    const acceptedPatch = proposal.patch;
    const acceptedDescription = proposal.descriptions.join('; ');
    const nextScope = projectPath ?? `model:${applied.document.name}`;
    // Accepting an AI change is a modeling action: take the user straight to
    // the resulting root canvas instead of leaving a successful model hidden
    // behind an empty center area.
    useCanvasView.getState().setView(null);
    if (nextScope !== conversationScope) moveConversation(conversationScope, nextScope);
    setBusy(true);
    try {
      const acceptedExperiment = proposalExperiment ?? experimentSettings;
      const appliedRun = await aiRunDsl(generateDsl(applied.document), acceptedExperiment);
      setResult(appliedRun);
      let comparisonResult: MetricComparisonResult | null = null;
      if (baselineMetrics !== null && appliedRun.metrics != null) {
        comparisonResult = await aiCompareMetrics(
          baselineMetrics,
          appliedRun.metrics,
          acceptedExperiment.confidence,
        );
        setComparison(comparisonResult);
      } else {
        setComparison(null);
      }
      appendConversation(nextScope, {
        user: proposalPrompt,
        assistant: [
          acceptedDescription,
          appliedRun.ok
            ? 'Validation and simulation completed.'
            : 'The accepted patch did not run successfully.',
          ...(comparisonResult?.findings ?? []),
        ]
          .filter(Boolean)
          .join(' '),
        patch: acceptedPatch,
        outcome: appliedRun.ok ? 'applied' : 'run_failed',
      });
      setProposal(null);
      setProposalPrompt('');
      setBaselineMetrics(null);
      setProposalExperiment(null);
    } catch (err) {
      appendConversation(nextScope, {
        user: proposalPrompt,
        assistant: `${acceptedDescription} The patch was applied, but the run tool failed.`,
        patch: acceptedPatch,
        outcome: 'run_failed',
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async (kind: AiAction, requestPrompt = prompt) => {
    const completedMetrics = result?.metrics;
    setBusy(true);
    setError('');
    // A model-generation request replaces the primary result. Analysis tools
    // operate on it, so keep the last valid run visible if one of them fails.
    if (kind === 'build') setResult(null);
    setProposal(null);
    setOptimized(null);
    setVariation(null);
    setExplained(null);
    if (kind === 'build') {
      setComparison(null);
      setProposalPrompt('');
      setProposalExperiment(null);
    }
    try {
      if (kind === 'variation') {
        const currentDocument = useModelStore.getState().document;
        let variationDsl = result?.dsl ?? generateDsl(currentDocument);
        if (projectBundle !== null) {
          // Rebuild the project projection from the live canvas while
          // preserving experiment files from the current bundle. This avoids
          // sweeping stale values when the canvas has unsaved edits.
          const projected = saveProject(currentDocument, projectBundle);
          const blocking = projected.diagnostics.filter(
            (diagnostic) => diagnostic.severity === 'error',
          );
          if (blocking.length > 0) {
            throw new Error(blocking.map((diagnostic) => diagnostic.message).join('; '));
          }
          variationDsl = mergeModelSource(
            projected.bundle.files[projected.bundle.manifest.model] ?? '',
            projected.bundle.files,
            projected.bundle.manifest.modelParts,
          );
        }
        setVariation(
          await runParameterVariation(variationDsl, {
            arrivals: runOptions.arrivals,
            warmup: runOptions.warmup,
          }),
        );
      } else if (kind === 'optimize') {
        setOptimized(await aiOptimize(requestPrompt));
      } else if (kind === 'explain') {
        if (completedMetrics == null) {
          setError('Run and apply a model before asking a result question.');
        } else {
          setExplained(await aiQueryMetrics(requestPrompt, completedMetrics));
        }
      } else {
        const current = useModelStore.getState().document;
        if (current.nodes.length > 0) {
          const currentDsl = generateDsl(current);
          let baseline =
            completedMetrics != null &&
            result?.dsl === currentDsl &&
            sameExperiment(result.experiment, experimentSettings)
              ? completedMetrics
              : null;
          let baselineExperiment = result?.experiment ?? experimentSettings;
          if (baseline === null) {
            const baselineRun = await aiRunDsl(currentDsl, experimentSettings);
            if (baselineRun.ok && baselineRun.metrics != null) {
              baseline = baselineRun.metrics;
              baselineExperiment = baselineRun.experiment ?? experimentSettings;
            }
          }
          setBaselineMetrics(baseline);
          setProposalExperiment(baselineExperiment);
          const proposed = await aiProposePatch(requestPrompt, current, conversation);
          if (!proposed.supported) {
            setError(
              'No safe structured change could be inferred. Name the target block and requested operation.',
            );
          } else {
            const nextProposal = createPatchProposal(current, proposed.patch);
            if (!nextProposal.ok || nextProposal.candidateDocument === null) {
              setError(nextProposal.error ?? 'invalid model proposal');
            } else {
              const candidateDsl = generateDsl(nextProposal.candidateDocument);
              const validation = await aiValidateDsl(candidateDsl);
              setResult({
                ok: validation.ok,
                iterations: 0,
                dsl: candidateDsl,
                diagnostics: validation.diagnostics,
                runSummary: '',
                mode: 'validated',
              });
              if (validation.ok) setProposal(nextProposal);
              if (validation.ok) setProposalPrompt(requestPrompt);
            }
          }
        } else {
          setBaselineMetrics(null);
          const built = await aiBuild(requestPrompt, generateDsl(current), experimentSettings);
          setResult(built);
          if (built.ok) {
            const nextProposal = createModelProposal(current, built.dsl);
            setProposal(nextProposal);
            setProposalPrompt(requestPrompt);
            if (!nextProposal.ok) setError(nextProposal.error ?? 'invalid model proposal');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const defaultPromptFor = (action: AiAction): string => {
    switch (action) {
      case 'optimize':
        return 'Optimize the current model.';
      case 'variation':
        return 'Run a parameter study for the current model.';
      case 'explain':
        return 'Explain the last simulation results.';
      default:
        return '';
    }
  };

  const dispatchAction = (action: AiAction, candidatePrompt = prompt) => {
    const requestPrompt = candidatePrompt.trim() || defaultPromptFor(action);
    if (requestPrompt === '') {
      setError('Describe the model or change you want Copilot to make.');
      return;
    }
    setPrompt('');
    void run(action, requestPrompt);
  };

  const submitPrompt = () => {
    const decision = routeAiIntent(prompt, {
      hasModel: document.nodes.length > 0,
      hasMetrics: result?.metrics != null,
    });
    dispatchAction(decision.action, decision.cleanedPrompt);
  };

  return (
    <div className="ai-panel">
      <header className="ai-header">
        <div className="ai-identity">
          <span className="ai-avatar" aria-hidden>
            <Sparkles size={16} />
          </span>
          <span>
            <strong>LogicPilot Copilot</strong>
            <small>
              {document.nodes.length > 0
                ? `${document.name} · ${document.nodes.length} blocks in context`
                : 'Ready to create your first model'}
            </small>
          </span>
        </div>
        {conversation.length > 0 && (
          <button
            className="ai-icon-button"
            aria-label="Clear conversation"
            title="Clear conversation"
            disabled={busy}
            onClick={() => clearConversation(conversationScope)}
          >
            <Eraser size={14} />
          </button>
        )}
      </header>
      <div className="ai-thread" aria-label="AI modeling conversation">
        {conversation.length === 0 && result === null && (
          <div className="ai-welcome">
            <span className="ai-welcome-mark" aria-hidden>
              <Bot size={20} />
            </span>
            <h2>Build models by describing them</h2>
            <p>
              I can create a DES flow, change the current canvas, run experiments, and explain the
              results without taking you out of the editor.
            </p>
            <div className="ai-suggestions" aria-label="Suggested prompts">
              {[
                'Build a call center with two agents',
                'Add a priority queue before service',
                'Find the bottleneck in my last run',
              ].map((suggestion) => (
                <button key={suggestion} onClick={() => setPrompt(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {conversation.slice(-6).map((turn) => (
          <div className="ai-turn" key={turn.id}>
            <div className="ai-message user">
              <span className="ai-message-avatar" aria-hidden>
                <UserRound size={13} />
              </span>
              <div>
                <strong>You</strong>
                <p>{turn.user}</p>
              </div>
            </div>
            <div className="ai-message assistant">
              <span className="ai-message-avatar" aria-hidden>
                <Sparkles size={13} />
              </span>
              <div>
                <strong>Copilot</strong>
                <p>{turn.assistant}</p>
                <span className={`ai-outcome ${turn.outcome}`}>
                  <CheckCircle2 size={11} /> {turn.outcome === 'applied' ? 'Applied' : 'Run failed'}
                </span>
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="ai-thinking" role="status">
            <span /> <span /> <span />
            <em>Reading the model and choosing the next action…</em>
          </div>
        )}
        {error !== '' && <p className="ai-error">{error}</p>}
        {variation !== null && (
          <div className="ai-result">
            <p className="ai-meta">
              {variation.name}: {variation.pointCount} parameter combinations; metric{' '}
              {variation.metric}
            </p>
            <table className="ai-scores" aria-label="Parameter variation results">
              <thead>
                <tr>
                  <th>Parameters</th>
                  <th>Mean</th>
                  <th>CI</th>
                  <th>Reps</th>
                </tr>
              </thead>
              <tbody>
                {variation.iterations.map((iteration) => {
                  const summary = iteration.metrics.summary?.[variation.metric];
                  return (
                    <tr key={iteration.index}>
                      <td>
                        {Object.entries(iteration.parameters)
                          .map(([name, value]) => `${name}=${value}`)
                          .join(', ')}
                      </td>
                      <td>{summary?.mean?.toFixed(4) ?? 'n/a'}</td>
                      <td>
                        {summary == null
                          ? 'n/a'
                          : `[${summary.ci_low.toFixed(4)}, ${summary.ci_high.toFixed(4)}]`}
                      </td>
                      <td>{iteration.run.actualReps}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result !== null && (
          <div className="ai-result">
            {result.ok ? (
              <>
                <p className="ai-meta">
                  {result.mode === 'validated'
                    ? 'validated structured ModelPatch candidate'
                    : result.iterations > 0
                      ? `compiled in ${result.iterations} iteration(s)`
                      : 'validated and ran the applied canvas model'}
                </p>
                {result.experiment != null && (
                  <p className="ai-meta">
                    experiment: seed={result.experiment.seed}, reps={result.experiment.reps},
                    arrivals=
                    {result.experiment.arrivals}, warmup={result.experiment.warmup},{' '}
                    {(result.experiment.confidence * 100).toFixed(0)}% CI
                  </p>
                )}
                {proposal?.patch != null && (
                  <div className="ai-patch-preview">
                    <p className="ai-meta">
                      Proposed ModelPatch: {proposal.descriptions.length} operation(s)
                      {proposal.destructiveOperations > 0
                        ? ` — review ${proposal.destructiveOperations} destructive operation(s)`
                        : ' — no destructive operations'}
                    </p>
                    {proposalStale && (
                      <p className="ai-error">
                        The canvas changed after this proposal. Generate it again before applying.
                      </p>
                    )}
                    {proposal.descriptions.length > 0 ? (
                      <ul className="ai-findings">
                        {proposal.descriptions.map((description, index) => (
                          <li key={`${index}:${description}`}>{description}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ai-meta">The current model already matches this request.</p>
                    )}
                    <button
                      className="ai-load"
                      disabled={busy || proposal.descriptions.length === 0 || proposalStale}
                      onClick={() => void loadToCanvas()}
                    >
                      Apply model patch
                    </button>
                  </div>
                )}
                <details className="ai-artifact">
                  <summary>
                    <Code2 size={13} /> Generated DSL <ChevronDown size={12} />
                  </summary>
                  <ScrollArea className="ai-dsl-scroll" scrollRef={dslRef}>
                    <pre ref={dslRef} className="ai-dsl scroll-hidden">
                      {result.dsl}
                    </pre>
                  </ScrollArea>
                </details>
                {result.runSummary !== '' && (
                  <details className="ai-artifact">
                    <summary>
                      <TerminalSquare size={13} /> Run log <ChevronDown size={12} />
                    </summary>
                    <ScrollArea className="ai-run-scroll" scrollRef={runRef}>
                      <pre ref={runRef} className="ai-run scroll-hidden">
                        {result.runSummary}
                      </pre>
                    </ScrollArea>
                  </details>
                )}
                {result.metrics?.blocks != null && result.metrics.blocks.length > 0 && (
                  <table className="ai-scores" aria-label="DES block statistics">
                    <thead>
                      <tr>
                        <th>Block</th>
                        <th>Out</th>
                        <th>Mean size</th>
                        <th>Util.</th>
                        <th>Timeout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.blocks.map((block) => (
                        <tr key={`${block.kind}:${block.name}`}>
                          <td>{block.name}</td>
                          <td>{block.departed_mean.toFixed(0)}</td>
                          <td>{block.mean_occupancy.toFixed(3)}</td>
                          <td>{(block.utilization * 100).toFixed(1)}%</td>
                          <td>{block.timed_out_mean.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {result.trajectory != null && result.trajectory.points.length > 0 && (
                  <TrajectoryChart trajectory={result.trajectory} />
                )}
              </>
            ) : (
              <ul className="ai-diagnostics">
                {result.diagnostics.map((diagnostic, index) => (
                  <li key={index}>
                    {diagnostic.code}: {diagnostic.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {optimized !== null && (
          <div className="ai-result">
            <p className="ai-meta">
              best {optimized.variable}={optimized.best.value} ({optimized.objective}{' '}
              {optimized.metric} → {optimized.best.score},{optimized.strategy},{' '}
              {optimized.evaluations.length} evaluations)
            </p>
            <OptimizeChart evaluations={optimized.evaluations} objective={optimized.objective} />
            <table className="ai-scores">
              <thead>
                <tr>
                  <th>{optimized.variable}</th>
                  <th>{optimized.metric}</th>
                </tr>
              </thead>
              <tbody>
                {optimized.evaluations.map((entry) => (
                  <tr key={entry.value}>
                    <td>{entry.value}</td>
                    <td>{entry.score.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {explained !== null && (
          <div className="ai-result">
            <p className="ai-meta">{explained.question}</p>
            <ul className="ai-findings">
              {explained.findings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
            <p className="ai-meta">
              evidence: {explained.evidence.blockCount} blocks
              {explained.evidence.busiestBlock !== null
                ? `, busiest=${explained.evidence.busiestBlock}`
                : ''}
              {explained.evidence.largestQueue !== null
                ? `, largest queue=${explained.evidence.largestQueue}`
                : ''}
            </p>
          </div>
        )}
        {comparison !== null && (
          <div className="ai-result">
            <p className="ai-meta">Before/after comparison using identical run settings</p>
            <ul className="ai-findings">
              {comparison.findings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
            <table className="ai-scores" aria-label="DES before and after comparison">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Status</th>
                  <th>Δ out</th>
                  <th>Δ size</th>
                  <th>Δ util.</th>
                </tr>
              </thead>
              <tbody>
                {comparison.blocks.map((block) => (
                  <tr key={block.key}>
                    <td>{block.name}</td>
                    <td>{block.status}</td>
                    <td>{block.metrics.departed_mean.delta.toFixed(1)}</td>
                    <td>{block.metrics.mean_occupancy.delta.toFixed(3)}</td>
                    <td>{(block.metrics.utilization.delta * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="ai-composer-shell">
        <textarea
          className="ai-input"
          value={prompt}
          disabled={busy}
          rows={3}
          placeholder={
            document.nodes.length > 0
              ? 'Ask Copilot to change, run, or explain this model…'
              : 'Describe the system you want to simulate…'
          }
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy && prompt.trim() !== '') submitPrompt();
            }
          }}
        />
        <div className="ai-composer-actions">
          <details className="ai-tools-menu">
            <summary title="More AI actions">
              <WandSparkles size={14} />
              <span>Tools</span>
              <ChevronDown size={12} />
            </summary>
            <div className="ai-tools-popover">
              <button disabled={busy} onClick={() => dispatchAction('optimize')}>
                <SlidersHorizontal size={14} />
                <span>
                  <strong>Optimize model</strong>
                  <small>Search for a better parameter value</small>
                </span>
              </button>
              <button disabled={busy} onClick={() => dispatchAction('variation')}>
                <FlaskConical size={14} />
                <span>
                  <strong>Parameter study</strong>
                  <small>Compare a range of scenarios</small>
                </span>
              </button>
              <button
                disabled={busy || result?.metrics == null}
                onClick={() => dispatchAction('explain')}
              >
                <BarChart3 size={14} />
                <span>
                  <strong>Explain last run</strong>
                  <small>Ask questions about current metrics</small>
                </span>
              </button>
            </div>
          </details>
          <span className="ai-context-pill">
            {document.nodes.length > 0 ? `${document.nodes.length} blocks` : 'Empty canvas'}
          </span>
          <button
            className="ai-send"
            aria-label="Send to Copilot"
            title="Send (Enter)"
            disabled={busy || prompt.trim() === ''}
            onClick={submitPrompt}
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

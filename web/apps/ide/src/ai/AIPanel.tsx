// AI model panel: bootstrap an empty canvas, propose a structured ModelPatch
// for an existing model, validate/apply/run it, or query the last run's
// structured metrics. Optimization remains a separate experiment action.

import { useEffect, useRef, useState } from 'react';
import { generateDsl, type ModelPatch } from '@logicpilot/editor';
import {
  BarChart3,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Eraser,
  FlaskConical,
  ListChecks,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  UserRound,
  WandSparkles,
  X,
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
import { buildAssistantContext } from './contextBuilder';
import {
  runAssistantTurn,
  type AssistantPatchApprovalRequest,
  type AssistantStepRecord,
} from './assistantRuntime';
import { createAssistantSession } from './assistantTypes';
import type { AssistantTurnMessage } from './assistantTypes';
import { undoAssistantChange } from './assistantTools';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useRunStore } from '../state/runStore';
import { ScrollArea } from '../components/ScrollArea';
import { useCanvasView } from '../state/canvasView';
import { getAppConfig } from '../state/appConfig';

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

interface PendingAssistantApproval {
  summary: string;
  proposal: ModelProposal;
}

export function AIPanel() {
  const dslRef = useRef<HTMLPreElement>(null);
  const runRef = useRef<HTMLPreElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState('');
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
  // Assistant Runtime state: the persistent session (dsl/diagnostics/run
  // metrics/undo bookkeeping) survives across turns; live steps render the
  // in-flight tool execution inline.
  const sessionRef = useRef(createAssistantSession());
  const abortRef = useRef<AbortController | null>(null);
  const approvalRef = useRef<{
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [liveSteps, setLiveSteps] = useState<AssistantStepRecord[]>([]);
  const [assistantApproval, setAssistantApproval] = useState<PendingAssistantApproval | null>(null);
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
  const settleAssistantApproval = (approved: boolean) => {
    const pending = approvalRef.current;
    if (pending === null) return;
    approvalRef.current = null;
    setAssistantApproval(null);
    pending.resolve(approved);
  };
  useEffect(
    () => () => {
      approvalRef.current?.resolve(false);
      approvalRef.current = null;
    },
    [],
  );
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [assistantApproval, busy, conversation.length, error, liveSteps]);
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
    // Analysis tools also see metrics produced by assistant-driven runs.
    const completedMetrics = result?.metrics ?? sessionRef.current.runMetrics;
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

  // Assistant Runtime: one continuous conversation turn with inline tool
  // execution. Falls back to the intent-router one-shot path when the
  // assistant endpoint is unavailable (e.g. no server-side API key).
  const sendAssistant = async () => {
    const request = prompt.trim();
    if (request === '' || busy) {
      return;
    }
    const session = sessionRef.current;
    const current = useModelStore.getState().document;
    session.documentSnapshot = current;
    if (session.dsl === '') {
      session.dsl = generateDsl(current);
    }
    setPrompt('');
    setError('');
    setBusy(true);
    setLiveSteps([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const context = buildAssistantContext({
      projectName: projectPath ?? document.name,
      document: current,
      selectedId: useModelStore.getState().selectedId,
      session,
    });
    const history: AssistantTurnMessage[] = conversation.slice(-6).flatMap((turn) => [
      { role: 'user' as const, content: turn.user },
      { role: 'assistant' as const, content: turn.assistant },
    ]);
    const config = await getAppConfig();
    const confirmModelPatch = (request: AssistantPatchApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        const currentDocument = useModelStore.getState().document;
        const nextProposal = createPatchProposal(currentDocument, request.patch);
        if (!nextProposal.ok || nextProposal.candidateDocument === null) {
          setError(nextProposal.error ?? 'The proposed model change is invalid.');
          resolve(false);
          return;
        }
        approvalRef.current?.resolve(false);
        approvalRef.current = { resolve };
        setAssistantApproval({
          summary: request.summary,
          proposal: nextProposal,
        });
      });
    const result = await runAssistantTurn({
      message: request,
      context,
      session,
      history,
      apiBase: config?.apiBase ?? '',
      signal: controller.signal,
      onProgress: setLiveSteps,
      confirmModelPatch,
    });
    abortRef.current = null;
    setBusy(false);
    setLiveSteps([]);
    if (result.cancelled) {
      setError('Assistant step cancelled.');
      return;
    }
    if (!result.ok && (result.error ?? '').includes('OPENAI_API_KEY')) {
      setError('Assistant endpoint unavailable (no API key); using quick actions.');
      const decision = routeAiIntent(request, {
        hasModel: current.nodes.length > 0,
        hasMetrics: session.runMetrics != null,
      });
      dispatchAction(decision.action, decision.cleanedPrompt);
      return;
    }
    appendConversation(conversationScope, {
      user: request,
      assistant:
        result.message !== ''
          ? result.message
          : result.ok
            ? 'Done.'
            : 'The request did not complete.',
      patch: session.lastPatch ?? { version: 1, operations: [] },
      outcome: result.ok
        ? result.undoTokenId !== undefined
          ? 'applied'
          : 'completed'
        : 'run_failed',
      assistantRecord: {
        steps: result.steps,
        error: result.error,
        cancelled: result.cancelled,
        undoable: result.undoTokenId !== undefined,
        undoTokenId: result.undoTokenId,
        changeSummary: session.lastChangeSummary,
      },
    });
  };

  const cancelAssistant = () => {
    abortRef.current?.abort();
    settleAssistantApproval(false);
  };

  // Undo the most recent AI-applied change (one atomic undo step).
  const undoLastChange = (tokenId: string) => {
    const session = sessionRef.current;
    const undone = undoAssistantChange(session, tokenId);
    if (!undone.ok) {
      setError(undone.error ?? 'This AI change can no longer be undone safely.');
      return;
    }
    session.lastPatch = null;
    session.lastChangeSummary = '';
    setError('');
  };

  const patchSummaryLines = (patch: ModelPatch | null): string[] => {
    if (!patch) {
      return [];
    }
    const lines: string[] = [];
    for (const operation of patch.operations) {
      switch (operation.op) {
        case 'add_block':
          lines.push(`Add ${operation.kind} '${operation.name}'`);
          break;
        case 'update_block':
          lines.push(
            `Update '${operation.target}': ${Object.entries(operation.params ?? {})
              .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
              .join(', ')}`,
          );
          break;
        case 'remove_block':
          lines.push(`Remove '${operation.target}'`);
          break;
        case 'connect':
          lines.push(
            `Connect ${operation.from}.${operation.fromPort ?? 'out'} → ${operation.to}.${operation.toPort ?? 'in'}`,
          );
          break;
        case 'disconnect':
          lines.push(`Disconnect ${operation.from ?? '?'} → ${operation.to ?? '?'}`);
          break;
        case 'rename_model':
          lines.push(`Rename model to '${operation.name}'`);
          break;
      }
    }
    return lines;
  };

  const renderSteps = (steps: AssistantStepRecord[]) => (
    <ul className="ai-steps">
      {steps.map((step, index) => {
        if (step.kind === 'message') {
          return (
            <li key={index} className="ai-step-message">
              {step.label}
            </li>
          );
        }
        if (step.kind === 'plan') {
          return (
            <li key={index} className="ai-step-plan">
              <span className="ai-step-dot" aria-hidden />
              {step.label}
            </li>
          );
        }
        if (step.kind === 'approval') {
          return (
            <li key={index} className={`ai-step-approval ${step.status ?? 'pending'}`}>
              <span className="ai-step-state" aria-hidden />
              {step.label}
            </li>
          );
        }
        if (step.kind === 'tool') {
          return (
            <li key={index} className={`ai-step-tool ${step.status ?? 'running'}`}>
              {step.status === 'running' || step.status == null ? (
                <span className="ai-step-spinner" aria-hidden />
              ) : (
                <span className="ai-step-state" aria-hidden />
              )}
              {step.label}
              {step.status === 'running' || step.status == null ? '…' : ''}
            </li>
          );
        }
        if (step.kind === 'tool-result') {
          return (
            <li key={index} className="ai-step-result">
              {step.label}
            </li>
          );
        }
        return (
          <li key={index} className="ai-step-error">
            {step.label}
          </li>
        );
      })}
    </ul>
  );

  const renderActivity = (steps: AssistantStepRecord[]) => {
    const completed = steps.filter(
      (step) => step.kind === 'tool-result' && step.ok !== false,
    ).length;
    const failures = steps.filter((step) => step.kind === 'error').length;
    return (
      <details className="ai-activity">
        <summary>
          <ListChecks size={12} />
          {completed > 0 ? `${completed} tool step${completed === 1 ? '' : 's'}` : 'Activity'}
          {failures > 0 ? ` · ${failures} issue${failures === 1 ? '' : 's'}` : ''}
          <ChevronDown size={11} />
        </summary>
        {renderSteps(steps)}
      </details>
    );
  };

  const outcomeLabel = (outcome: 'applied' | 'completed' | 'run_failed') => {
    if (outcome === 'applied') return 'Model updated';
    if (outcome === 'completed') return 'Completed';
    return 'Needs attention';
  };

  const submitPrompt = () => {
    void sendAssistant();
  };

  return (
    <div className="ai-panel">
      <div className="ai-thread" aria-label="AI modeling conversation">
        {conversation.length === 0 && result === null && !busy && (
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
                {turn.assistantRecord?.steps != null &&
                  turn.assistantRecord.steps.length > 0 &&
                  renderActivity(turn.assistantRecord.steps)}
                {turn.assistantRecord?.error != null && (
                  <p className="ai-error">{turn.assistantRecord.error}</p>
                )}
                <span className={`ai-outcome ${turn.outcome}`}>
                  <CheckCircle2 size={11} /> {outcomeLabel(turn.outcome)}
                </span>
                {turn.assistantRecord?.undoable === true &&
                  turn.assistantRecord.undoTokenId != null && (
                    <span className="ai-turn-actions">
                      {turn.patch != null && turn.patch.operations.length > 0 && (
                        <details className="ai-changes">
                          <summary title="View the changes made by this turn">
                            View changes <ChevronDown size={11} />
                          </summary>
                          <ul className="ai-findings">
                            {patchSummaryLines(turn.patch).map((line, index) => (
                              <li key={`${index}:${line}`}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <button
                        className="ai-undo"
                        disabled={
                          busy ||
                          sessionRef.current.activeUndo?.id !== turn.assistantRecord.undoTokenId ||
                          sessionRef.current.activeUndo?.after !== document
                        }
                        onClick={() => undoLastChange(turn.assistantRecord!.undoTokenId!)}
                        title="Undo the last AI-applied change"
                      >
                        Undo
                      </button>
                    </span>
                  )}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="ai-working-card" aria-live="polite">
            <div className="ai-working-header">
              <span className="ai-step-spinner" aria-hidden />
              <div>
                <strong>
                  {assistantApproval === null ? 'Working on your model' : 'Approval needed'}
                </strong>
                <small>
                  {assistantApproval === null
                    ? 'Inspecting the canvas, compiling and running tools as needed'
                    : 'The canvas is unchanged until you approve this patch'}
                </small>
              </div>
            </div>
            {liveSteps.length > 0 ? renderSteps(liveSteps) : <p>Reading the current model…</p>}
            {assistantApproval !== null && (
              <section className="ai-approval-card" aria-label="Review proposed model change">
                <header>
                  <AlertTriangle size={14} />
                  <strong>Review model change</strong>
                </header>
                <p>{assistantApproval.summary}</p>
                <div className="ai-approval-meta">
                  <span>{assistantApproval.proposal.descriptions.length} operations</span>
                  {assistantApproval.proposal.destructiveOperations > 0 && (
                    <span className="destructive">
                      {assistantApproval.proposal.destructiveOperations} destructive
                    </span>
                  )}
                </div>
                <ul>
                  {assistantApproval.proposal.descriptions.slice(0, 6).map((description, index) => (
                    <li key={`${index}:${description}`}>{description}</li>
                  ))}
                </ul>
                {assistantApproval.proposal.descriptions.length > 6 && (
                  <p className="ai-approval-more">
                    +{assistantApproval.proposal.descriptions.length - 6} more operations
                  </p>
                )}
                <footer>
                  <button className="secondary" onClick={() => settleAssistantApproval(false)}>
                    <X size={13} /> Keep current model
                  </button>
                  <button className="primary" onClick={() => settleAssistantApproval(true)}>
                    <Check size={13} /> Apply and continue
                  </button>
                </footer>
              </section>
            )}
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
        <div ref={threadEndRef} className="ai-thread-end" aria-hidden />
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
                disabled={busy || (result?.metrics ?? sessionRef.current.runMetrics) == null}
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
          {document.nodes.length > 0 && (
            <span className="ai-context-pill">{document.nodes.length} blocks</span>
          )}
          {busy ? (
            <button
              className="ai-send"
              aria-label="Stop assistant"
              title="Stop"
              onClick={cancelAssistant}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="ai-send"
              aria-label="Send to Copilot"
              title="Send (Enter)"
              disabled={prompt.trim() === ''}
              onClick={submitPrompt}
            >
              <SendHorizontal size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

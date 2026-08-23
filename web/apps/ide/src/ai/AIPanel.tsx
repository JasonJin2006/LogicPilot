// AI model panel: bootstrap an empty canvas, propose a structured ModelPatch
// for an existing model, validate/apply/run it, or query the last run's
// structured metrics. Optimization remains a separate experiment action.

import { useEffect, useRef, useState } from 'react';
import { generateDsl, type ModelPatch } from '@logicpilot/editor';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Eraser,
  ListChecks,
  Mic,
  MoreHorizontal,
  Plus,
  Pin,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  UserRound,
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
import { aiSessionScope, useAiConversationStore } from './conversationStore';
import type { AiSession } from './conversationStore';
import { LOGICPILOT_MODELING_PROFILE } from './agentProfiles';
import { LOGICPILOT_MODELING_READONLY_CAPABILITY } from './agentCapabilities';
import { createMcpTools, discoverMcpCapabilities } from './mcpClient';
import type { AssistantTool } from './capabilities/logicpilot-modeling/tools';
import { createAssistantKernel } from './assistantKernel';
import type { AiAction } from './intentRouter';
import { createModelProposal, createPatchProposal, type ModelProposal } from './modelProposal';
import { buildAssistantContext } from './contextBuilder';
import {
  runAssistantTurn,
  type AssistantPatchApprovalRequest,
  type AssistantToolApprovalRequest,
  type AssistantStepRecord,
} from './assistantRuntime';
import { createAssistantSession } from './assistantTypes';
import type { AssistantTurnMessage } from './assistantTypes';
import { undoAssistantChange } from './capabilities/logicpilot-modeling/runtime';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useRunStore } from '../state/runStore';
import { useUiStore } from '../state/uiStore';
import { documentContributionFor } from '../workbench/documentTypes';
import { ScrollArea } from '../components/ScrollArea';
import { useCanvasView } from '../state/canvasView';
import { getAppConfig } from '../state/appConfig';
import { getAiProviderState, listAiProviderModels, saveAiProvider } from './providerConfig';
import { isAssistantNotConfiguredError } from './assistantErrors';

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

interface PendingToolApproval {
  toolName: string;
  summary: string;
  arguments: Record<string, unknown>;
}

type PermissionMode = 'Full access' | 'Workspace' | 'Read only';
type VoiceState = 'idle' | 'listening' | 'transcribing' | 'error';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript: string };
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: () => void;
  onresult: (event: SpeechRecognitionEventLike) => void;
  onend: () => void;
  onerror: (event: { error?: string }) => void;
  start: () => void;
  stop: () => void;
}

/** Streaming providers often emit the wire JSON before the final parsed
 * response arrives. Keep that protocol transcript out of the conversation
 * surface; the structured tool activity is rendered separately. */
function visibleLiveResponse(value: string): string {
  const text = value.trim();
  if (text === '') return '';
  if (/^(?:```(?:json)?\s*)?\s*\{/i.test(text)) return '';
  if (/tool_call_id\s*:|proposed tool calls:|"toolCalls"\s*:/i.test(text)) {
    const marker = text.search(
      /\n\s*(?:```(?:json)?\s*)?\{\s*["']?(?:message|plan|toolCalls|done)/i,
    );
    return marker > 0 ? text.slice(0, marker).trim() : '';
  }
  return text;
}

function relativeSessionTime(value: string): string {
  const age = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

// Each WebView/window gets its own fallback scope when no workspace is open.
// Workspace-backed sessions use the workspace path instead.
const WINDOW_SESSION_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `window-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const NOT_CONFIGURED_MESSAGE =
  '未配置 AI 模型。请打开 Settings → AI & Models 选择 provider 并配置 API Key(或使用 Codex 登录)后再开始对话。';

export function AIPanel() {
  const dslRef = useRef<HTMLPreElement>(null);
  const runRef = useRef<HTMLPreElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('Workspace');
  const toolsEnabled = useUiStore((s) => s.aiToolsEnabled);
  const sourceEditingEnabled = useUiStore((s) => s.aiSourceEditingEnabled);
  const [modelLabel, setModelLabel] = useState('Auto');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const activeSessionScopeRef = useRef<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
  const sessionCacheRef = useRef(new Map<string, ReturnType<typeof createAssistantSession>>());
  const abortRef = useRef<AbortController | null>(null);
  const approvalRef = useRef<{
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [liveSteps, setLiveSteps] = useState<AssistantStepRecord[]>([]);
  const [liveResponse, setLiveResponse] = useState('');
  const [streamingRequest, setStreamingRequest] = useState<string | null>(null);
  const [assistantApproval, setAssistantApproval] = useState<PendingAssistantApproval | null>(null);
  const toolApprovalRef = useRef<{ resolve: (approved: boolean) => void } | null>(null);
  const [toolApproval, setToolApproval] = useState<PendingToolApproval | null>(null);
  const document = useModelStore((state) => state.document);
  const projectPath = useProjectStore((state) => state.path);
  const projectBundle = useProjectStore((state) => state.bundle);
  const workspaceOpen = useWorkspaceStore((state) => state.folders.length > 0);
  const workspaceName = useWorkspaceStore((state) => state.name);
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
  const workspaceScope = projectPath
    ? `workspace:${projectPath}`
    : workspaceName
      ? `workspace:${workspaceName}`
      : `window:${WINDOW_SESSION_ID}`;
  const histories = useAiConversationStore((state) => state.histories);
  const checkpoints = useAiConversationStore((state) => state.checkpoints);
  const sessions = useAiConversationStore((state) => state.sessions);
  const createSession = useAiConversationStore((state) => state.createSession);
  const archiveSession = useAiConversationStore((state) => state.archiveSession);
  const pinSession = useAiConversationStore((state) => state.pinSession);
  const renameSession = useAiConversationStore((state) => state.renameSession);
  const deleteSession = useAiConversationStore((state) => state.deleteSession);
  const updateSessionPermission = useAiConversationStore((state) => state.updateSessionPermission);
  const activeSession =
    activeSessionId === null
      ? undefined
      : sessions.find((session) => session.id === activeSessionId);
  const conversationScope =
    activeSessionId === null
      ? workspaceScope
      : aiSessionScope(
          activeSessionScopeRef.current ?? activeSession?.scope ?? workspaceScope,
          activeSessionId,
        );
  const conversation = histories[conversationScope] ?? [];
  const sessionItems = sessions
    .filter((session) => !session.archived)
    .slice()
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt),
    );
  const commandSuggestions = prompt.startsWith('/')
    ? ['/build', '/optimize', '/sweep', '/explain', '/clear'].filter((command) =>
        command.startsWith(prompt.trim().split(/\s+/)[0] ?? ''),
      )
    : [];
  const mentionSuggestions = /(?:^|\s)@[^\s]*$/.test(prompt)
    ? ['@model', '@selection', '@diagnostics', '@run']
    : [];
  const appendConversation = useAiConversationStore((state) => state.append);
  const saveCheckpoint = useAiConversationStore((state) => state.saveCheckpoint);
  const clearCheckpoint = useAiConversationStore((state) => state.clearCheckpoint);
  const clearConversation = useAiConversationStore((state) => state.clear);
  const moveConversation = useAiConversationStore((state) => state.move);
  const proposalStale = proposal !== null && proposal.baseDocument !== document;
  const sessionForScope = (scope: string) => {
    const existing = sessionCacheRef.current.get(scope);
    if (existing) return existing;
    const created = createAssistantSession();
    sessionCacheRef.current.set(scope, created);
    return created;
  };
  const settleAssistantApproval = (approved: boolean) => {
    const pending = approvalRef.current;
    if (pending === null) return;
    approvalRef.current = null;
    setAssistantApproval(null);
    pending.resolve(approved);
  };
  const settleToolApproval = (approved: boolean) => {
    const pending = toolApprovalRef.current;
    if (pending === null) return;
    toolApprovalRef.current = null;
    setToolApproval(null);
    pending.resolve(approved);
  };
  useEffect(
    () => () => {
      approvalRef.current?.resolve(false);
      approvalRef.current = null;
      toolApprovalRef.current?.resolve(false);
      toolApprovalRef.current = null;
      voiceRecognitionRef.current?.stop();
      voiceRecognitionRef.current = null;
    },
    [],
  );
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [assistantApproval, busy, conversation.length, error, liveSteps, toolApproval]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void getAiProviderState()
        .then((state) => {
          if (disposed) return;
          const provider = state.active.providerId || 'Auto';
          setProviderConfigured(state.active.configured);
          setModelLabel(
            state.active.configured ? state.active.model?.trim() || provider : 'Not configured',
          );
        })
        .catch(() => {
          if (!disposed) setModelLabel('Auto');
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  const loadToCanvas = async () => {
    if (proposal?.patch == null) return;
    if (!useWorkspaceStore.getState().isOpen()) {
      setError('当前没有打开工程，无法应用这个建模变更。请先 File > New Project 新建工程，或 File > Open 打开 .lpproj/.lp。');
      setProposal(null);
      return;
    }
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
    useProjectStore.getState().markDirty();
    const acceptedPatch = proposal.patch;
    const acceptedDescription = proposal.descriptions.join('; ');
    const nextScope = conversationScope;
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
            ? '验证与模拟已完成。'
            : '已应用的修改未成功运行。',
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
    // Read the store at action time. The AI panel remains mounted while the
    // user closes and creates projects, so the render-captured workspace flag
    // can otherwise reject a valid request from a newly opened workspace.
    if (!useWorkspaceStore.getState().isOpen()) {
      setError('当前没有打开工程，无法执行这个建模操作。请先 File > New Project 新建工程，或 File > Open 打开 .lpproj/.lp；外部 .sysml 文件可直接打开，无需工程。');
      return;
    }
    // Analysis tools also see metrics produced by assistant-driven runs.
    const completedMetrics = result?.metrics ?? sessionForScope(conversationScope).runMetrics;
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
        setOptimized(
          await aiOptimize(requestPrompt, generateDsl(useModelStore.getState().document)),
        );
      } else if (kind === 'explain') {
        if (completedMetrics == null) {
          setError('请先运行并应用模型,再来提问结果问题。');
        } else {
          setExplained(
            await aiQueryMetrics(
              requestPrompt,
              completedMetrics,
              useModelStore.getState().document,
            ),
          );
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
              '无法推断出安全的结构化修改。请说出目标块以及要执行的操作。',
            );
          } else {
            const nextProposal = createPatchProposal(current, proposed.patch);
            if (!nextProposal.ok || nextProposal.candidateDocument === null) {
              setError(nextProposal.error ?? '无效的模型修改方案');
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
            if (!nextProposal.ok) setError(nextProposal.error ?? '无效的模型修改方案');
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
        return '优化当前模型。';
      case 'variation':
        return '对当前模型运行参数扫描。';
      case 'explain':
        return '解释最近的模拟结果。';
      default:
        return '';
    }
  };

  const dispatchAction = (action: AiAction, candidatePrompt = prompt) => {
    const requestPrompt = candidatePrompt.trim() || defaultPromptFor(action);
    if (requestPrompt === '') {
      setError('请描述你想让 Copilot 做的模型修改。');
      return;
    }
    setPrompt('');
    void run(action, requestPrompt);
  };

  // One-shot quick-action artifacts belong to the conversation they were
  // produced in; switching sessions clears them so they cannot leak into
  // another thread.
  const clearArtifacts = () => {
    setResult(null);
    setProposal(null);
    setOptimized(null);
    setVariation(null);
    setExplained(null);
    setComparison(null);
    setProposalExperiment(null);
  };

  const enterSession = (session: AiSession) => {
    clearArtifacts();
    activeSessionRef.current = session.id;
    activeSessionScopeRef.current = session.scope;
    setActiveSessionId(session.id);
    setPermissionMode(session.permission);
  };

  const startSession = (title: string) => {
    clearArtifacts();
    const id = createSession(workspaceScope, title);
    activeSessionRef.current = id;
    activeSessionScopeRef.current = workspaceScope;
    setActiveSessionId(id);
    return id;
  };

  const leaveSession = () => {
    clearArtifacts();
    activeSessionRef.current = null;
    activeSessionScopeRef.current = null;
    setActiveSessionId(null);
    setPrompt('');
  };

  const openRenameSession = (session: AiSession) => {
    useUiStore.getState().openPrompt({
      title: '重命名会话',
      label: '会话名称',
      initial: session.title,
      submitLabel: '重命名',
      onSubmit: (value) => {
        const next = value.trim();
        if (next !== '' && next !== session.title) renameSession(session.id, next);
      },
    });
  };

  const confirmDeleteSession = (session: AiSession) => {
    useUiStore.getState().openConfirm({
      title: '删除会话',
      body: '此会话及其对话记录将被删除,无法找回。',
      actions: [
        { label: '删除', primary: true, onSelect: () => deleteSession(session.id) },
        { label: '取消', onSelect: () => {} },
      ],
    });
  };

  const refreshModelList = async () => {
    if (!providerConfigured) return;
    setModelsLoading(true);
    try {
      const result = await listAiProviderModels();
      setAvailableModels(result.models ?? []);
    } catch {
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const switchModel = async (name: string) => {
    try {
      const state = await getAiProviderState();
      await saveAiProvider({
        providerId: state.active.providerId,
        protocol: state.active.protocol,
        baseUrl: state.active.baseUrl,
        model: name,
      });
      setModelLabel(name);
    } catch (error) {
      setError(`切换模型失败:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const changePermissionMode = (mode: PermissionMode) => {
    setPermissionMode(mode);
    if (activeSessionRef.current !== null) updateSessionPermission(activeSessionRef.current, mode);
  };

  const currentAssistantScope = () =>
    activeSessionRef.current === null
      ? workspaceScope
      : aiSessionScope(activeSessionScopeRef.current ?? workspaceScope, activeSessionRef.current);
  const workspacePermissionAllowed =
    permissionMode !== 'Workspace' ||
    activeSessionScopeRef.current === null ||
    activeSessionScopeRef.current === workspaceScope;

  // Approval cards belong to the in-flight assistant turn, so they render
  // inside the streaming bubble (never for legacy quick-action runs).
  const approvalCards =
    assistantApproval !== null || toolApproval !== null ? (
      <>
        {assistantApproval !== null && (
          <section className="ai-approval-card" aria-label="检查模型修改">
            <header>
              <AlertTriangle size={14} />
              <strong>检查模型修改</strong>
            </header>
            <p>{assistantApproval.summary}</p>
            <div className="ai-approval-meta">
              <span>{assistantApproval.proposal.descriptions.length} 个操作</span>
              {assistantApproval.proposal.destructiveOperations > 0 && (
                <span className="destructive">
                  {assistantApproval.proposal.destructiveOperations} 个破坏性
                </span>
              )}
            </div>
            <ul>
              {assistantApproval.proposal.descriptions.map((description, index) => (
                <li key={`${index}:${description}`}>{description}</li>
              ))}
            </ul>
            <footer>
              <button className="secondary" onClick={() => settleAssistantApproval(false)}>
                <X size={13} /> 保留当前模型
              </button>
              <button className="primary" onClick={() => settleAssistantApproval(true)}>
                <Check size={13} /> 应用并继续
              </button>
            </footer>
          </section>
        )}
        {toolApproval !== null && (
          <section className="ai-approval-card" aria-label="批准工具调用">
            <header>
              <AlertTriangle size={14} />
              <strong>批准工具调用</strong>
            </header>
            <p>{toolApproval.summary}</p>
            <code>{toolApproval.toolName}</code>
            <pre>{JSON.stringify(toolApproval.arguments, null, 2)}</pre>
            <footer>
              <button className="secondary" onClick={() => settleToolApproval(false)}>
                <X size={13} /> 拒绝
              </button>
              <button className="primary" onClick={() => settleToolApproval(true)}>
                <Check size={13} /> 允许
              </button>
            </footer>
          </section>
        )}
      </>
    ) : null;

  // A missing provider/model does not swallow the user's message: the turn
  // is committed and the assistant side shows a genuine error state, so the
  // panel never pretends the assistant replied.
  const appendAssistantErrorTurn = (
    scope: string,
    userText: string,
    steps: AssistantStepRecord[] = [],
    error = NOT_CONFIGURED_MESSAGE,
  ) => {
    appendConversation(scope, {
      user: userText,
      assistant: '请求未完成。',
      patch: { version: 1, operations: [] },
      outcome: 'run_failed',
      assistantRecord: { steps, error },
    });
  };

  // Assistant Runtime: one continuous conversation turn with inline tool
  // execution.
  const sendAssistant = async (resume = false, explicitRequest?: string) => {
    const request = resume
      ? '继续未完成的 Agent 回合。'
      : (explicitRequest ?? prompt.trim());
    if ((!resume && request === '') || busy) {
      return;
    }
    let scope = conversationScope;
    if (!resume && activeSessionRef.current === null) {
      const id = startSession(request);
      scope = aiSessionScope(workspaceScope, id);
    }
    if (!providerConfigured) {
      setPrompt('');
      appendAssistantErrorTurn(scope, request);
      return;
    }
    const pendingCheckpoint = checkpoints[scope];
    const checkpointMessages = pendingCheckpoint
      ? createAssistantKernel([], pendingCheckpoint.snapshot.events).deriveCurrentTurnMessages()
      : [];
    const resumedMessage = checkpointMessages
      .slice()
      .reverse()
      .find((message: AssistantTurnMessage) => message.role === 'user')?.content;
    const resumedRequest = resume
      ? (resumedMessage ?? '继续未完成的 Agent 回合。')
      : request;
    if (resume && pendingCheckpoint === undefined) return;
    const session = sessionForScope(scope);
    const current = useModelStore.getState().document;
    if (session.documentSnapshot !== null && session.documentSnapshot !== current) {
      // A manual edit, project switch, or session switch invalidates every
      // derived runtime value. Never send an old DSL/diagnostics/metrics set
      // alongside a new document snapshot.
      session.dsl = generateDsl(current);
      session.diagnostics = [];
      session.compiled = false;
      session.runStatus = 'none';
      session.runMetrics = null;
      session.previousRunMetrics = null;
      session.runSummary = '';
    }
    session.documentSnapshot = current;
    if (session.dsl === '') {
      session.dsl = generateDsl(current);
    }
    setPrompt('');
    setError('');
    setBusy(true);
    setLiveSteps([]);
    setLiveResponse('');
    setStreamingRequest(request);
    const controller = new AbortController();
    abortRef.current = controller;
    const context = buildAssistantContext({
      projectName: workspaceOpen
        ? (workspaceName ?? projectPath ?? document.name)
        : '当前未打开工程。创建/修改/编译/运行 .lp 模型前请先新建或打开工程；外部 .sysml 文件可直接打开，无需工程。',
      document: current,
      workspaceRoot: projectPath ?? undefined,
      selectedId: useModelStore.getState().selectedId,
      session,
    });
    const turns = histories[scope] ?? [];
    const persistedEvents = turns.flatMap((turn) => turn.kernelEvents ?? []);
    const history: AssistantTurnMessage[] = resume
      ? []
      : persistedEvents.length > 0
        ? createAssistantKernel([], persistedEvents).deriveMessages(32)
        : turns
            .flatMap(
              (turn) =>
                turn.modelMessages ?? [
                  { role: 'user' as const, content: turn.user },
                  { role: 'assistant' as const, content: turn.assistant },
                ],
            )
            .slice(-32);
    const config = await getAppConfig();
    let additionalTools: AssistantTool[] = [];
    try {
      additionalTools = createMcpTools(await discoverMcpCapabilities(controller.signal));
      if (permissionMode === 'Read only' || !workspacePermissionAllowed) {
        additionalTools = additionalTools.filter((tool) => tool.requiresApproval !== true);
      }
    } catch {
      // MCP is optional; a stopped or unconfigured server must not disable the
      // built-in LogicPilot capability.
    }
    const confirmModelPatch = (request: AssistantPatchApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        const currentDocument = useModelStore.getState().document;
        const nextProposal = createPatchProposal(currentDocument, request.patch);
        if (!nextProposal.ok || nextProposal.candidateDocument === null) {
          setError(nextProposal.error ?? '建议的模型修改无效。');
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
    const confirmToolCall = (request: AssistantToolApprovalRequest) =>
      new Promise<boolean>((resolve) => {
        toolApprovalRef.current?.resolve(false);
        toolApprovalRef.current = { resolve };
        setToolApproval({
          toolName: request.toolName,
          summary: request.summary,
          arguments: request.arguments,
        });
      });
    const result = await runAssistantTurn({
      message: resumedRequest,
      context,
      session,
      history,
      apiBase: config?.apiBase ?? '',
      sessionToken: config?.sessionToken,
      // Dynamic discovery (plan §7): capabilities see the active document's
      // contribution type and mount only their relevant tools.
      toolScope: {
        documentType:
          documentContributionFor(useUiStore.getState().activeFile)?.id ?? null,
      },
      capabilities: [
        ...(workspaceOpen && workspacePermissionAllowed && toolsEnabled
          ? permissionMode === 'Read only'
            ? [LOGICPILOT_MODELING_READONLY_CAPABILITY.id]
            : LOGICPILOT_MODELING_PROFILE.capabilityIds
          : []),
        ...(workspaceOpen &&
        workspacePermissionAllowed &&
        sourceEditingEnabled &&
        permissionMode !== 'Read only'
          ? ['logicpilot-source-editing']
          : []),
        ...(additionalTools.length > 0 ? ['mcp'] : []),
      ],
      skills: [...(LOGICPILOT_MODELING_PROFILE.skillIds ?? []), '__workspace__'],
      additionalTools,
      checkpoint: resume ? pendingCheckpoint : undefined,
      onCheckpoint: (checkpoint) => saveCheckpoint(scope, checkpoint),
      signal: controller.signal,
      onProgress: setLiveSteps,
      onToken: (chunk) => {
        if (chunk.type === 'text') setLiveResponse((current) => current + chunk.delta);
      },
      confirmModelPatch,
      confirmToolCall,
    });
    abortRef.current = null;
    setBusy(false);
    setLiveSteps([]);
    if (!result.cancelled) clearCheckpoint(scope);
    if (result.cancelled) {
      // Keep the user's message in the conversation: the bubble becomes a
      // cancelled-error turn instead of silently disappearing.
      setStreamingRequest(null);
      setError('助手步骤已取消。');
      appendAssistantErrorTurn(scope, resumedRequest, result.steps, '助手步骤已取消。');
      return;
    }
    setStreamingRequest(null);
    if (!result.ok && isAssistantNotConfiguredError(result.error ?? '')) {
      // The assistant turned out unconfigured after the turn started: still
      // commit the turn with a real error instead of dropping the message.
      setProviderConfigured(false);
      appendAssistantErrorTurn(scope, resumedRequest, result.steps);
      return;
    }
    appendConversation(scope, {
      user: resumedRequest,
      assistant: result.declined
        ? '已放弃修改,模型画布未改变。'
        : result.message !== ''
          ? result.message
          : result.ok
            ? '完成。'
            : '请求未完成。',
      patch: session.lastPatch ?? { version: 1, operations: [] },
      outcome: result.declined
        ? 'declined'
        : result.ok
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
      modelMessages: result.modelMessages,
      kernelEvents: result.kernelEvents,
    });
  };

  const cancelAssistant = () => {
    abortRef.current?.abort();
    settleAssistantApproval(false);
    settleToolApproval(false);
  };

  // Undo the most recent AI-applied change (one atomic undo step).
  const undoLastChange = (tokenId: string) => {
    const session = sessionForScope(conversationScope);
    const undone = undoAssistantChange(session, tokenId);
    if (!undone.ok) {
      setError(undone.error ?? '该 AI 修改已无法安全撤销。');
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
              {step.detail != null && <small className="ai-step-detail">{step.detail}</small>}
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
          {completed > 0 ? `${completed} 个工具步骤` : '执行活动'}
          {failures > 0 ? ` · ${failures} 处问题` : ''}
          <ChevronDown size={11} />
        </summary>
        {renderSteps(steps)}
      </details>
    );
  };

  const permissionLabel = (mode: PermissionMode) =>
    mode === 'Full access' ? '完全访问' : mode === 'Workspace' ? '工作区' : '只读';

  const displayModelLabel = (label: string) =>
    label === 'Auto' ? '自动' : label === 'Not configured' ? '未配置' : label;

  const outcomeLabel = (outcome: 'applied' | 'completed' | 'run_failed' | 'declined') => {
    if (outcome === 'applied') return '模型已更新';
    if (outcome === 'completed') return '已完成';
    if (outcome === 'declined') return '已放弃修改';
    return '需要处理';
  };

  const submitPrompt = () => {
    const value = prompt.trim();
    const [command, ...rest] = value.split(/\s+/);
    const commandPrompt = rest.join(' ').trim();
    if (command === '/clear') {
      clearConversation(conversationScope);
      setError('');
      setPrompt('');
      return;
    }
    if (command === '/optimize') {
      dispatchAction('optimize', commandPrompt);
      return;
    }
    if (command === '/sweep') {
      dispatchAction('variation', commandPrompt);
      return;
    }
    if (command === '/explain') {
      dispatchAction('explain', commandPrompt);
      return;
    }
    if (command === '/build') {
      setPrompt('');
      void sendAssistant(false, commandPrompt || '构建所请求的模型。');
      return;
    }
    void sendAssistant();
  };

  const retryTurn = (turn: (typeof conversation)[number]) => {
    if (busy) return;
    setPrompt(turn.user);
    void sendAssistant(false, turn.user);
  };

  const copyAssistantMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      setError('此运行环境下无法复制。');
    }
  };

  const chooseComposerToken = (token: string) => {
    setPrompt((current) => {
      const base = current.replace(/(?:^|\s)[/@][^\s]*$/, '').trimEnd();
      return `${base}${base === '' ? '' : ' '}${token} `;
    });
  };

  const startVoiceInput = () => {
    if (voiceState === 'listening' || voiceState === 'transcribing') {
      voiceRecognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError('此桌面运行环境不支持语音输入。');
      setVoiceState('error');
      window.setTimeout(() => setVoiceState('idle'), 3000);
      return;
    }
    const recognition = new Recognition();
    voiceRecognitionRef.current = recognition;
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      setVoiceError('');
      setVoiceState('listening');
    };
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        // Non-final fragments stay inside the speech recognizer until a
        // final transcript is produced; they do not alter the composer UI.
      }
      if (finalText.trim() !== '') {
        setVoiceState('transcribing');
        window.setTimeout(() => {
          setPrompt(
            (current) => `${current}${current.trim() === '' ? '' : ' '}${finalText.trim()}`,
          );
          setVoiceState('idle');
        }, 280);
      }
    };
    recognition.onerror = (event) => {
      setVoiceError(
        event.error === 'not-allowed'
          ? '麦克风权限被拒绝。'
          : '语音识别失败。',
      );
      setVoiceState('error');
      voiceRecognitionRef.current = null;
      window.setTimeout(() => setVoiceState('idle'), 3000);
    };
    recognition.onend = () => {
      voiceRecognitionRef.current = null;
      setVoiceState((current) => (current === 'listening' ? 'idle' : current));
    };
    try {
      recognition.start();
    } catch {
      setVoiceError('语音识别无法启动。');
      setVoiceState('error');
      voiceRecognitionRef.current = null;
      window.setTimeout(() => setVoiceState('idle'), 3000);
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-thread" aria-label="AI modeling conversation">
        {activeSessionId !== null && (
          <div className="ai-session-header">
            <button
              type="button"
              aria-label="返回会话列表"
              title="返回会话列表"
              onClick={leaveSession}
            >
              <ArrowLeft size={16} />
            </button>
            <strong>
              {sessionItems.find((session) => session.id === activeSessionId)?.title ?? '会话'}
            </strong>
          </div>
        )}
        {activeSessionId === null && sessionItems.length > 0 && (
          <section className="ai-sessions" aria-label="Sessions">
            <div className="ai-sessions-title">
              会话
              <button
                type="button"
                className="ai-new-chat"
                onClick={() => {
                  leaveSession();
                  setPrompt('');
                }}
              >
                <Plus size={12} /> 新对话
              </button>
            </div>
            {sessionItems.map((session) => (
              <div className="ai-session-row" key={session.id}>
                <button
                  type="button"
                  className="ai-session-open"
                  onClick={() => enterSession(session)}
                >
                  <span className="ai-session-dot" aria-hidden />
                  <span className="ai-session-copy">
                    <strong>{session.title}</strong>
                    <small>{relativeSessionTime(session.updatedAt)}</small>
                  </span>
                </button>
                <span className="ai-session-actions">
                  <details className="ai-session-menu">
                    <summary aria-label="会话操作" title="会话操作">
                      <MoreHorizontal size={13} />
                    </summary>
                    <div className="ai-tools-popover ai-session-menu-pop">
                      <button type="button" onClick={() => openRenameSession(session)}>
                        重命名
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => confirmDeleteSession(session)}
                      >
                        删除
                      </button>
                    </div>
                  </details>
                  <button
                    type="button"
                    aria-label="归档会话"
                    title="归档"
                    onClick={() => archiveSession(session.id)}
                  >
                    <Archive size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={session.pinned ? '取消置顶会话' : '置顶会话'}
                    title={session.pinned ? '取消置顶' : '置顶'}
                    onClick={() => pinSession(session.id, !session.pinned)}
                  >
                    <Pin size={13} />
                  </button>
                </span>
              </div>
            ))}
          </section>
        )}
        {activeSessionId === null && conversation.length === 0 && result === null && !busy && (
          <div className="ai-welcome">
            <span className="ai-welcome-mark" aria-hidden>
              <Bot size={20} />
            </span>
            <h2>用描述构建模型</h2>
            <p>
              我可以创建和编辑仿真模型、运行实验,并解释有依据的结果,让你无需离开编辑器。
            </p>
            <div className="ai-suggestions" aria-label="Suggested prompts">
              {[
                '构建一个两坐席的呼叫中心',
                '在服务台前加入优先队列',
                '分析我上次运行的瓶颈',
              ].map((suggestion) => (
                <button key={suggestion} onClick={() => setPrompt(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeSessionId !== null &&
          conversation.slice(-6).map((turn, turnIndex) => (
            <div className="ai-turn" key={turn.id}>
              <div className="ai-message user">
                <span className="ai-message-avatar" aria-hidden>
                  <UserRound size={13} />
                </span>
                <div>
                  <strong>你</strong>
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
                  {turnIndex === conversation.slice(-6).length - 1 && (
                    <div className="ai-message-actions">
                      <button
                        type="button"
                        aria-label="重试最新回复"
                        title="重试"
                        disabled={busy}
                        onClick={() => retryTurn(turn)}
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="复制回复"
                        title="复制"
                        onClick={() => void copyAssistantMessage(turn.assistant)}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  )}
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
                            <summary title="查看本轮修改">
                              查看修改 <ChevronDown size={11} />
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
                            sessionForScope(conversationScope).activeUndo?.id !==
                              turn.assistantRecord.undoTokenId ||
                            sessionForScope(conversationScope).activeUndo?.after !== document
                          }
                          onClick={() => undoLastChange(turn.assistantRecord!.undoTokenId!)}
                          title="撤销 AI 上次应用的修改"
                        >
                          撤销
                        </button>
                      </span>
                    )}
                </div>
              </div>
            </div>
          ))}
        {!busy && checkpoints[conversationScope] !== undefined && (
          <div className="ai-checkpoint-card" role="status">
            <div>
              <strong>未完成的 Agent 回合</strong>
              <small>你可以继续上一个断点,或者丢弃它。</small>
            </div>
              <button className="secondary" onClick={() => void sendAssistant(true)}>
                继续
              </button>
              <button className="btn-ghost" onClick={() => clearCheckpoint(conversationScope)}>
                丢弃
              </button>
          </div>
        )}
        {busy && streamingRequest !== null && (
          <div className="ai-turn ai-turn-streaming" aria-live="polite">
            <div className="ai-message user">
              <span className="ai-message-avatar" aria-hidden>
                <UserRound size={13} />
              </span>
              <div>
                <strong>你</strong>
                <p>{streamingRequest}</p>
              </div>
            </div>
            <div className="ai-message assistant">
              <span className="ai-message-avatar" aria-hidden>
                <Sparkles size={13} />
              </span>
              <div>
                <strong>Copilot</strong>
                <div className="ai-working-header">
                  <span className="ai-step-spinner" aria-hidden />
                  <div>
                    <strong>
                      {assistantApproval === null ? '正在处理你的模型' : '需要批准'}
                    </strong>
                    <small>
                      {assistantApproval === null
                        ? '正在检查画布,按需编译并运行工具'
                        : '在你批准该修改前,模型画布保持原样'}
                    </small>
                  </div>
                </div>
                {liveSteps.length > 0 ? renderSteps(liveSteps) : <p>正在读取当前模型…</p>}
                {visibleLiveResponse(liveResponse) !== '' && (
                  <p className="ai-live-response">{visibleLiveResponse(liveResponse)}</p>
                )}
                {approvalCards}
              </div>
            </div>
          </div>
        )}
        {busy && streamingRequest === null && (
          <div className="ai-working-card" aria-live="polite">
            <div className="ai-working-header">
              <span className="ai-step-spinner" aria-hidden />
              <div>
                <strong>正在处理你的模型</strong>
                <small>正在检查画布,按需编译并运行工具</small>
              </div>
            </div>
            {liveSteps.length > 0 ? renderSteps(liveSteps) : <p>正在读取当前模型…</p>}
            {visibleLiveResponse(liveResponse) !== '' && (
              <p className="ai-live-response">{visibleLiveResponse(liveResponse)}</p>
            )}
          </div>
        )}
        {error !== '' && <p className="ai-error">{error}</p>}
        {variation !== null && (
          <div className="ai-result">
            <p className="ai-meta">
              {variation.name}: {variation.pointCount} 个参数组合;指标{' '}
              {variation.metric}
            </p>
            <table className="ai-scores" aria-label="参数扫描结果">
              <thead>
                <tr>
                  <th>参数</th>
                  <th>均值</th>
                  <th>置信区间</th>
                  <th>次数</th>
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
                    ? '已验证的结构化 ModelPatch 候选方案'
                    : result.iterations > 0
                      ? `编译了 ${result.iterations} 次迭代`
                      : '已验证并运行了应用到画布的模型'}
                </p>
                {result.experiment != null && (
                  <p className="ai-meta">
                    实验:seed={result.experiment.seed}, reps={result.experiment.reps},
                    arrivals=
                    {result.experiment.arrivals}, warmup={result.experiment.warmup},{' '}
                    {(result.experiment.confidence * 100).toFixed(0)}% 置信区间
                  </p>
                )}
                {proposal?.patch != null && (
                  <div className="ai-patch-preview">
                    <p className="ai-meta">
                      建议的 ModelPatch:{proposal.descriptions.length} 个操作
                      {proposal.destructiveOperations > 0
                        ? ` — 需检查 ${proposal.destructiveOperations} 个破坏性操作`
                        : ' — 无破坏性操作'}
                    </p>
                    {proposalStale && (
                      <p className="ai-error">
                        建议之后模型画布已改变。应用前请重新生成。
                      </p>
                    )}
                    {proposal.descriptions.length > 0 ? (
                      <ul className="ai-findings">
                        {proposal.descriptions.map((description, index) => (
                          <li key={`${index}:${description}`}>{description}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ai-meta">当前模型已符合该请求。</p>
                    )}
                    <button
                      className="ai-load"
                      disabled={busy || proposal.descriptions.length === 0 || proposalStale}
                      onClick={() => void loadToCanvas()}
                    >
                      应用模型修改
                    </button>
                  </div>
                )}
                <details className="ai-artifact">
                  <summary>
                    <Code2 size={13} /> 生成的 DSL <ChevronDown size={12} />
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
                      <TerminalSquare size={13} /> 运行日志 <ChevronDown size={12} />
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
                        <th>块</th>
                        <th>出队</th>
                        <th>平均大小</th>
                        <th>阶段等待</th>
                        <th>利用率</th>
                        <th>超时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.metrics.blocks.map((block) => (
                        <tr key={`${block.kind}:${block.name}`}>
                          <td>{block.name}</td>
                          <td>{block.departed_mean.toFixed(0)}</td>
                          <td>{block.mean_occupancy.toFixed(3)}</td>
                          <td>{block.mean_wait.toFixed(3)}</td>
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
              最优 {optimized.variable}={optimized.best.value} ({optimized.objective}{' '}
              {optimized.metric} → {optimized.best.score},{optimized.strategy},{' '}
              {optimized.evaluations.length} 次评估
              {optimized.selection?.status === 'confidence-overlap' ? ',置信区间重叠' : ''})
            </p>
            <OptimizeChart evaluations={optimized.evaluations} objective={optimized.objective} />
            <table className="ai-scores">
              <thead>
                <tr>
                  <th>{optimized.variable}</th>
                  <th>{optimized.metric}</th>
                  <th>95% 置信区间</th>
                </tr>
              </thead>
              <tbody>
                {optimized.evaluations.map((entry) => (
                  <tr key={entry.value}>
                    <td>{entry.value}</td>
                    <td>{entry.score.toFixed(4)}</td>
                    <td>
                      {entry.ciLow != null && entry.ciHigh != null
                        ? `[${entry.ciLow.toFixed(4)}, ${entry.ciHigh.toFixed(4)}]`
                        : '—'}
                      {entry.uncertain ? ' · 重叠' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {optimized.selection?.caveat != null && (
              <p className="ai-meta">{optimized.selection.caveat}</p>
            )}
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
                ? `,最忙=${explained.evidence.busiestBlock}`
                : ''}
              {explained.evidence.largestQueue !== null
                ? `,最大队列=${explained.evidence.largestQueue}`
                : ''}
            </p>
            {explained.evidence.blockFindings != null &&
              explained.evidence.blockFindings.length > 0 && (
                <table className="ai-scores" aria-label="分块证据">
                  <thead>
                    <tr>
                      <th>块</th>
                      <th>利用率</th>
                      <th>可用性</th>
                      <th>平均大小</th>
                      <th>阶段等待</th>
                      <th>超时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {explained.evidence.blockFindings.map((block) => (
                      <tr key={`${block.kind}:${block.name}`}>
                        <td>{block.name}</td>
                        <td>{(block.utilization * 100).toFixed(1)}%</td>
                        <td>{(block.availability * 100).toFixed(1)}%</td>
                        <td>{block.meanOccupancy.toFixed(3)}</td>
                        <td>{block.meanWait.toFixed(3)}</td>
                        <td>{block.timedOut.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            {explained.evidence.causalChain != null &&
              explained.evidence.causalChain.length > 1 && (
                <p className="ai-meta">因果路径:{explained.evidence.causalChain.join(' → ')}</p>
              )}
            {explained.evidence.causalEvidence != null && (
              <>
                {explained.evidence.causalEvidence.relationships.length > 0 && (
                  <ul className="ai-findings" aria-label="观察到的因果关系">
                    {explained.evidence.causalEvidence.relationships.map((relationship) => (
                      <li key={`${relationship.from}:${relationship.to}`}>
                        {relationship.from} → {relationship.to}: {relationship.signals.join('; ')}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="ai-meta">
                  {explained.evidence.causalEvidence.status === 'topology-supported'
                    ? '因果证据:拓扑 + 实测指标'
                    : '因果证据:实测覆盖不足'}
                  {' — '}
                  {explained.evidence.causalEvidence.caveat}
                </p>
              </>
            )}
          </div>
        )}
        {comparison !== null && (
          <div className="ai-result">
            <p className="ai-meta">使用相同运行设置的前后对比</p>
            <p className="ai-meta">
              配对证据:{comparison.statisticalEvidence.matchedReplicationPairs} 对重复
            </p>
            <ul className="ai-findings">
              {comparison.findings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
            <table className="ai-scores" aria-label="DES 前后对比">
              <thead>
                <tr>
                  <th>块</th>
                  <th>状态</th>
                  <th>Δ 出队</th>
                  <th>Δ 大小</th>
                  <th>Δ 阶段等待</th>
                  <th>Δ 利用率</th>
                </tr>
              </thead>
              <tbody>
                {comparison.blocks.map((block) => (
                  <tr key={block.key}>
                    <td>{block.name}</td>
                    <td>{block.status}</td>
                    <td>{block.metrics.departed_mean.delta.toFixed(1)}</td>
                    <td>{block.metrics.mean_occupancy.delta.toFixed(3)}</td>
                    <td>{block.metrics.mean_wait.delta.toFixed(3)}</td>
                    <td>{(block.metrics.utilization.delta * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comparison.statistical.length > 0 && (
              <table className="ai-scores" aria-label="配对统计对比">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>均值差</th>
                    <th>置信区间</th>
                    <th>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.statistical.map((entry) => (
                    <tr key={entry.metric}>
                      <td>{entry.metric}</td>
                      <td>{entry.meanDifference.toFixed(4)}</td>
                      <td>{'[' + entry.ciLow.toFixed(4) + ', ' + entry.ciHigh.toFixed(4) + ']'}</td>
                      <td>{entry.conclusion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="ai-meta">{comparison.statisticalEvidence.caveat}</p>
          </div>
        )}
        <div ref={threadEndRef} className="ai-thread-end" aria-hidden />
      </div>
      <div className="ai-composer-area">
        <div className="ai-composer-shell">
          {(commandSuggestions.length > 0 || mentionSuggestions.length > 0) && (
            <div
              className="ai-composer-suggestions"
              role="listbox"
              aria-label="输入建议"
            >
              {(commandSuggestions.length > 0 ? commandSuggestions : mentionSuggestions).map(
                (item) => (
                  <button key={item} type="button" onClick={() => chooseComposerToken(item)}>
                    <code>{item}</code>
                    <span>
                      {item === '/build'
                        ? '构建或编辑当前模型'
                        : item === '/optimize'
                          ? '搜索更优参数值'
                          : item === '/sweep'
                            ? '运行参数扫描'
                            : item === '/explain'
                              ? '解释最近一次运行'
                              : item === '/clear'
                                ? '清空当前对话'
                                : '附加当前工作区上下文'}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
          <textarea
            className="ai-input"
            value={prompt}
            disabled={busy}
            rows={3}
            placeholder={
              document.nodes.length > 0
                ? '让 Copilot 修改、运行或解释这个模型…'
                : '描述你想要模拟的系统…'
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
            <details className="ai-composer-add">
              <summary aria-label="添加上下文或命令" title="添加上下文或命令">
                <Plus size={16} />
              </summary>
              <div className="ai-tools-popover ai-add-popover">
                <button type="button" onClick={() => chooseComposerToken('@model')}>
                  <span>
                    <strong>@model</strong>
                    <small>附加当前模型</small>
                  </span>
                </button>
                <button type="button" onClick={() => chooseComposerToken('@selection')}>
                  <span>
                    <strong>@selection</strong>
                    <small>附加选中的块</small>
                  </span>
                </button>
                <button type="button" onClick={() => chooseComposerToken('/explain')}>
                  <span>
                    <strong>/explain</strong>
                    <small>解释最近一次运行</small>
                  </span>
                </button>
              </div>
            </details>
            <details className="ai-composer-select ai-model-select">
              <summary title="切换模型" onClick={() => void refreshModelList()}>
                <span>{displayModelLabel(modelLabel)}</span>
                <ChevronDown size={11} />
              </summary>
              <div className="ai-tools-popover ai-select-popover">
                <button type="button" onClick={() => setModelLabel('Auto')}>
                  <strong>自动</strong>
                  <small>使用已配置的 provider</small>
                </button>
                {providerConfigured &&
                  availableModels.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={modelLabel === name ? 'selected' : ''}
                      onClick={() => void switchModel(name)}
                    >
                      <strong>{name}</strong>
                      <small>当前选择</small>
                    </button>
                  ))}
                {providerConfigured && modelsLoading && (
                  <p className="ai-tools-note">正在获取模型列表…</p>
                )}
                {providerConfigured && !modelsLoading && availableModels.length === 0 && (
                  <p className="ai-tools-note">无法获取模型列表,请打开设置检查 provider 配置。</p>
                )}
                <button type="button" onClick={() => useUiStore.getState().openSettings()}>
                  <strong>设置</strong>
                  <small>打开 Settings → AI &amp; Models 切换 provider 或模型</small>
                </button>
              </div>
            </details>
            {conversation.length > 0 && (
              <button
                className="ai-icon-button"
                aria-label="清空对话"
                title="清空对话"
                disabled={busy}
                onClick={() => {
                  clearConversation(conversationScope);
                  setError('');
                }}
              >
                <Eraser size={14} />
              </button>
            )}
            {document.nodes.length > 0 && (
              <span className="ai-context-pill">{document.nodes.length} 个块</span>
            )}
            <button
              className={`ai-voice-button ${voiceState}`}
              aria-label={
                voiceState === 'listening'
                  ? '停止聆听'
                  : voiceState === 'transcribing'
                    ? '正在转写语音'
                    : '语音输入'
              }
              title={
                voiceState === 'listening'
                  ? '聆听中…点击停止'
                  : voiceState === 'transcribing'
                    ? '转写中…'
                    : voiceState === 'error'
                      ? voiceError
                      : '语音输入'
              }
              disabled={busy && voiceState === 'idle'}
              onClick={startVoiceInput}
            >
              <Mic size={14} />
            </button>
            {busy ? (
              <button
                className="ai-send"
                aria-label="停止助手"
                title="停止"
                onClick={cancelAssistant}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="ai-send"
                aria-label="发送给 Copilot"
                title="发送 (Enter)"
                disabled={prompt.trim() === ''}
                onClick={submitPrompt}
              >
                <SendHorizontal size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="ai-composer-status">
          <button type="button" className="ai-status-button" title="本地运行">
            <span className="ai-status-dot" /> 本地 <ChevronDown size={10} />
          </button>
          <details className="ai-status-permission">
            <summary title="权限模式">
              <ShieldCheck size={12} /> {permissionLabel(permissionMode)} <ChevronDown size={10} />
            </summary>
            <div className="ai-tools-popover ai-select-popover">
              {(['Full access', 'Workspace', 'Read only'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={permissionMode === mode ? 'selected' : ''}
                  onClick={() => changePermissionMode(mode)}
                >
                  <strong>{permissionLabel(mode)}</strong>
                  <small>
                    {mode === 'Full access'
                      ? '允许宿主操作'
                      : mode === 'Workspace'
                        ? '仅限当前工作区的修改'
                        : '仅检查与回答'}
                  </small>
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// AI endpoints client: /api/ai-build, /api/ai-optimize, /api/ai-explain.
// Types mirror the server responses (scripts/ai-build.mjs, ai-optimize.mjs,
// ai-explain.mjs).

import { getAppConfig } from '../state/appConfig';
import type { AiConversationTurn } from './conversationStore';
import type { ModelDocument, ModelPatch } from '@logicpilot/editor';
import type { RunOptions } from '../state/runStore';

export type ExperimentSettings = Pick<
  RunOptions,
  | 'seed'
  | 'seedMode'
  | 'reps'
  | 'replicationMode'
  | 'minReps'
  | 'maxReps'
  | 'errorPercent'
  | 'precisionMetric'
  | 'arrivals'
  | 'warmup'
  | 'confidence'
>;

export interface AiDiagnostic {
  code: string;
  message: string;
}

export interface DesBlockSummary {
  name: string;
  kind: string;
  capacity: number;
  arrived_mean: number;
  departed_mean: number;
  timed_out_mean: number;
  preempted_mean: number;
  mean_occupancy: number;
  mean_wait: number;
  wait_count_mean: number;
  utilization: number;
  availability: number;
}

export interface AiMetrics {
  summary?: Record<string, { mean: number; stddev: number; ci_low: number; ci_high: number }>;
  blocks: DesBlockSummary[];
  replications?: Array<{
    rep: number;
    seed: string;
    throughput: number;
    L: number;
    Lq: number;
    W: number;
    Wq: number;
    utilization: number;
    availability: number;
    final_value: number;
  }>;
}

export interface VariationAxis {
  name: string;
  variable: string;
  min: number;
  max: number;
  step: number;
}

export interface ParameterVariationResult {
  ok: boolean;
  kind: 'parameter_variation';
  name: string;
  metric: string;
  axes: VariationAxis[];
  pointCount: number;
  iterations: Array<{
    index: number;
    parameters: Record<string, number>;
    run: { seed: number; actualReps: number; confidence: number };
    metrics: AiMetrics;
  }>;
}

export interface AiResult {
  ok: boolean;
  iterations: number;
  dsl: string;
  diagnostics: AiDiagnostic[];
  runSummary: string;
  metrics?: AiMetrics;
  trajectory?: {
    variables: string[];
    points: Array<{ t: number; values: number[] }>;
  };
  mode?: 'generated' | 'validated' | 'applied';
  experiment?: ExperimentSettings;
}

export interface AiPatchResult {
  ok: boolean;
  supported: boolean;
  provider: 'rule-based' | 'llm';
  patch: ModelPatch;
}

export interface OptimizeResult {
  kind: 'optimize';
  variable: string;
  objective: string;
  metric: string;
  strategy: string;
  best: { value: number; score: number };
  evaluations: Array<{
    value: number;
    score: number;
    mean?: number;
    ciLow?: number | null;
    ciHigh?: number | null;
    samples?: number | null;
    confidenceOverlapBest?: boolean;
    uncertain?: boolean;
  }>;
  selection?: {
    status: 'confidence-overlap' | 'interval-separated' | 'point-estimate';
    confidence: number | null;
    caveat: string;
  };
  dslTemplate: string;
}

export interface ExplainResult {
  kind: 'explain';
  question: string;
  metrics: {
    throughput: number;
    W: number;
    Wq: number;
    Lq: number;
    utilization: number;
    availability: number;
  };
  findings: string[];
  evidence?: {
    metricEvidence: Record<string, unknown>;
    caveat: string;
  };
}

export interface MetricQueryResult {
  kind: 'metric-query';
  question: string;
  findings: string[];
  evidence: {
    busiestBlock: string | null;
    busiestUtilization: number | null;
    largestQueue: string | null;
    largestMeanOccupancy: number | null;
    blockCount: number;
    blockFindings?: Array<{
      name: string;
      kind: string;
      utilization: number;
      availability: number;
      meanOccupancy: number;
      timedOut: number;
      preempted: number;
    }>;
    causalChain?: string[];
    causalEvidence?: {
      status: 'topology-supported' | 'insufficient-evidence';
      observations: Array<{
        name: string;
        kind: string;
        measured: boolean;
        utilization: number | null;
        availability: number | null;
        meanOccupancy: number | null;
        timedOut: number | null;
        preempted: number | null;
      }>;
      caveat: string;
    };
  };
}

interface MetricDelta {
  before: number;
  after: number;
  delta: number;
}

export interface MetricComparisonResult {
  kind: 'metric-comparison';
  findings: string[];
  summary: {
    sinkDeparturesBefore: number;
    sinkDeparturesAfter: number;
    sinkDeparturesDelta: number;
    timeoutsBefore: number;
    timeoutsAfter: number;
    timeoutsDelta: number;
    matchedReplicationPairs: number;
  };
  blocks: Array<{
    key: string;
    name: string;
    kind: string;
    status: 'matched' | 'added' | 'removed';
    metrics: {
      departed_mean: MetricDelta;
      mean_occupancy: MetricDelta;
      mean_wait: MetricDelta;
      utilization: MetricDelta;
      timed_out_mean: MetricDelta;
      preempted_mean: MetricDelta;
    };
  }>;
  statistical: Array<{
    metric: string;
    samples: number;
    confidence: number;
    meanDifference: number;
    ciLow: number;
    ciHigh: number;
    conclusion: 'increase' | 'decrease' | 'inconclusive';
  }>;
  statisticalEvidence: {
    matchedReplicationPairs: number;
    minimumPairs: number;
    status: 'available' | 'partial' | 'insufficient-data';
    caveat: string;
  };
}

async function post<T>(
  endpoint: string,
  prompt: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, run: true, ...extra }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = (data as { error?: string })?.error;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return data as T;
}

export function aiBuild(
  prompt: string,
  contextDsl = '',
  experiment?: ExperimentSettings,
): Promise<AiResult> {
  return post<AiResult>('/api/ai-build', prompt, { contextDsl, experiment }).then((result) => ({
    ...result,
    mode: 'generated',
  }));
}

export function aiProposePatch(
  prompt: string,
  model: ModelDocument,
  history: AiConversationTurn[] = [],
): Promise<AiPatchResult> {
  return post('/api/ai-patch', prompt, { model, history: history.slice(-20), run: false });
}

export async function aiValidateDsl(
  dsl: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; diagnostics: AiDiagnostic[] }> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/ai-validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl }),
    signal,
  });
  const data = (await response.json()) as {
    ok: boolean;
    diagnostics: AiDiagnostic[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export async function aiRunDsl(
  dsl: string,
  experiment?: ExperimentSettings,
  signal?: AbortSignal,
): Promise<AiResult> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/ai-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl, ...experiment }),
    signal,
  });
  const data = (await response.json()) as Omit<AiResult, 'iterations' | 'dsl'> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return { ...data, iterations: 0, dsl, mode: 'applied' };
}

export async function runParameterVariation(
  dsl: string,
  options: { experimentName?: string; arrivals: number; warmup: number; concurrency?: number },
): Promise<ParameterVariationResult> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/parameter-variation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl, ...options }),
  });
  const data = (await response.json()) as ParameterVariationResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function aiOptimize(prompt: string, contextDsl = ''): Promise<OptimizeResult> {
  return post('/api/ai-optimize', prompt, { contextDsl });
}

export function aiExplain(prompt: string): Promise<ExplainResult> {
  return post('/api/ai-explain', prompt);
}

export async function aiQueryMetrics(
  question: string,
  metrics: NonNullable<AiResult['metrics']>,
  model?: ModelDocument,
): Promise<MetricQueryResult> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/ai-query-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, metrics, model }),
  });
  const data = (await response.json()) as MetricQueryResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export async function aiCompareMetrics(
  before: AiMetrics,
  after: AiMetrics,
  confidence = 0.95,
): Promise<MetricComparisonResult> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}/api/ai-compare-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ before, after, confidence }),
  });
  const data = (await response.json()) as MetricComparisonResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

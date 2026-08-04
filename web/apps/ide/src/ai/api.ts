// AI endpoints client: /api/ai-build, /api/ai-optimize, /api/ai-explain.
// Types mirror the server responses (scripts/ai-build.mjs, ai-optimize.mjs,
// ai-explain.mjs).

import { getAppConfig } from '../state/appConfig';

export interface AiDiagnostic {
  code: string;
  message: string;
}

export interface AiResult {
  ok: boolean;
  iterations: number;
  dsl: string;
  diagnostics: AiDiagnostic[];
  runSummary: string;
  trajectory?: {
    variables: string[];
    points: Array<{ t: number; values: number[] }>;
  };
}

export interface OptimizeResult {
  kind: 'optimize';
  variable: string;
  objective: string;
  metric: string;
  strategy: string;
  best: { value: number; score: number };
  evaluations: Array<{ value: number; score: number }>;
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
}

async function post<T>(endpoint: string, prompt: string): Promise<T> {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, run: true }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = (data as { error?: string })?.error;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return data as T;
}

export function aiBuild(prompt: string): Promise<AiResult> {
  return post('/api/ai-build', prompt);
}

export function aiOptimize(prompt: string): Promise<OptimizeResult> {
  return post('/api/ai-optimize', prompt);
}

export function aiExplain(prompt: string): Promise<ExplainResult> {
  return post('/api/ai-explain', prompt);
}

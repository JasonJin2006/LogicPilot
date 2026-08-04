// AI model panel: describe a model in natural language and either generate
// DSL (+ run it) via /api/ai-build, or optimize a parameter (e.g. "minimize
// Wq over servers 1..4") via /api/ai-optimize.

import { useState } from 'react';

interface AiDiagnostic {
  code: string;
  message: string;
}

interface AiResult {
  ok: boolean;
  iterations: number;
  dsl: string;
  diagnostics: AiDiagnostic[];
  runSummary: string;
}

interface OptimizeResult {
  kind: 'optimize';
  variable: string;
  objective: string;
  metric: string;
  strategy: string;
  best: { value: number; score: number };
  evaluations: Array<{ value: number; score: number }>;
  dslTemplate: string;
}

const EXAMPLE_PROMPT =
    'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0';

export function AIPanel() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState('');

  const post = async (endpoint: string) => {
    setBusy(true);
    setError('');
    setResult(null);
    setOptimized(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, run: true }),
      });
      const data = (await response.json()) as AiResult & OptimizeResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      if (endpoint === '/api/ai-optimize') {
        setOptimized(data as OptimizeResult);
      } else {
        setResult(data as AiResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-panel">
      <h2>AI model</h2>
      <textarea
        className="ai-input"
        value={prompt}
        disabled={busy}
        rows={2}
        placeholder="describe a model in natural language..."
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="panel-row">
        <button
          disabled={busy || prompt.trim() === ''}
          onClick={() => void post('/api/ai-build')}
        >
          {busy ? 'generating…' : 'generate + run'}
        </button>
        <button
          disabled={busy || prompt.trim() === ''}
          onClick={() => void post('/api/ai-optimize')}
        >
          optimize
        </button>
      </div>
      {error !== '' && <p className="ai-error">{error}</p>}
      {result !== null && (
        <div className="ai-result">
          {result.ok ? (
            <>
              <p className="ai-meta">
                compiled in {result.iterations} iteration(s)
              </p>
              <pre className="ai-dsl">{result.dsl}</pre>
              {result.runSummary !== '' && (
                <pre className="ai-run">{result.runSummary}</pre>
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
            best {optimized.variable}={optimized.best.value} (
            {optimized.objective} {optimized.metric} → {optimized.best.score},
            {optimized.strategy}, {optimized.evaluations.length} evaluations)
          </p>
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
    </div>
  );
}

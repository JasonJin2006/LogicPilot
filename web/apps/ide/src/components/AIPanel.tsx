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
  trajectory?: {
    variables: string[];
    points: Array<{ t: number; values: number[] }>;
  };
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

interface ExplainResult {
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

const EXAMPLE_PROMPT =
    'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0';

const TRAJECTORY_COLORS = ['#58a6ff', '#3fb950', '#ffb020', '#f85149'];

function TrajectoryChart({
  trajectory,
}: {
  trajectory: NonNullable<AiResult['trajectory']>;
}) {
  const { variables, points } = trajectory;
  const width = 260;
  const height = 120;
  const pad = 6;
  let tMax = 0;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const point of points) {
    tMax = Math.max(tMax, point.t);
    for (const value of point.values) {
      vMin = Math.min(vMin, value);
      vMax = Math.max(vMax, value);
    }
  }
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  }
  const x = (t: number) => pad + (t / (tMax || 1)) * (width - 2 * pad);
  const y = (v: number) =>
      pad + (1 - (v - vMin) / (vMax - vMin)) * (height - 2 * pad);
  return (
    <svg
      className="ai-trajectory"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {variables.map((name, index) => {
        const line = points
          .map(
              (point) =>
                  `${x(point.t).toFixed(1)},${y(point.values[index] ?? 0).toFixed(1)}`,
          )
          .join(' ');
        return (
          <polyline
            key={name}
            points={line}
            fill="none"
            stroke={TRAJECTORY_COLORS[index % TRAJECTORY_COLORS.length]}
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

// Optimization curve: variable value on the x axis, metric score on the y
// axis, with the best evaluated point highlighted (min or max per objective).
function OptimizeChart({
  evaluations,
  objective,
}: {
  evaluations: Array<{ value: number; score: number }>;
  objective: string;
}) {
  if (evaluations.length < 2) {
    return null;
  }
  const width = 260;
  const height = 120;
  const pad = 6;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let bestIndex = 0;
  let bestScore = evaluations[0]!.score;
  for (let i = 0; i < evaluations.length; ++i) {
    const { value, score } = evaluations[i]!;
    xMin = Math.min(xMin, value);
    xMax = Math.max(xMax, value);
    yMin = Math.min(yMin, score);
    yMax = Math.max(yMax, score);
    const better =
        objective === 'maximize' ? score > bestScore : score < bestScore;
    if (better) {
      bestIndex = i;
      bestScore = score;
    }
  }
  if (xMin === xMax) {
    xMax = xMin + 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const x = (v: number) =>
      pad + ((v - xMin) / (xMax - xMin)) * (width - 2 * pad);
  const y = (s: number) =>
      pad + (1 - (s - yMin) / (yMax - yMin)) * (height - 2 * pad);
  const points = evaluations
      .map(
          (entry) =>
              `${x(entry.value).toFixed(1)},${y(entry.score).toFixed(1)}`,
      )
      .join(' ');
  const best = evaluations[bestIndex]!;
  return (
    <svg
      className="ai-trajectory ai-opt-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={TRAJECTORY_COLORS[0]}
        strokeWidth="1.5"
      />
      <circle
        cx={x(best.value).toFixed(1)}
        cy={y(best.score).toFixed(1)}
        r="3"
        fill={TRAJECTORY_COLORS[1]}
      />
    </svg>
  );
}

export function AIPanel() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [explained, setExplained] = useState<ExplainResult | null>(null);
  const [error, setError] = useState('');

  const post = async (endpoint: string) => {
    setBusy(true);
    setError('');
    setResult(null);
    setOptimized(null);
    setExplained(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, run: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const error = (data as { error?: string })?.error;
        throw new Error(error ?? `HTTP ${response.status}`);
      }
      if (endpoint === '/api/ai-optimize') {
        setOptimized(data as OptimizeResult);
      } else if (endpoint === '/api/ai-explain') {
        setExplained(data as ExplainResult);
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
        <button
          disabled={busy || prompt.trim() === ''}
          onClick={() => void post('/api/ai-explain')}
        >
          explain
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
              {result.trajectory != null &&
                result.trajectory.points.length > 0 && (
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
            best {optimized.variable}={optimized.best.value} (
            {optimized.objective} {optimized.metric} → {optimized.best.score},
            {optimized.strategy}, {optimized.evaluations.length} evaluations)
          </p>
          <OptimizeChart
            evaluations={optimized.evaluations}
            objective={optimized.objective}
          />
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
            throughput={explained.metrics.throughput.toFixed(3)} Wq=
            {explained.metrics.Wq.toFixed(2)} utilization=
            {(explained.metrics.utilization * 100).toFixed(1)}% availability=
            {(explained.metrics.availability * 100).toFixed(1)}%
          </p>
        </div>
      )}
    </div>
  );
}

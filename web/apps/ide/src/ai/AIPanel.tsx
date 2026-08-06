// AI model panel: describe a model in natural language and either generate
// DSL (+ run it) via /api/ai-build, or optimize a parameter (e.g. "minimize
// Wq over servers 1..4") via /api/ai-optimize. API calls live in api.ts,
// charts in charts.tsx.

import { useRef, useState } from 'react';
import { parseDsl } from '@logicpilot/editor';
import { aiBuild, aiExplain, aiOptimize } from './api';
import type { AiResult, ExplainResult, OptimizeResult } from './api';
import { OptimizeChart, TrajectoryChart } from './charts';
import { loadModelDocument } from '../state/projectSync';
import { ScrollArea } from '../components/ScrollArea';

const EXAMPLE_PROMPT = 'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0';

export function AIPanel() {
  const dslRef = useRef<HTMLPreElement>(null);
  const runRef = useRef<HTMLPreElement>(null);
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [explained, setExplained] = useState<ExplainResult | null>(null);
  const [error, setError] = useState('');
  const loadToCanvas = () => {
    if (result === null) return;
    const parsed = parseDsl(result.dsl);
    if (!parsed.ok) {
      setError(`load to canvas: ${parsed.error ?? 'invalid DSL'}`);
      return;
    }
    setError('');
    // A freshly loaded model shows its root canvas (containers + resources),
    // not whatever container the user was drilling into.
    loadModelDocument(parsed.document);
  };

  const run = async (kind: 'build' | 'optimize' | 'explain') => {
    setBusy(true);
    setError('');
    setResult(null);
    setOptimized(null);
    setExplained(null);
    try {
      if (kind === 'optimize') {
        setOptimized(await aiOptimize(prompt));
      } else if (kind === 'explain') {
        setExplained(await aiExplain(prompt));
      } else {
        setResult(await aiBuild(prompt));
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
        <button disabled={busy || prompt.trim() === ''} onClick={() => void run('build')}>
          {busy ? 'generating…' : 'generate + run'}
        </button>
        <button disabled={busy || prompt.trim() === ''} onClick={() => void run('optimize')}>
          optimize
        </button>
        <button disabled={busy || prompt.trim() === ''} onClick={() => void run('explain')}>
          explain
        </button>
      </div>
      {error !== '' && <p className="ai-error">{error}</p>}
      {result !== null && (
        <div className="ai-result">
          {result.ok ? (
            <>
              <p className="ai-meta">compiled in {result.iterations} iteration(s)</p>
              <button className="ai-load" onClick={loadToCanvas}>
                Load to canvas
              </button>
              <ScrollArea className="ai-dsl-scroll" scrollRef={dslRef}>
                <pre ref={dslRef} className="ai-dsl scroll-hidden">
                  {result.dsl}
                </pre>
              </ScrollArea>
              {result.runSummary !== '' && (
                <ScrollArea className="ai-run-scroll" scrollRef={runRef}>
                  <pre ref={runRef} className="ai-run scroll-hidden">
                    {result.runSummary}
                  </pre>
                </ScrollArea>
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

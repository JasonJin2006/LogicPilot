// AI model panel: describe a model in natural language, generate DSL via the
// dev-server AI build endpoint (/api/ai-build), and show the compiler
// diagnostics or the run summary.

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

const EXAMPLE_PROMPT =
    'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0';

export function AIPanel() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/ai-build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, run: true }),
      });
      const data = (await response.json()) as AiResult & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setResult(data);
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
        <button disabled={busy || prompt.trim() === ''} onClick={generate}>
          {busy ? 'generating…' : 'generate + run'}
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
    </div>
  );
}

// Terminal run summary: RunFinished stats table (cross-replication means,
// std-devs and Student-t confidence intervals).

import { useRunStore } from '../state/runStore';

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Math.abs(value) >= 1000 || (value !== 0 && Math.abs(value) < 0.001)
    ? value.toExponential(3)
    : value.toFixed(3);
}

export function ResultsPanel() {
  const runInfo = useRunStore((state) => state.runInfo);
  const results = useRunStore((state) => state.results);
  if (!runInfo && !results) {
    return <div className="results empty">Run results will appear here.</div>;
  }
  return (
    <div className="results">
      {runInfo && (
        <div className="run-info">
          run <code>{runInfo.runId}</code> · model <code>{runInfo.modelName}</code> · seed{' '}
          <code>{runInfo.seed.toString()}</code>
        </div>
      )}
      {results && (
        <>
          <div className={`run-status status-${results.statusName.toLowerCase()}`}>
            {results.statusName}
            {results.error ? ` — ${results.error}` : ''}
          </div>
          <table>
            <tbody>
              {Object.entries(results.stats).map(([name, value]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{formatValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

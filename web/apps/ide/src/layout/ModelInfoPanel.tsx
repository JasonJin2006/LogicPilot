// Side panel (Project view): the canvas model summary + active run, plus the
// "New model" action (the document auto-persists to localStorage).

import { useModelStore } from '../state/modelStore';
import { useRunStore } from '../state/runStore';

export function ModelInfoPanel() {
  const document = useModelStore((state) => state.document);
  const reset = useModelStore((state) => state.reset);
  const runInfo = useRunStore((state) => state.runInfo);
  return (
    <div className="side-panel-body">
      <div className="side-kv">
        <span className="k">model</span>
        <span className="v">{document.name}</span>
      </div>
      <div className="side-kv">
        <span className="k">blocks</span>
        <span className="v">{document.nodes.length}</span>
      </div>
      <div className="side-kv">
        <span className="k">couplings</span>
        <span className="v">{document.edges.length}</span>
      </div>
      {runInfo && (
        <>
          <div className="side-kv">
            <span className="k">run</span>
            <span className="v">{runInfo.runId}</span>
          </div>
          <div className="side-kv">
            <span className="k">seed</span>
            <span className="v">{runInfo.seed.toString()}</span>
          </div>
        </>
      )}
      <button className="side-action" onClick={reset}>
        New model
      </button>
    </div>
  );
}

// Side panel (Model view): the currently loaded model + active run, read
// from the run store. Placeholder content until the model tree lands.

import { useRunStore } from '../state/runStore';

export function ModelInfoPanel() {
  const runInfo = useRunStore((state) => state.runInfo);
  return (
    <div className="side-panel-body">
      {runInfo ? (
        <>
          <div className="side-kv">
            <span className="k">model</span>
            <span className="v">{runInfo.modelName}</span>
          </div>
          <div className="side-kv">
            <span className="k">run</span>
            <span className="v">{runInfo.runId}</span>
          </div>
          <div className="side-kv">
            <span className="k">seed</span>
            <span className="v">{runInfo.seed.toString()}</span>
          </div>
        </>
      ) : (
        <p className="side-hint">
          Model tree arrives with drag-and-drop modeling (P1-6). Run a model to see its identity
          here.
        </p>
      )}
    </div>
  );
}

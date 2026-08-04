// Side panel (Run view): live connection + telemetry digest.

import { useConnectionStore } from '../state/connectionStore';

export function RunInfoPanel() {
  const conn = useConnectionStore((state) => state.conn);
  const seq = useConnectionStore((state) => state.seq);
  const simTimeNs = useConnectionStore((state) => state.simTimeNs);
  const fps = useConnectionStore((state) => state.fps);
  const badFrames = useConnectionStore((state) => state.badFrames);
  const seconds = simTimeNs === null ? null : Number(simTimeNs) / 1e9;
  return (
    <div className="side-panel-body">
      <div className="side-kv">
        <span className="k">connection</span>
        <span className="v">{conn}</span>
      </div>
      <div className="side-kv">
        <span className="k">seq</span>
        <span className="v">{seq === null ? '—' : seq.toString()}</span>
      </div>
      <div className="side-kv">
        <span className="k">sim_time</span>
        <span className="v">{seconds === null ? '—' : `${seconds.toFixed(2)} s`}</span>
      </div>
      <div className="side-kv">
        <span className="k">render</span>
        <span className="v">{fps} FPS</span>
      </div>
      {badFrames > 0 && (
        <div className="side-kv">
          <span className="k">bad frames</span>
          <span className="v warn">{badFrames}</span>
        </div>
      )}
    </div>
  );
}

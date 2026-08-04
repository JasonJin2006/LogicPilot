// Status strip: connection state, last frame seq, simulated time, render
// FPS, latest gateway ack and decode errors.

import { useConnectionStore } from '../state/connectionStore';

export function StatusBar() {
  const conn = useConnectionStore((state) => state.conn);
  const seq = useConnectionStore((state) => state.seq);
  const simTimeNs = useConnectionStore((state) => state.simTimeNs);
  const fps = useConnectionStore((state) => state.fps);
  const lastAck = useConnectionStore((state) => state.lastAck);
  const error = useConnectionStore((state) => state.error);
  const badFrames = useConnectionStore((state) => state.badFrames);
  const simSeconds = simTimeNs === null ? null : Number(simTimeNs) / 1e9;
  return (
    <div className="status-bar">
      <span className={`conn-badge conn-${conn}`}>{conn}</span>
      <span>seq: {seq === null ? '—' : seq.toString()}</span>
      <span>sim_time: {simSeconds === null ? '—' : `${simSeconds.toFixed(2)} s`}</span>
      <span>render: {fps} FPS</span>
      {badFrames > 0 && <span className="warn">bad frames: {badFrames}</span>}
      {error && <span className="error">{error}</span>}
      {lastAck && <span className="ack">ack: {lastAck}</span>}
    </div>
  );
}

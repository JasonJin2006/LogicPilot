// Status strip: connection state, render FPS, decode errors and the latest
// gateway ack. Frame-level telemetry (seq / sim_time) lives in the Run side
// panel instead of the pinned bar.

import { useConnectionStore } from '../state/connectionStore';

export function StatusBar() {
  const conn = useConnectionStore((state) => state.conn);
  const fps = useConnectionStore((state) => state.fps);
  const lastAck = useConnectionStore((state) => state.lastAck);
  const error = useConnectionStore((state) => state.error);
  const badFrames = useConnectionStore((state) => state.badFrames);
  return (
    <div className="status-bar">
      <span className={`conn-badge conn-${conn}`}>{conn}</span>
      <span>render: {fps} FPS</span>
      {badFrames > 0 && <span className="warn">bad frames: {badFrames}</span>}
      {error && <span className="error">{error}</span>}
      {lastAck && <span className="ack">ack: {lastAck}</span>}
    </div>
  );
}

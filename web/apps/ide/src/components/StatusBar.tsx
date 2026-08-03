// Status strip: connection state, last frame seq, simulated time, render
// FPS, latest gateway ack and decode errors.

import type { ConnState } from '../client/simClient';

interface StatusBarProps {
  conn: ConnState;
  seq: bigint | null;
  simTimeNs: bigint | null;
  fps: number;
  lastAck: string;
  error: string;
  badFrames: number;
}

export function StatusBar({
  conn,
  seq,
  simTimeNs,
  fps,
  lastAck,
  error,
  badFrames,
}: StatusBarProps) {
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

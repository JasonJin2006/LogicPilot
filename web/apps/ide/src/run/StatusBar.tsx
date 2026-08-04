// Status strip: a compact bar with a connection status dot, render FPS,
// decode errors, and a notification bell (system notifications; the gateway
// event log lives in the Console panel). Frame-level telemetry (seq /
// sim_time) is not pinned here either.

import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../state/connectionStore';

export function StatusBar() {
  const conn = useConnectionStore((state) => state.conn);
  const fps = useConnectionStore((state) => state.fps);
  const error = useConnectionStore((state) => state.error);
  const badFrames = useConnectionStore((state) => state.badFrames);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  return (
    <div className="status-bar">
      <span className={`conn-dot conn-${conn}`} title={conn} />
      <span className="fps">{fps} FPS</span>
      {badFrames > 0 && <span className="warn">bad: {badFrames}</span>}
      {error && <span className="error">{error}</span>}
      <div className="status-spacer" />
      <div className="notifications">
        <button
          className="bell-btn"
          aria-label="Notifications"
          title="Notifications"
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          <Bell size={14} />
        </button>
        {notificationsOpen && (
          <div className="notif-popover">
            <p className="notif-empty">No system notifications</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Status strip: a compact bar with a connection status dot, render FPS,
// decode errors / latest ack, and a notification bell (recent gateway
// events). Frame-level telemetry (seq / sim_time) lives in the Run side
// panel instead of the pinned bar.

import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../state/connectionStore';

export function StatusBar() {
  const conn = useConnectionStore((state) => state.conn);
  const fps = useConnectionStore((state) => state.fps);
  const lastAck = useConnectionStore((state) => state.lastAck);
  const error = useConnectionStore((state) => state.error);
  const badFrames = useConnectionStore((state) => state.badFrames);
  const events = useConnectionStore((state) => state.events);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  return (
    <div className="status-bar">
      <span className={`conn-dot conn-${conn}`} title={conn} />
      <span className="fps">{fps} FPS</span>
      {badFrames > 0 && <span className="warn">bad: {badFrames}</span>}
      {error && <span className="error">{error}</span>}
      {lastAck && <span className="ack">ack: {lastAck}</span>}
      <div className="status-spacer" />
      <div className="notifications">
        <button
          className="bell-btn"
          aria-label="Notifications"
          title="Notifications"
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          <Bell size={14} />
          {events.length > 0 && <span className="bell-dot" />}
        </button>
        {notificationsOpen && (
          <div className="notif-popover">
            {events.length === 0 ? (
              <p className="notif-empty">No notifications</p>
            ) : (
              [...events]
                .reverse()
                .slice(0, 12)
                .map((event) => (
                  <div key={event.id} className={`notif-line notif-${event.kind}`}>
                    <span className="notif-time">{event.time}</span>
                    <span className="notif-text">{event.text}</span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

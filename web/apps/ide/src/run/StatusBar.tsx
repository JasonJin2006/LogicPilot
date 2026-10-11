// Status strip: a compact bar with a connection status dot, decode errors,
// and a notification bell (system notifications; the gateway
// event log lives in the Console panel). Frame-level telemetry (seq /
// sim_time) is not pinned here either.

import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useLegacyGatewayStore } from '../state/legacyGateway';
import { useExecutionStore } from '../state/executionStore';
import { useProjectStore } from '../state/projectStore';

export function StatusBar() {
  const conn = useLegacyGatewayStore((state) => state.conn);
  const error = useLegacyGatewayStore((state) => state.error);
  const badFrames = useLegacyGatewayStore((state) => state.badFrames);
  const nativeSession = useExecutionStore((state) => state.session);
  const externalChanges = useProjectStore((state) => state.externalChanges);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const effectiveConnection = nativeSession?.status ?? conn;
  return (
    <div className="status-bar">
      <span className={`conn-dot conn-${effectiveConnection}`} title={effectiveConnection} />
      {badFrames > 0 && <span className="warn">bad: {badFrames}</span>}
      {externalChanges.length > 0 && (
        <span className="warn" title="Files changed on disk; Save will ask before overwriting">
          changed: {externalChanges.length}
        </span>
      )}
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
            {externalChanges.length === 0 ? (
              <p className="notif-empty">No system notifications</p>
            ) : (
              <div className="notif-list">
                <strong>Files changed on disk</strong>
                <p>{externalChanges.slice(0, 5).join(', ')}</p>
                {externalChanges.length > 5 && <p>and {externalChanges.length - 5} more…</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

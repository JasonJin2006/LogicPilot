// Generic modal for Help > Welcome / About / Check for updates.

import { X } from 'lucide-react';
import { useUiStore } from '../state/uiStore';

export function InfoDialog() {
  const info = useUiStore((state) => state.info);
  const closeInfo = useUiStore((state) => state.closeInfo);
  if (!info) {
    return null;
  }
  return (
    <div className="dialog-backdrop" onClick={closeInfo}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label={info.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{info.title}</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeInfo}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-hint info-body">{info.body}</p>
        <div className="dialog-actions">
          <button className="btn-primary" onClick={closeInfo}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

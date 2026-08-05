// Multi-action confirm dialog: renders a title, body and an arbitrary list
// of action buttons (e.g. Close project: Save / Don't Save / Cancel).

import { X } from 'lucide-react';
import { useUiStore } from '../state/uiStore';

export function ConfirmDialog() {
  const confirm = useUiStore((state) => state.confirm);
  const closeConfirm = useUiStore((state) => state.closeConfirm);
  if (!confirm) {
    return null;
  }
  return (
    <div className="dialog-backdrop" onClick={closeConfirm}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label={confirm.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{confirm.title}</h2>
          <button className="btn-ghost" aria-label="Close" onClick={closeConfirm}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-hint info-body">{confirm.body}</p>
        <div className="dialog-actions">
          {confirm.actions.map((action) => (
            <button
              key={action.label}
              className={action.primary ? 'btn-primary' : undefined}
              onClick={() => {
                closeConfirm();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

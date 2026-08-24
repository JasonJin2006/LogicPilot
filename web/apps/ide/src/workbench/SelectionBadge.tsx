// Selection badge shell (canvas-platform S5): the bottom-right floating
// summary for whatever a canvas has selected - kind, identity, a hint line
// and at most one primary action. Every canvas renders the same chip; only
// the content varies.

import type { ReactNode } from 'react';

export interface SelectionBadgeProps {
  /** Kind/category line (muted). */
  title: string;
  /** Identity line (emphasized), e.g. qualified name. */
  detail: string;
  /** Optional small hint line, e.g. source position. */
  hint?: ReactNode;
  action?: {
    label: string;
    onSelect: () => void;
  };
}

export function SelectionBadge({ title, detail, hint, action }: SelectionBadgeProps) {
  return (
    <div className="selection-badge">
      <span>{title}</span>
      <strong>{detail}</strong>
      {hint !== undefined && <small>{hint}</small>}
      {action !== undefined && (
        <button type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      )}
    </div>
  );
}

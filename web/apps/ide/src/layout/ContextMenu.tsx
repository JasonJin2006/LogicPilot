// Small fixed-position context menu shared by trees and the modeling canvas.
// Closes on outside mousedown, Escape or after selecting an action.

import { useEffect, useRef, type ReactNode } from 'react';

export interface ContextAction {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export function ContextMenu({
  x,
  y,
  actions,
  onClose,
  label = 'Context menu',
}: {
  x: number;
  y: number;
  actions: ContextAction[];
  onClose: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      // Only close on outside mousedowns; clicking a menu item itself must
      // reach its onClick (the mousedown listener would otherwise unmount
      // the menu before the click event fires).
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      role="menu"
      aria-label={label}
      ref={ref}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <div key={action.label} className={action.separatorBefore ? 'context-group' : undefined}>
          <button
            className={`context-item${action.danger ? ' danger' : ''}`}
            role="menuitem"
            disabled={action.disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
              action.onSelect();
            }}
          >
            <span className="context-item-icon" aria-hidden="true">
              {action.icon}
            </span>
            <span className="context-item-label">{action.label}</span>
            {action.shortcut && <kbd className="context-shortcut">{action.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}

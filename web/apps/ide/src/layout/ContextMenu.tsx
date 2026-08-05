// Small fixed-position context menu used by the Explorer and Project trees.
// Closes on outside mousedown, Escape or after selecting an action.

import { useEffect, useRef } from 'react';

export interface ContextAction {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: ContextAction[];
  onClose: () => void;
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
    <div className="context-menu" role="menu" ref={ref} style={{ left: x, top: y }}>
      {actions.map((action) => (
        <button
          key={action.label}
          className={`context-item${action.danger ? ' danger' : ''}`}
          role="menuitem"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
            action.onSelect();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

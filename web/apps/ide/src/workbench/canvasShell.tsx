// Shared canvas interaction SHELL (canvas-platform S5 "one shell, many
// contents"): keyboard shortcuts, a context menu and the overlay toolbar are
// workbench-owned components; every paradigm canvas supplies its own actions,
// so behavior stays identical while content varies. Canvases must NOT grow
// private copies of these mechanisms.

import { useEffect } from 'react';
import type { ComponentType } from 'react';

export interface ShortcutHandlers {
  enabled?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  /** Escape / explicit cancel (drag, connect gesture, selection). */
  onCancel?: () => void;
  /** Canvas-specific keys (pen tools, arrow nudges, grouping...). Return
   *  true when the event was consumed - it never reaches the shared set. */
  onCustomKey?: (event: KeyboardEvent) => boolean;
}

function eventIsEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Standard canvas shortcut set: Ctrl+Z/Y undo-redo, Delete, Ctrl+C/V,
 *  Escape. Bound on window so shortcuts work while the canvas has focus
 *  without stealing them from text fields. */
export function useCanvasShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    if (handlers.enabled === false) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (eventIsEditableTarget(event.target)) return;
      if (handlers.onCustomKey?.(event)) return;
      const control = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (control && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) handlers.onRedo?.();
        else handlers.onUndo?.();
      } else if (control && key === 'y') {
        event.preventDefault();
        handlers.onRedo?.();
      } else if ((key === 'delete' || key === 'backspace') && !control) {
        if (handlers.onDelete) {
          event.preventDefault();
          handlers.onDelete();
        }
      } else if (control && key === 'c') {
        handlers.onCopy?.();
      } else if (control && key === 'v') {
        handlers.onPaste?.();
      } else if (event.key === 'Escape') {
        handlers.onCancel?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface CanvasContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Fixed-position action list for right-click menus. Rendering, dismissal
 *  (any click / Escape / blur) and positioning live here; canvases only
 *  describe items. */
export function CanvasContextMenu({
  menu,
  onClose,
}: {
  menu: CanvasContextMenuState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (menu === null) return;
    const dismiss = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu !== null, onClose]);
  if (menu === null) return null;
  return (
    <div className="canvas-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`canvas-context-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Overlay toolbar slot (top-left of any canvas viewport). Items are plain
 *  descriptors so each canvas keeps its own verbs while position, spacing,
 *  hover styling and stacking stay identical everywhere. */
export interface CanvasToolbarItem {
  key: string;
  title: string;
  icon?: ComponentType<{ size?: number }>;
  label?: string;
  onSelect: () => void;
  disabled?: boolean;
}

export function CanvasToolbar({ items }: { items: readonly CanvasToolbarItem[] }) {
  return (
    <div className="canvas-overlay-bar">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            title={item.title}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {Icon !== undefined && <Icon size={13} />}
            {item.label !== undefined && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

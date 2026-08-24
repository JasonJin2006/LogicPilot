import { useEffect } from 'react';

/** Invoke `onClose` when Escape is pressed while `active`. Dialog-level
 *  dismissal with the same semantics as a backdrop click; listens on the
 *  capture phase so nested dropdown handlers cannot swallow the key. */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onClose]);
}

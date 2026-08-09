// Custom scroll area: keeps native scrolling (wheel / touch / keyboard /
// middle-drag) but hides the OS scrollbar and draws a themed thumb with the
// app's custom cursor series (pointer on hover, grabbing while dragging).
// The thumb auto-hides: it fades out after a short idle period without
// pointer activity or scrolling, and reappears on the next interaction.
// Two modes:
//   - default: a viewport wrapper scrolls its children;
//   - scrollRef: an external element (e.g. a native textarea) keeps its own
//     native scrolling (hidden via .scroll-hidden) and the thumb tracks it.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';

// Idle delay before the thumb fades out (matches overlay-scrollbar feel).
const IDLE_HIDE_MS = 500;

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  axis?: 'y' | 'x';
  /** External scrolling element: the wrapper does not scroll; the thumb
   *  tracks and drives this element (which should carry .scroll-hidden). */
  scrollRef?: RefObject<HTMLElement | null>;
}

export function ScrollArea({ children, className, style, axis = 'y', scrollRef }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ size: 0, offset: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: number; start: number; offset: number } | null>(null);
  const vertical = axis !== 'x';

  // Wake the thumb (show it now) and re-arm the fade timer. Uses only refs
  // and stable setState, so the closure stays valid across renders.
  const wake = () => {
    setIdle(false);
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => setIdle(true), IDLE_HIDE_MS);
  };

  // The thumb starts visible; if nothing interacts with it, it fades after
  // the first idle period. Clear the timer on unmount.
  useEffect(() => {
    wake();
    return () => {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  const measure = () => {
    const el = scrollRef?.current ?? viewportRef.current;
    if (!el) return;
    const client = vertical ? el.clientHeight : el.clientWidth;
    const total = vertical ? el.scrollHeight : el.scrollWidth;
    const scroll = vertical ? el.scrollTop : el.scrollLeft;
    if (total <= client + 1) {
      setThumb((current) => (current.visible ? { size: 0, offset: 0, visible: false } : current));
      return;
    }
    const size = Math.max(22, Math.round((client / total) * client));
    const maxOffset = client - size;
    const offset = Math.round(maxOffset > 0 ? (scroll / (total - client)) * maxOffset : 0);
    setThumb({ size, offset, visible: true });
  };

  useEffect(() => {
    const el = scrollRef?.current ?? viewportRef.current;
    if (!el) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    // Scrolling (wheel, keyboard, touch, programmatic) also counts as
    // activity, so a thumb the user is driving never fades out from under
    // the cursor.
    const onActivity = () => {
      schedule();
      wake();
    };
    el.addEventListener('scroll', onActivity, { passive: true });
    el.addEventListener('input', onActivity, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    }
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onActivity);
      el.removeEventListener('input', onActivity);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
    // scrollRef is a stable ref object; axis toggles which metrics to read.
  }, [scrollRef, vertical]);

  const scrollElement = () => scrollRef?.current ?? viewportRef.current;

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = scrollElement();
    if (!el) return;
    const client = vertical ? el.clientHeight : el.clientWidth;
    const total = vertical ? el.scrollHeight : el.scrollWidth;
    const scroll = vertical ? el.scrollTop : el.scrollLeft;
    const size = Math.max(22, (client / total) * client);
    const maxOffset = client - size;
    dragRef.current = {
      id: event.pointerId,
      start: vertical ? event.clientY : event.clientX,
      offset: maxOffset > 0 ? (scroll / (total - client)) * maxOffset : 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = scrollElement();
    if (!drag || !el || drag.id !== event.pointerId) return;
    const client = vertical ? el.clientHeight : el.clientWidth;
    const total = vertical ? el.scrollHeight : el.scrollWidth;
    const position = vertical ? event.clientY : event.clientX;
    const size = Math.max(22, (client / total) * client);
    const maxOffset = client - size;
    const next =
      maxOffset > 0 ? ((drag.offset + position - drag.start) / maxOffset) * (total - client) : 0;
    const clamped = Math.max(0, Math.min(total - client, next));
    if (vertical) {
      el.scrollTop = clamped;
    } else {
      el.scrollLeft = clamped;
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className={`scroll-area${className ? ` ${className}` : ''}`}
      style={style}
      data-axis={axis}
      onPointerEnter={wake}
      onPointerMove={wake}
    >
      {scrollRef ? (
        children
      ) : (
        <div className="scroll-area-viewport" ref={viewportRef}>
          {children}
        </div>
      )}
      {thumb.visible && (
        <div
          className={`scroll-area-thumb${idle ? ' idle' : ''}${dragging ? ' dragging' : ''}`}
          style={
            vertical
              ? { top: thumb.offset, height: thumb.size }
              : { left: thumb.offset, width: thumb.size }
          }
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  );
}

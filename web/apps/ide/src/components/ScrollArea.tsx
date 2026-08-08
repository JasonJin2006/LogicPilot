// Custom scroll area: keeps native scrolling (wheel / touch / keyboard /
// middle-drag) but hides the OS scrollbar and draws a themed thumb with the
// app's custom cursor series (pointer on hover, grabbing while dragging).
// Two modes:
//   - default: a viewport wrapper scrolls its children;
//   - scrollRef: an external element (e.g. a native textarea) keeps its own
//     native scrolling (hidden via .scroll-hidden) and the thumb tracks it.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';

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
  const dragRef = useRef<{ id: number; start: number; offset: number } | null>(null);
  const vertical = axis !== 'x';

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
    el.addEventListener('scroll', schedule, { passive: true });
    el.addEventListener('input', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    }
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('input', schedule);
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
          className={`scroll-area-thumb${dragging ? ' dragging' : ''}`}
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

// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CLOSE_OFFSET, REOPEN_THRESHOLD, SIZE_RANGE, useLayoutStore } from '../state/layoutStore';
import { PANELS, type AreaId } from './panels';

function Splitter({
  area,
  vertical,
  gridArea,
  invert = false,
}: {
  area: AreaId;
  vertical: boolean;
  gridArea: string;
  invert?: boolean;
}) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = vertical ? event.clientX : event.clientY;
    const startSize = useLayoutStore.getState().areas[area].size;
    let closed = false;
    const move = (moveEvent: PointerEvent) => {
      const delta = vertical ? moveEvent.clientX - start : moveEvent.clientY - start;
      const layout = useLayoutStore.getState();
      if (layout.areas[area].collapsed) {
        // Dragging outward from the closed edge re-opens the panel; the
        // target is measured from zero (the panel sits at width 0).
        const target = invert ? -delta : delta;
        if (target >= REOPEN_THRESHOLD) {
          layout.reopenArea(area, target);
          closed = true; // this gesture opened it; resize is a new drag
        }
        return;
      }
      // Splitters must follow the cursor. For a fixed-size area whose
      // boundary sits between it and a flex area (right, bottom), moving
      // the boundary toward the flex area shrinks the fixed area, so the
      // delta is inverted.
      if (closed) {
        return;
      }
      const target = startSize + (invert ? -delta : delta);
      layout.setSizeOrClose(area, target);
      if (target < SIZE_RANGE[area].min - CLOSE_OFFSET) {
        closed = true; // panel closed; ignore the rest of this drag
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`splitter ${vertical ? 'splitter-v' : 'splitter-h'}`}
      style={{ gridArea }}
      onPointerDown={handlePointerDown}
      onDoubleClick={() => useLayoutStore.getState().toggleCollapse(area)}
      title={vertical ? 'drag to resize · double-click to collapse' : undefined}
    />
  );
}

function TabBar({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  const setActive = useLayoutStore((s) => s.setActive);
  return (
    <div className="tab-bar">
      {state.panels.map((panel) => (
        <button
          key={panel}
          className={`tab${panel === state.activePanel ? ' active' : ''}`}
          onClick={() => setActive(area, panel)}
        >
          {PANELS[panel].title}
        </button>
      ))}
    </div>
  );
}

function PanelArea({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  return (
    <section className={`panel-area area-${area}${state.collapsed ? ' collapsed' : ''}`}>
      {area !== 'left' && <TabBar area={area} />}
      {!state.collapsed && (
        <div className="panel-area-body">
          {state.panels.map((panel) => {
            const definition = PANELS[panel];
            if (definition === undefined) {
              return null; // stale persisted panel: skipped defensively
            }
            const PanelComponent = definition.component;
            return (
              <div
                key={panel}
                className={`panel-pane${panel === state.activePanel ? ' active' : ''}`}
              >
                <PanelComponent />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Workspace() {
  const areas = useLayoutStore((s) => s.areas);
  const style = {
    '--left-w': `${areas.left.collapsed ? 0 : areas.left.size}px`,
    '--right-w': `${areas.right.collapsed ? 0 : areas.right.size}px`,
    '--bottom-h': `${areas.bottom.collapsed ? 0 : areas.bottom.size}px`,
  } as CSSProperties;
  return (
    <div className="workspace" style={style}>
      <PanelArea area="left" />
      <Splitter area="left" vertical gridArea="sl" />
      <PanelArea area="center" />
      <Splitter area="right" vertical gridArea="sr" invert />
      <PanelArea area="right" />
      <Splitter area="bottom" vertical={false} gridArea="sb" invert />
      <PanelArea area="bottom" />
    </div>
  );
}

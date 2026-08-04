// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { useLayoutStore } from '../state/layoutStore';
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
    const move = (moveEvent: PointerEvent) => {
      const delta = vertical ? moveEvent.clientX - start : moveEvent.clientY - start;
      // Splitters must follow the cursor. For a fixed-size area whose
      // boundary sits between it and a flex area (right, bottom), moving
      // the boundary toward the flex area shrinks the fixed area, so the
      // delta is inverted.
      useLayoutStore.getState().setSize(area, startSize + (invert ? -delta : delta));
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
  const toggleCollapse = useLayoutStore((s) => s.toggleCollapse);
  const CollapseIcon =
    area === 'bottom'
      ? state.collapsed
        ? ChevronUp
        : ChevronDown
      : state.collapsed
        ? ChevronRight
        : ChevronLeft;
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
      <button
        className="tab-collapse"
        title={state.collapsed ? 'expand' : 'collapse'}
        onClick={() => toggleCollapse(area)}
      >
        <CollapseIcon size={13} />
      </button>
    </div>
  );
}

function PanelArea({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  return (
    <section className={`panel-area area-${area}${state.collapsed ? ' collapsed' : ''}`}>
      <TabBar area={area} />
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
    '--left-w': `${areas.left.size}px`,
    '--right-w': `${areas.right.size}px`,
    '--bottom-h': `${areas.bottom.size}px`,
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

// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useLayoutStore } from '../state/layoutStore';
import { PANELS, type AreaId } from './panels';

function Splitter({
  area,
  vertical,
  gridArea,
}: {
  area: AreaId;
  vertical: boolean;
  gridArea: string;
}) {
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = vertical ? event.clientX : event.clientY;
    const startSize = useLayoutStore.getState().areas[area].size;
    const move = (moveEvent: PointerEvent) => {
      const delta = vertical ? moveEvent.clientX - start : moveEvent.clientY - start;
      useLayoutStore.getState().setSize(area, startSize + delta);
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
  const collapseGlyph =
    area === 'bottom' ? (state.collapsed ? '▲' : '▼') : state.collapsed ? '»' : '«';
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
        {collapseGlyph}
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
            const PanelComponent = PANELS[panel].component;
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
      <Splitter area="right" vertical gridArea="sr" />
      <PanelArea area="right" />
      <Splitter area="bottom" vertical={false} gridArea="sb" />
      <PanelArea area="bottom" />
    </div>
  );
}

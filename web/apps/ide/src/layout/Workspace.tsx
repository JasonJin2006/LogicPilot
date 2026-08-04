// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import { useEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Redo2, Undo2, X } from 'lucide-react';
import { SIZE_RANGE, useLayoutStore } from '../state/layoutStore';
import { useModelStore } from '../state/modelStore';
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
    // The panel's fixed outer edge: the workspace container's own borders
    // (the splitter sits between the panel and the flex area, so deriving
    // the edge from the splitter position would include its half-width).
    const workspace = (event.currentTarget as HTMLElement).closest<HTMLElement>('.workspace');
    const bounds = workspace?.getBoundingClientRect();
    const edge =
      area === 'left'
        ? (bounds?.left ?? start)
        : area === 'right'
          ? (bounds?.right ?? start)
          : (bounds?.bottom ?? start);
    const sizeVar = (
      area === 'left' ? '--left-w' : area === 'right' ? '--right-w' : '--bottom-h'
    ) as '--left-w' | '--right-w' | '--bottom-h';
    const move = (moveEvent: PointerEvent) => {
      // Width = pointer distance from the fixed outer edge. This follows the
      // cursor exactly in every state, so re-opening lands the panel edge on
      // the pointer and a closed-then-pulled-back gesture stays continuous.
      const pointer = vertical ? moveEvent.clientX : moveEvent.clientY;
      const width = area === 'left' ? pointer - edge : edge - pointer;
      const layout = useLayoutStore.getState();
      const range = SIZE_RANGE[area];
      if (width >= range.min) {
        // Reached the critical width: open (or keep sizing) with the panel
        // edge exactly under the pointer.
        layout.reopenArea(area, width);
      } else if (!layout.areas[area].collapsed) {
        layout.setSizeOrClose(area, width);
      }
      // Write the divider straight to the CSS variable so the boundary
      // tracks the pointer even before React re-renders.
      const visible = layout.areas[area].collapsed
        ? 0
        : Math.min(range.max, Math.max(range.min, width));
      workspace?.style.setProperty(sizeVar, `${visible}px`);
      // While collapsed and width < min the panel stays closed; the pointer
      // distance is preserved so pulling back out re-opens it seamlessly.
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
      className={`splitter ${vertical ? 'splitter-v' : 'splitter-h'} splitter-${area}`}
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
  const canUndo = useModelStore((s) => s.canUndo);
  const canRedo = useModelStore((s) => s.canRedo);
  const undo = useModelStore((s) => s.undo);
  const redo = useModelStore((s) => s.redo);
  // Right/bottom panels can be collapsed; the model workspace stays open.
  const closable = area !== 'center';
  const perTabClose = area === 'center';
  return (
    <div className="tab-bar">
      {state.panels.map((panel) => (
        <div
          key={panel}
          className={`tab${panel === state.activePanel ? ' active' : ''}`}
          onClick={() => setActive(area, panel)}
        >
          <span className="tab-label">{PANELS[panel].title}</span>
          {perTabClose && (
            <button
              className="tab-x"
              aria-label={`Close ${panel} tab`}
              title="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                useLayoutStore.getState().removePanel(area, panel);
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {closable && state.panels.length > 0 && (
        <button
          className="tab-close"
          aria-label={`Close ${area} panel`}
          title="Close panel"
          onClick={() => toggleCollapse(area)}
        >
          <X size={13} />
        </button>
      )}
      {area === 'center' && (
        <div className="tab-actions">
          <button
            className="tab-action"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={12} />
          </button>
          <button
            className="tab-action"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function PanelArea({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  return (
    <section className={`panel-area area-${area}${state.collapsed ? ' collapsed' : ''}`}>
      {!state.collapsed &&
        (area === 'left' ? (
          <div className="panel-title">{PANELS[state.activePanel].title}</div>
        ) : (
          <TabBar area={area} />
        ))}
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
  const selectedId = useModelStore((s) => s.selectedId);
  const setActive = useLayoutStore((s) => s.setActive);
  // Selecting a block brings the Properties tab up; deselecting returns AI.
  useEffect(() => {
    setActive('right', selectedId ? 'properties' : 'ai');
  }, [selectedId, setActive]);
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
      <Splitter area="right" vertical gridArea="sr" />
      <PanelArea area="right" />
      <Splitter area="bottom" vertical={false} gridArea="sb" />
      <PanelArea area="bottom" />
    </div>
  );
}

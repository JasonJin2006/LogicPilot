// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import { useEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Hammer, Play, Save, X } from 'lucide-react';
import { SIZE_RANGE, useLayoutStore } from '../state/layoutStore';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useCanvasView } from '../state/canvasView';
import { mergeModelSource } from '../project/project';
import { writeProjectFile } from '../state/tauriFs';
import { PANELS, type AreaId, type PanelId } from './panels';

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
  const openPanel = useLayoutStore((s) => s.openPanel);
  const canvasViews = useCanvasView((s) => s.views);
  const rootOpen = useCanvasView((s) => s.rootOpen);
  const activeView = useCanvasView((s) => s.view);
  const setCanvasView = useCanvasView((s) => s.setView);
  const closeView = useCanvasView((s) => s.closeView);
  const openFiles = useUiStore((s) => s.openFiles);
  const activeFile = useUiStore((s) => s.activeFile);
  const openFile = useUiStore((s) => s.openFile);
  const closeFile = useUiStore((s) => s.closeFile);
  const diskFiles = useUiStore((s) => s.diskFiles);
  const openRunDialog = useUiStore((s) => s.openRunDialog);
  const openInfo = useUiStore((s) => s.openInfo);
  const projectPath = useProjectStore((s) => s.path);
  const bundle = useProjectStore((s) => s.bundle);
  const activePanel = state.activePanel;
  // Right/bottom panels can be collapsed; the model workspace stays open.
  const closable = area !== 'center';
  const perTabClose = area === 'center';
  // Compile the merged model source (file editors compile the whole project).
  const handleCompile = () => {
    const { compile } = useConnectionStore.getState();
    if (bundle) {
      const merged = mergeModelSource(
        bundle.files[bundle.manifest.model] ?? '',
        bundle.files,
        bundle.manifest.modelParts ?? [],
      );
      compile(merged);
    } else {
      compile();
    }
  };
  // Write the currently open disk file back to the project folder.
  const handleSaveDiskFile = () => {
    const content = activeFile !== null ? diskFiles[activeFile] : undefined;
    if (activeFile === null || projectPath === null || content === undefined) {
      return;
    }
    void writeProjectFile(projectPath, activeFile, content).then((result) => {
      if (!result.ok) {
        openInfo('Save failed', result.error ?? 'cannot write the file');
        return;
      }
      void useProjectStore.getState().refreshDiskTree();
    });
  };
  const renderTab = (panel: PanelId) => (
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
  );
  return (
    <div className="tab-bar">
      {area === 'center' ? (
        <>
          {/* Canvas tabs: the model root plus every open container view.
              They exist only once opened - the empty center shows the
              empty-state instead of a blank canvas. */}
          {rootOpen && (
            <div
              className={`tab${state.activePanel === 'model' && activeView === null ? ' active' : ''}`}
              title="Model root canvas"
              onClick={() => {
                openPanel('center', 'model');
                setCanvasView(null);
              }}
            >
              <span className="tab-label">Model</span>
              <button
                className="tab-x"
                aria-label="Close Model tab"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeView(null);
                }}
              >
                <X size={11} />
              </button>
            </div>
          )}
          {canvasViews.map((view) => {
            const active =
              state.activePanel === 'model' &&
              activeView !== null &&
              activeView.kind === view.kind &&
              activeView.name === view.name;
            return (
              <div
                key={`view:${view.kind}:${view.name}`}
                className={`tab tab-view${active ? ' active' : ''}`}
                title={`Open ${view.kind} ${view.name}`}
                onClick={() => {
                  openPanel('center', 'model');
                  setCanvasView(view);
                }}
              >
                <span className="tab-label">{view.name}</span>
                <button
                  className="tab-x"
                  aria-label={`Close ${view.name} tab`}
                  title="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeView(view);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {/* Code tabs: one per open bundle file. */}
          {openFiles.map((path) => {
            const name = path.slice(path.lastIndexOf('/') + 1);
            const active = state.activePanel === 'dsl' && path === activeFile;
            return (
              <div
                key={`file:${path}`}
                className={`tab tab-file${active ? ' active' : ''}`}
                title={path}
                onClick={() => {
                  openPanel('center', 'dsl');
                  openFile(path);
                }}
              >
                <span className="tab-label">{name}</span>
                <button
                  className="tab-x"
                  aria-label={`Close ${name} tab`}
                  title="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(path);
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          {state.panels.includes('welcome') && (
            <div
              className={`tab${activePanel === 'welcome' ? ' active' : ''}`}
              title="Welcome"
              onClick={() => setActive('center', 'welcome')}
            >
              <span className="tab-label">Welcome</span>
              <button
                className="tab-x"
                aria-label="Close Welcome tab"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  useLayoutStore.getState().removePanel('center', 'welcome');
                }}
              >
                <X size={11} />
              </button>
            </div>
          )}
          {/* The right end of the tab bar is a contextual action area:
              Run for the canvas, Compile (and Save for disk files) for the
              code editor - icon buttons, not text. */}
          <div className="tab-actions">
            {activePanel === 'model' && (
              <button
                className="tab-action"
                title="Run the model"
                aria-label="Run"
                onClick={openRunDialog}
              >
                <Play size={14} />
              </button>
            )}
            {activePanel === 'dsl' && (
              <>
                {activeFile !== null && diskFiles[activeFile] !== undefined && (
                  <button
                    className="tab-action"
                    title="Save file to disk"
                    aria-label="Save"
                    onClick={handleSaveDiskFile}
                  >
                    <Save size={14} />
                  </button>
                )}
                <button
                  className="tab-action"
                  title="Compile the model"
                  aria-label="Compile"
                  onClick={handleCompile}
                >
                  <Hammer size={14} />
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        state.panels.map(renderTab)
      )}
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
    </div>
  );
}

function PanelArea({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  const centerPanels = useLayoutStore((s) => s.areas.center.panels);
  const canvasOpen = useCanvasView((s) => s.rootOpen || s.views.length > 0);
  const filesOpen = useUiStore((s) => s.openFiles.length > 0);
  const welcomeOpen = area === 'center' && centerPanels.includes('welcome');
  // Blank until a tab is opened: the welcome page is a closable tab too.
  const centerEmpty =
    area === 'center' && !canvasOpen && !filesOpen && !welcomeOpen;
  return (
    <section className={`panel-area area-${area}${state.collapsed ? ' collapsed' : ''}`}>
      {!state.collapsed &&
        (area === 'left' ? (
          <div className="panel-title">{PANELS[state.activePanel].title}</div>
        ) : !centerEmpty ? (
          <TabBar area={area} />
        ) : null)}
      {!state.collapsed && (
        <div className="panel-area-body">
          {!centerEmpty &&
            state.panels.map((panel) => {
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

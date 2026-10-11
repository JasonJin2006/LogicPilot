// The panel workspace: a CSS Grid skeleton (left / center / right / bottom)
// driven by the layout store. Each area is a TabBar + mounted panes (CSS
// visibility toggling keeps live data alive); splitters resize areas by
// writing size values into the store. See docs/specs/ide-layout.md.

import { useEffect, useReducer, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Box, ChevronDown, ChevronRight, Hammer, Play, Save, X } from 'lucide-react';
import { SIZE_RANGE, useLayoutStore } from '../state/layoutStore';
import { logConsoleEvent, useLegacyGatewayStore } from '../state/legacyGateway';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useCanvasView } from '../state/canvasView';
import { mergeModelSource } from '../project/project';
import { generateDsl, parseDsl } from '@logicpilot/editor';
import { writeProjectFile } from '../state/tauriFs';
import { PANELS, containerViews, focusedPanelId, type AreaId, type PanelId } from './panels';
import { BreadcrumbBar } from './BreadcrumbBar';
import { useProblemCount } from './ProblemsPanel';
import { ScrollArea } from '../components/ScrollArea';
import { editorPanelFor } from '../workbench/documentTypes';
import { onSelectionChanged } from '../workbench/selectionFocus';

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
  const problemCount = useProblemCount();
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
  // Compile follows the front tab. A DSL file tab compiles the merged file
  // source, so its parse/semantic errors reach the console (the file is the
  // thing being edited). The canvas view compiles the LIVE document instead
  // of the files: canvas-only edits never touch the files until Save, and
  // the old behaviour quietly compiled an empty/stale model with a success
  // reply - the worst kind of false negative. Any divergence in that path
  // is surfaced as LP4100 rather than silently resolved.
  const handleCompile = () => {
    const { compile } = useLegacyGatewayStore.getState();
    const activeFile = useUiStore.getState().activeFile;
    if (activeFile !== null) {
      // File-editor context: compile the whole project's file text.
      if (bundle) {
        compile(
          mergeModelSource(
            bundle.files[bundle.manifest.model] ?? '',
            bundle.files,
            bundle.manifest.modelParts ?? [],
          ),
        );
      } else {
        compile();
      }
      return;
    }
    const docSource = generateDsl(useModelStore.getState().document);
    if (bundle) {
      const merged = mergeModelSource(
        bundle.files[bundle.manifest.model] ?? '',
        bundle.files,
        bundle.manifest.modelParts ?? [],
      );
      const parsedFiles = parseDsl(merged);
      if (!parsedFiles.ok) {
        logConsoleEvent(
          'warn',
          'LP4100: file text has parse errors - compiling the last valid canvas model',
        );
      } else if (generateDsl(parsedFiles.document) !== docSource) {
        logConsoleEvent(
          'warn',
          'LP4100: file text differs from the canvas model - compiling the canvas model (save to persist it)',
        );
      }
    }
    compile(docSource);
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
  const renderTab = (panel: PanelId) => {
    const definition = PANELS[panel];
    const Icon = definition?.icon;
    const problemBadge = area === 'bottom' && panel === 'problems' ? problemCount : undefined;
    return (
      <div
        key={panel}
        className={`tab${panel === state.activePanel ? ' active' : ''}`}
        onClick={() => setActive(area, panel)}
      >
        {Icon !== undefined && (
          <span className="tab-icon" aria-hidden>
            <Icon size={11} />
          </span>
        )}
        <span className="tab-label">{definition?.title ?? panel}</span>
        {problemBadge !== undefined && problemBadge > 0 && (
          <span className="tab-badge">{problemBadge > 99 ? '99+' : problemBadge}</span>
        )}
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
  };
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
          {/* Code tabs: one per open bundle file. The contribution registry
              picks the editor panel for each path. */}
          {openFiles.map((path) => {
            const name = path.slice(path.lastIndexOf('/') + 1);
            const panel = editorPanelFor(path);
            const active = state.activePanel === panel && path === activeFile;
            return (
              <div
                key={`file:${path}`}
                className={`tab tab-file${active ? ' active' : ''}`}
                title={path}
                onClick={() => {
                  openPanel('center', panel);
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
          {state.panels.includes('scene3d') && (
            <div
              className={`tab${activePanel === 'scene3d' ? ' active' : ''}`}
              title="3D scene"
              onClick={() => setActive('center', 'scene3d')}
            >
              <span className="tab-label">Scene</span>
              <button
                className="tab-x"
                aria-label="Close Scene tab"
                title="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  useLayoutStore.getState().removePanel('center', 'scene3d');
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
              <>
                <button
                  className="tab-action"
                  title="Run the model"
                  aria-label="Run"
                  onClick={openRunDialog}
                >
                  <Play size={14} />
                </button>
                <button
                  className="tab-action"
                  title="View the model in 3D"
                  aria-label="3D scene"
                  onClick={() => openPanel('center', 'scene3d')}
                >
                  <Box size={14} />
                </button>
              </>
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

/** One stacked side-bar view: a VS Code section header over a collapsible
 *  body. Collapse state is local - it is pure view chrome and never needs to
 *  reach the layout store. The body stays mounted while collapsed (hidden
 *  rather than unmounted) so a hosted view keeps its scroll position and live
 *  subscriptions, matching how the pane areas keep their tabs alive. */
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel-section">
      <button
        type="button"
        className="panel-section-header"
        aria-expanded={open}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="panel-title">{title}</span>
      </button>
      <div className="panel-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function PanelArea({ area }: { area: AreaId }) {
  const state = useLayoutStore((s) => s.areas[area]);
  const centerPanels = useLayoutStore((s) => s.areas.center.panels);
  const canvasOpen = useCanvasView((s) => s.rootOpen || s.views.length > 0);
  const filesOpen = useUiStore((s) => s.openFiles.length > 0);
  const welcomeOpen = area === 'center' && centerPanels.includes('welcome');
  // The 3D scene is a centre tab without a backing document, so it has to count
  // as "a tab is open" or the body would stay blank with its tab showing.
  const sceneOpen = area === 'center' && centerPanels.includes('scene3d');
  // Blank until a tab is opened: the welcome page is a closable tab too.
  const centerEmpty =
    area === 'center' && !canvasOpen && !filesOpen && !welcomeOpen && !sceneOpen;
  // The left side bar stacks views instead of paging them: the activity bar
  // picks a *container*, and every view that names it is rendered at once.
  // Other areas stay tabbed (one pane at a time).
  const stacked = area === 'left';
  const visiblePanels = stacked ? containerViews(state.panels, state.activePanel) : state.panels;
  return (
    <section className={`panel-area area-${area}${state.collapsed ? ' collapsed' : ''}`}>
      {!state.collapsed && !stacked && !centerEmpty && <TabBar area={area} />}
      {!state.collapsed && area === 'center' && !centerEmpty && <BreadcrumbBar />}
      {!state.collapsed && (
        <div className="panel-area-body">
          {!centerEmpty &&
            visiblePanels.map((panel) => {
              const definition = PANELS[panel];
              if (definition === undefined) {
                return null; // stale persisted panel: skipped defensively
              }
              const PanelComponent = definition.component;
              if (stacked) {
                return (
                  <PanelSection key={panel} title={definition.title}>
                    <PanelComponent />
                  </PanelSection>
                );
              }
              return (
                <div
                  key={panel}
                  className={`panel-pane${panel === state.activePanel ? ' active' : ''}`}
                >
                  {area === 'center' ? (
                    <PanelComponent />
                  ) : (
                    // Side / bottom panes scroll inside the themed thumb;
                    // the center canvas and code editor manage their own
                    // scroll surfaces.
                    <ScrollArea>
                      <PanelComponent />
                    </ScrollArea>
                  )}
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
  const [selectionEpoch, bumpSelectionEpoch] = useReducer((count: number) => count + 1, 0);
  const setActive = useLayoutStore((s) => s.setActive);
  const openPanel = useLayoutStore((s) => s.openPanel);
  // Selection-driven panel focus: the first registered right-area panel
  // whose focus probe fires comes forward; with nothing selected the AI tab
  // (the area default) returns. The probes live on the panel definitions
  // plus plugin-contributed probes (workbench/selectionFocus), so languages
  // own their properties-panel rule - this effect re-runs on model selection
  // changes and on any store a plugin registered through the seam.
  useEffect(() => onSelectionChanged(bumpSelectionEpoch), [bumpSelectionEpoch]);
  useEffect(() => {
    const focused = focusedPanelId('right');
    if (focused !== null) {
      openPanel('right', focused);
    } else {
      setActive('right', 'ai');
    }
  }, [selectedId, selectionEpoch, setActive, openPanel]);
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

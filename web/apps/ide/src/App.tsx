// LogicPilot IDE root layout: run toolbar, activity bar + panel workspace
// and a global status bar. Connection setup lives in the settings dialog
// (activity bar gear); stats charts and results are center-workspace tabs
// (AnyLogic-style opt-in telemetry views), not pinned side panels.

// Composition root for paradigm plugins: register document types and panels
// before any other module evaluates, so persisted layouts validate against
// the complete panel table and file routing sees every extension (ADR-0068).
import './plugins';

import { ActivityBar } from './layout/ActivityBar';
import { TopBar } from './layout/TopBar';
import { Workspace } from './layout/Workspace';
import { InfoDialog } from './layout/InfoDialog';
import { EditableContextMenu } from './layout/EditableContextMenu';
import { ConfirmDialog } from './layout/ConfirmDialog';
import { PromptDialog } from './layout/PromptDialog';
import { NewProjectDialog } from './run/NewProjectDialog';
import { RunDialog } from './run/RunDialog';
import { SettingsDialog } from './run/SettingsDialog';
import { StatusBar } from './run/StatusBar';
import { useModelStore } from './state/modelStore';
import { useLayoutStore } from './state/layoutStore';
import { useProjectStore } from './state/projectStore';
import { useCanvasView, syncCanvasViewsWithDocument } from './state/canvasView';
import { useConnectionStore } from './state/connectionStore';
import { useUiStore } from './state/uiStore';
import { ThemeManager } from './theme/ThemeManager';
import { editorPanelFor } from './workbench/documentTypes';
import { useEffect } from 'react';

export default function App() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const runDialogOpen = useUiStore((state) => state.runDialogOpen);
  const activeFile = useUiStore((state) => state.activeFile);
  const projectPath = useProjectStore((state) => state.path);
  const canvasView = useCanvasView();

  // The gateway should just work: auto-connect on startup (the desktop
  // client launches lp-server itself; the browser dev server can connect to
  // the default ws://127.0.0.1:8089/sim). Retries stop when connected.
  useEffect(() => {
    useConnectionStore.getState().autoConnect();
    return () => useConnectionStore.getState().disconnect();
  }, []);

  // Opening a file brings the DSL editor tab to the front; closing the last
  // code tab falls back to the open canvas (model root / container views) so
  // the center does not linger on the editor with nothing open.
  useEffect(() => {
    if (activeFile !== null) {
      useLayoutStore.getState().openPanel('center', editorPanelFor(activeFile));
      return;
    }
    const { rootOpen, views } = useCanvasView.getState();
    if (rootOpen || views.length > 0) {
      useLayoutStore.getState().openPanel('center', 'model');
    }
  }, [activeFile]);

  // Desktop projects are edited by both the IDE and external tools. Poll the
  // lightweight content hashes so conflicts are visible before Save instead
  // of surprising the user only after a long editing session.
  useEffect(() => {
    if (!projectPath) return;
    const scan = () => void useProjectStore.getState().scanDiskChanges();
    void scan();
    const timer = window.setInterval(scan, 2000);
    return () => window.clearInterval(timer);
  }, [projectPath]);

  // Focusing a container (canvas view) brings the canvas tab to the front,
  // but only while a canvas is actually open - closing a project falls back
  // to the welcome tab / blank center instead of re-activating the canvas.
  useEffect(() => {
    const { rootOpen, views } = useCanvasView.getState();
    if (rootOpen || views.length > 0) {
      useLayoutStore.getState().openPanel('center', 'model');
    }
  }, [canvasView]);

  // Track dirty state against the last saved project bundle: any canvas
  // document change marks the project dirty; the open/save/new handlers call
  // markClean() after they finish. On mount, a persisted bundle restores the
  // project identity and dirty is derived by comparing its saved canvas to
  // the live draft document.
  useEffect(() => {
    const unsubscribe = useModelStore.subscribe((state, previous) => {
      if (state.document !== previous.document) {
        useProjectStore.getState().markDirty();
        // Renames/removals must re-key or close the open container tabs
        // (undo/redo included), or stale empty views linger.
        syncCanvasViewsWithDocument(state.document, previous.document);
      }
    });
    const { bundle } = useProjectStore.getState();
    if (bundle) {
      const canvas = bundle.files[bundle.manifest.presentation];
      const saved = canvas ?? '';
      const draft = JSON.stringify(useModelStore.getState().document, null, 2);
      useProjectStore.getState().setDirty(saved !== draft);
    }
    return unsubscribe;
  }, []);

  return (
    <>
      <ThemeManager />
      <div className="app">
        <EditableContextMenu />
        <TopBar />
        <div className="app-body">
          <ActivityBar />
          <Workspace />
        </div>
        <StatusBar />
        {settingsOpen && <SettingsDialog />}
        {runDialogOpen && <RunDialog />}
        <NewProjectDialog />
        <PromptDialog />
        <ConfirmDialog />
        <InfoDialog />
      </div>
    </>
  );
}

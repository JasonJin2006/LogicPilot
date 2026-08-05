// LogicPilot IDE root layout: run toolbar, activity bar + panel workspace
// and a global status bar. Connection setup lives in the settings dialog
// (activity bar gear); stats charts and results are center-workspace tabs
// (AnyLogic-style opt-in telemetry views), not pinned side panels.

import { ActivityBar } from './layout/ActivityBar';
import { TopBar } from './layout/TopBar';
import { Workspace } from './layout/Workspace';
import { InfoDialog } from './layout/InfoDialog';
import { NewProjectDialog } from './run/NewProjectDialog';
import { RunDialog } from './run/RunDialog';
import { SettingsDialog } from './run/SettingsDialog';
import { StatusBar } from './run/StatusBar';
import { useModelStore } from './state/modelStore';
import { useProjectStore } from './state/projectStore';
import { useUiStore } from './state/uiStore';
import { projectToDocument } from './project/project';
import { ThemeManager } from './theme/ThemeManager';
import { useEffect } from 'react';

export default function App() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const runDialogOpen = useUiStore((state) => state.runDialogOpen);

  // Track dirty state against the last saved project bundle: any canvas
  // document change marks the project dirty; the open/save/new handlers call
  // markClean() after they finish. On mount, a persisted bundle restores the
  // project identity and dirty is derived by comparing its saved canvas to
  // the live draft document.
  useEffect(() => {
    const unsubscribe = useModelStore.subscribe((state, previous) => {
      if (state.document !== previous.document) {
        useProjectStore.getState().markDirty();
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
        <TopBar />
        <div className="app-body">
          <ActivityBar />
          <Workspace />
        </div>
        <StatusBar />
        {settingsOpen && <SettingsDialog />}
        {runDialogOpen && <RunDialog />}
        <NewProjectDialog />
        <InfoDialog />
      </div>
    </>
  );
}

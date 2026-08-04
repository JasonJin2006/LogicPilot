// LogicPilot IDE root layout: run toolbar, activity bar + panel workspace
// and a global status bar. Connection setup lives in the settings dialog
// (activity bar gear); stats charts and results are center-workspace tabs
// (AnyLogic-style opt-in telemetry views), not pinned side panels.

import { ActivityBar } from './layout/ActivityBar';
import { TopBar } from './layout/TopBar';
import { Workspace } from './layout/Workspace';
import { RunDialog } from './run/RunDialog';
import { SettingsDialog } from './run/SettingsDialog';
import { StatusBar } from './run/StatusBar';
import { useUiStore } from './state/uiStore';
import { ThemeManager } from './theme/ThemeManager';

export default function App() {
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const runDialogOpen = useUiStore((state) => state.runDialogOpen);
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
      </div>
    </>
  );
}

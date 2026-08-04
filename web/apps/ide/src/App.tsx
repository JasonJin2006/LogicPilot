// LogicPilot IDE root layout: header (brand + connection/run control),
// activity bar + panel workspace (VS Code + AnyLogic style), and a global
// status bar. Panels and layout are driven by the layout store + registry
// (see docs/specs/ide-layout.md); domain state lives in the domain stores.

import { ActivityBar } from './layout/ActivityBar';
import { Workspace } from './layout/Workspace';
import { ConnectionPanel } from './run/ConnectionPanel';
import { StatusBar } from './run/StatusBar';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>LogicPilot</h1>
        <ConnectionPanel />
      </header>
      <div className="app-body">
        <ActivityBar />
        <Workspace />
      </div>
      <StatusBar />
    </div>
  );
}

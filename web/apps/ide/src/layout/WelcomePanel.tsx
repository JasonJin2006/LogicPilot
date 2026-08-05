// Center tab (Welcome): the start page with a New project action. It is a
// closable tab like any other - the center is blank until it (or a canvas /
// file tab) is opened. Reached via Help > Welcome.

import { useUiStore } from '../state/uiStore';

export function WelcomePanel() {
  const openNewProject = useUiStore((state) => state.openNewProject);
  return (
    <div className="center-empty">
      <img className="center-empty-logo" src="/logo.svg" alt="LogicPilot" />
      <p>Nothing is open - open a project element or a file to start editing.</p>
      <button className="btn-primary" onClick={openNewProject}>
        New project
      </button>
    </div>
  );
}

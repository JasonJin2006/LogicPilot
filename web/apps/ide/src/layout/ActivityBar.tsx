// Activity bar (VS Code style): switches which side panel the left sidebar
// shows. Clicking the active view again collapses the sidebar.

import { useLayoutStore } from '../state/layoutStore';
import { useUiStore } from '../state/uiStore';
import { ACTIVITY_VIEWS } from './panels';

export function ActivityBar() {
  const left = useLayoutStore((s) => s.areas.left);
  const setActive = useLayoutStore((s) => s.setActive);
  const toggleCollapse = useLayoutStore((s) => s.toggleCollapse);
  const openSettings = useUiStore((s) => s.openSettings);
  return (
    <nav className="activity-bar">
      {ACTIVITY_VIEWS.map((view) => {
        const active = left.activePanel === view.panel && !left.collapsed;
        return (
          <button
            key={view.id}
            className={`activity-item${active ? ' active' : ''}`}
            aria-label={view.label}
            title={view.label}
            onClick={() => {
              if (active) {
                toggleCollapse('left');
              } else {
                if (left.collapsed) {
                  toggleCollapse('left');
                }
                setActive('left', view.panel);
              }
            }}
          >
            <span className="activity-glyph">{view.glyph}</span>
          </button>
        );
      })}
      <div className="activity-spacer" />
      <button
        className="activity-item"
        aria-label="Settings"
        title="Settings"
        onClick={openSettings}
      >
        <span className="activity-glyph">⚙</span>
      </button>
    </nav>
  );
}

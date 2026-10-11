// Status strip, two segments (VS Code style). Left: what the workspace is
// connected to and what is wrong with it. Right: the context of the document
// in front, then the notification bell. The gateway event log lives in the
// Console panel, and frame-level telemetry (seq / sim_time) is not pinned
// here either.
//
// Every slot reports a value the shell already holds, and none of them names
// a paradigm: the language mode comes from the document contribution
// registry, the caret from the editor that owns it, and the counters from the
// problem aggregation seam. The bar reads the same with zero plugins as it
// does with all of them.

import { AlertTriangle, Bell, CircleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLegacyGatewayStore } from '../state/legacyGateway';
import { useExecutionStore } from '../state/executionStore';
import { useLayoutStore } from '../state/layoutStore';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useProblemCounts } from '../layout/ProblemsPanel';
import { requestOpenPanel } from '../workbench/panelCommands';
import { documentContributionFor, editorPanelFor } from '../workbench/documentTypes';
import { backendLabel, declaredLibraries } from '../workbench/statusSlots';

/** The document type in front, named by whoever contributed it. A path with
 *  no contribution (a plain file, or every path when no plugin is active)
 *  falls back to its extension rather than to an invented language name. */
function languageLabel(path: string | null): string | null {
  if (path === null) return null;
  const contributed = documentContributionFor(path)?.label;
  if (contributed !== undefined) return contributed;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : null;
}

export function StatusBar() {
  const conn = useLegacyGatewayStore((state) => state.conn);
  const error = useLegacyGatewayStore((state) => state.error);
  const badFrames = useLegacyGatewayStore((state) => state.badFrames);
  const nativeSession = useExecutionStore((state) => state.session);
  const targets = useExecutionStore((state) => state.targets);
  const externalChanges = useProjectStore((state) => state.externalChanges);
  const counts = useProblemCounts();
  const document = useModelStore((state) => state.document);
  // What the model declares it is built on. The shell echoes the names; it
  // does not know what any of them mean, so a new pack lights the slot up
  // without an edit here.
  const libraries = useMemo(() => declaredLibraries(document), [document]);
  const targetIds = useMemo(() => targets.map((target) => target.id), [targets]);
  const backend = backendLabel(nativeSession?.targetId ?? null, targetIds);
  // A count in the text, the actual list in the tooltip: several targets are
  // the normal desktop case (one per paradigm family, ADR-0132).
  const backendTitle =
    targetIds.length > 1
      ? `Execution targets: ${targetIds.join(', ')}`
      : 'Execution target for this workspace';
  const activeFile = useUiStore((state) => state.activeFile);
  const caret = useUiStore((state) => state.editorCaret);
  // The centre area keeps every pane mounted, so a caret belonging to a file
  // that is no longer in front must be filtered out here: only report a
  // position while the pane hosting that document is the visible one.
  const frontPanel = useLayoutStore((state) => state.areas.center.activePanel);
  const showCaret =
    caret !== null && caret.path === activeFile && frontPanel === editorPanelFor(activeFile);
  const language = languageLabel(activeFile);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const effectiveConnection = nativeSession?.status ?? conn;
  return (
    <div className="status-bar">
      <div className="status-group status-group-left">
        <span className={`conn-dot conn-${effectiveConnection}`} title={effectiveConnection} />
        {backend !== null && (
          <span className="status-item" title={backendTitle}>
            Backend: {backend}
          </span>
        )}
        {(counts.errors > 0 || counts.warnings > 0) && (
          <button
            type="button"
            className="status-item"
            title="Show problems"
            aria-label={`Problems: ${counts.errors} errors, ${counts.warnings} warnings`}
            onClick={() => requestOpenPanel('bottom', 'problems')}
          >
            <CircleAlert size={12} aria-hidden />
            <span>{counts.errors}</span>
            <AlertTriangle size={12} aria-hidden />
            <span>{counts.warnings}</span>
          </button>
        )}
        {badFrames > 0 && <span className="warn">bad: {badFrames}</span>}
        {externalChanges.length > 0 && (
          <span className="warn" title="Files changed on disk; Save will ask before overwriting">
            changed: {externalChanges.length}
          </span>
        )}
        {error && <span className="error">{error}</span>}
      </div>
      <div className="status-spacer" />
      <div className="status-group status-group-right">
        {showCaret && (
          <span className="status-item">
            Ln {caret.line}, Col {caret.column}
          </span>
        )}
        {language !== null && <span className="status-item">{language}</span>}
        {libraries.length > 0 && (
          <span className="status-item" title="Libraries this model declares with `use`">
            Paradigm: {libraries.join(', ')}
          </span>
        )}
        <div className="notifications">
          <button
            className="bell-btn"
            aria-label="Notifications"
            title="Notifications"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell size={14} />
          </button>
          {notificationsOpen && (
            <div className="notif-popover">
              {externalChanges.length === 0 ? (
                <p className="notif-empty">No system notifications</p>
              ) : (
                <div className="notif-list">
                  <strong>Files changed on disk</strong>
                  <p>{externalChanges.slice(0, 5).join(', ')}</p>
                  {externalChanges.length > 5 && <p>and {externalChanges.length - 5} more…</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

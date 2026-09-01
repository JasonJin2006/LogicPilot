// Bottom panel (Problems): one aggregated, navigable list across document
// kinds. Entries come from the workbench diagnostic aggregation; clicking
// an entry selects the owning node on the originating canvas so the user
// can answer "what is wrong and where" without touring every surface.

import { useMemo } from 'react';
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import { useSysMLStore } from '../state/sysmlStore';
import { collectProblems, type ProblemEntry } from '../workbench/problems';
import { requestOpenPanel } from '../workbench/panelCommands';
import { ScrollArea } from '../components/ScrollArea';
function severityIcon(severity: ProblemEntry['severity']) {
  if (severity === 'error') return <AlertOctagon size={13} className="problem-icon-error" />;
  if (severity === 'warning') return <AlertTriangle size={13} className="problem-icon-warning" />;
  return <Info size={13} className="problem-icon-info" />;
}

export function ProblemsPanel() {
  const document = useModelStore((state) => state.document);
  const selectNode = useModelStore((state) => state.select);
  const projection = useSysMLStore((state) => state.projection);
  const parseDirty = useSysMLStore((state) => state.parseDirty);

  const problems = useMemo(
    () => collectProblems({ document }, { projection, parseDirty }),
    [document, projection, parseDirty],
  );

  if (problems.length === 0) {
    return <p className="console-empty">No problems detected.</p>;
  }

  const navigate = (entry: ProblemEntry): void => {
    if (entry.origin === 'model' && entry.nodeId) {
      // Bring the modeling canvas forward, then select the node so the
      // properties panel follows. The command seam avoids importing the
      // persisted layout store back through the panel registry cycle.
      requestOpenPanel('center', 'model');
      selectNode(entry.nodeId);
    }
    // Text-backed SysML entries carry a line only; the projection canvas
    // already highlights SYxxxx warnings inline, so there is nowhere more
    // precise to navigate yet.
  };

  return (
    <ScrollArea className="console-scroll">
      <div className="problems-list" role="list">
        {problems.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="listitem"
            className={`problem-row problem-${entry.severity}`}
            title={entry.message}
            onClick={() => navigate(entry)}
          >
            {severityIcon(entry.severity)}
            <span className="problem-origin">{entry.origin}</span>
            <strong className="problem-code">{entry.code}</strong>
            <span className="problem-message">{entry.message}</span>
            {entry.path !== undefined && (
              <span className="problem-line" title={entry.path}>
                {entry.path.split('/').pop()}
              </span>
            )}
            {entry.line !== undefined && <span className="problem-line">line {entry.line}</span>}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

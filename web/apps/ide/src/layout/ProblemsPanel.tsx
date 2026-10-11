// Bottom panel (Problems): one aggregated, navigable list across document
// kinds. Entries come from the workbench diagnostic aggregation; clicking
// an entry selects the owning node on the originating canvas so the user
// can answer "what is wrong and where" without touring every surface.
//
// Phase 2: the panel subscribes to the shell model store plus every
// contributed problem source through useSyncExternalStore - it never
// names a paradigm.

import { useMemo, useSyncExternalStore } from 'react';
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import {
  collectProblems,
  countProblems,
  problemSourcesVersion,
  subscribeProblemSources,
  type ProblemCounts,
  type ProblemEntry,
} from '../workbench/problems';
import { requestOpenPanel } from '../workbench/panelCommands';
import { ScrollArea } from '../components/ScrollArea';
function severityIcon(severity: ProblemEntry['severity']) {
  if (severity === 'error') return <AlertOctagon size={13} className="problem-icon-error" />;
  if (severity === 'warning') return <AlertTriangle size={13} className="problem-icon-warning" />;
  return <Info size={13} className="problem-icon-info" />;
}

/** Monotonic epoch over all contributed problem sources: re-renders the
 *  aggregation when any contributed store emits. */
function useContributedEpoch(): number {
  return useSyncExternalStore(
    subscribeProblemSources,
    problemSourcesVersion,
    problemSourcesVersion,
  );
}

/** Live problems for every summary surface (panel list, tab badge, status
 *  bar). One subscription to the model document plus every contributed
 *  problem source, so each summary follows the diagnostics without the
 *  consumer knowing a paradigm. */
export function useProblems(): readonly ProblemEntry[] {
  const document = useModelStore((state) => state.document);
  const contributedEpoch = useContributedEpoch();
  return useMemo(() => collectProblems({ document }), [document, contributedEpoch]);
}

/** Live problem count for VS Code-style tab badges. */
export function useProblemCount(): number {
  return useProblems().length;
}

/** Severity totals for the status bar, derived from the same entries the
 *  panel lists. */
export function useProblemCounts(): ProblemCounts {
  const problems = useProblems();
  return useMemo(() => countProblems(problems), [problems]);
}

export function ProblemsPanel() {
  const selectNode = useModelStore((state) => state.select);
  const problems = useProblems();

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
    // Text-backed contributed entries carry a line only; their owners may
    // highlight inline, so navigation beyond the row is source-defined.
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

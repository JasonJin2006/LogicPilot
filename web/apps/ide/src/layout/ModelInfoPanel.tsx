// Side panel host (Project view): a generic outline host per the workbench
// extension contracts (workbench-architecture-plan.md §5/§9.2). Semantic
// element trees come from outline contributions registered by language
// extensions - this file parses no language and branches on no kind. Each
// contribution owns its store subscriptions; the host only decides WHICH
// contribution applies to the current workspace context.

import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { documentContributionFor } from '../workbench/documentTypes';
import { OUTLINE_CONTRIBUTIONS } from '../workbench/outline';
// Outline contributions (side-effect registration). The SysML outline
// outranks the generic project tree while a .sysml file is active.
import '../sysml/sysmlOutlineContribution';
import '../project/dslOutlineContribution';

export function ModelInfoPanel() {
  const bundle = useProjectStore((state) => state.bundle);
  const projectPath = useProjectStore((state) => state.path);
  const activeFile = useUiStore((state) => state.activeFile);

  const contribution = OUTLINE_CONTRIBUTIONS.resolve({
    activePath: activeFile,
    activeDocumentType:
      activeFile !== null ? (documentContributionFor(activeFile)?.id ?? null) : null,
    hasProject: bundle !== null && bundle !== undefined,
  });

  if (contribution === null) {
    return (
      <div className="side-panel-body">
        {projectPath !== null && (
          <p className="side-kv">
            This folder is not a LogicPilot project. Edit files in the Explorer, then Save to
            initialize it.
          </p>
        )}
      </div>
    );
  }

  const Outline = contribution.component;
  return <Outline />;
}

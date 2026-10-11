// Editor breadcrumb (VS Code style): the path of the document in front, plus
// the model element the canvas is focused on. Pure chrome - it reads the same
// stores the tab bar reads and owns no state, so it cannot desync the
// workspace; it simply hides itself when there is nothing to describe.

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { useCanvasView } from '../state/canvasView';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/** Keep long paths readable: first segment, an ellipsis, then the last two. */
function visibleSegments(segments: readonly string[]): string[] {
  if (segments.length <= 4) {
    return [...segments];
  }
  return [segments[0]!, '…', ...segments.slice(-2)];
}

/** The breadcrumb trail for a document: project, path segments, then the
 *  focused symbol - exactly like a language-server breadcrumb appends the
 *  enclosing element. Pure, so the shape is unit-testable without a DOM. */
export function breadcrumbCrumbs(
  projectName: string | null,
  activeFile: string | null,
  viewName: string | null,
): string[] {
  const crumbs: string[] = [];
  if (projectName !== null && projectName.length > 0) {
    crumbs.push(projectName);
  }
  if (activeFile !== null) {
    crumbs.push(...visibleSegments(activeFile.split('/').filter(Boolean)));
  }
  if (viewName !== null && viewName.length > 0) {
    crumbs.push(viewName);
  }
  return crumbs;
}

export function BreadcrumbBar() {
  const activeFile = useUiStore((state) => state.activeFile);
  const projectName = useProjectStore((state) => state.bundle?.manifest.name ?? null);
  const view = useCanvasView((state) => state.view);

  const crumbs = breadcrumbCrumbs(projectName, activeFile, view?.name ?? null);
  if (crumbs.length === 0) {
    return null;
  }
  return (
    <nav className="breadcrumb-bar" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => (
        <Fragment key={`${crumb}-${index}`}>
          {index > 0 && <ChevronRight className="breadcrumb-chevron" size={12} />}
          <span
            className={`breadcrumb-label${index === crumbs.length - 1 ? ' current' : ''}`}
            title={crumb}
          >
            {crumb}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}

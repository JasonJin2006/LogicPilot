// SysML panel contribution (workbench-architecture-plan.md §5/§13): the
// projection editor registers through the open panel registry, so the core
// panel table carries no per-language entries. Element properties render
// inside the shared Properties host (layout/PropertiesHost), which switches
// content by active document kind - SysML deliberately does NOT register a
// separate properties tab. The lazy import keeps SysML-specific
// dependencies out of the eager graph.

import { lazy, Suspense } from 'react';
import { registerPanel } from '../layout/panels';

const LazySysMLWorkspace = lazy(() =>
  import('./SysMLWorkspace').then((module) => ({ default: module.SysMLWorkspace })),
);
function SysMLWorkspacePanel() {
  return (
    <Suspense fallback={<div className="sysml-empty">Loading SysML projection...</div>}>
      <LazySysMLWorkspace />
    </Suspense>
  );
}

registerPanel('sysml', { title: 'SysML', area: 'center', component: SysMLWorkspacePanel });

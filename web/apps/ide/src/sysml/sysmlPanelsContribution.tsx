// SysML panel contribution (workbench-architecture-plan.md §5/§13): the
// projection editor and properties panels register through the open panel
// registry, so the core panel table carries no per-language entries. The
// lazy imports keep SysML-specific dependencies out of the eager graph.

import { lazy, Suspense } from 'react';
import { useSysMLStore } from '../state/sysmlStore';
import { registerPanel } from '../layout/panels';

const LazySysMLWorkspace = lazy(() =>
  import('./SysMLWorkspace').then((module) => ({ default: module.SysMLWorkspace })),
);
const LazySysMLProperties = lazy(() =>
  import('./SysMLPropertiesPanel').then((module) => ({ default: module.SysMLPropertiesPanel })),
);
function SysMLWorkspacePanel() {
  return (
    <Suspense fallback={<div className="sysml-empty">Loading SysML projection...</div>}>
      <LazySysMLWorkspace />
    </Suspense>
  );
}
function SysMLPropertiesPanel() {
  return (
    <Suspense fallback={<div className="sysml-properties-empty">Loading SysML properties...</div>}>
      <LazySysMLProperties />
    </Suspense>
  );
}

registerPanel('sysml', { title: 'SysML', area: 'center', component: SysMLWorkspacePanel });
// Focused while a projected element is selected; deselecting hands focus
// back to the AI tab (the workspace's right-area default).
registerPanel('sysmlProperties', {
  title: 'SysML Properties',
  area: 'right',
  component: SysMLPropertiesPanel,
  focus: () => useSysMLStore.getState().selectedId !== null,
});

// Properties host (workbench §5): ONE Properties tab on the right that
// switches its content by the active document kind. The model canvas keeps
// its DSL properties; a SysML projection swaps in the element inspector.
// Language panels used to register their own sibling tabs, which read as two
// parallel "properties" surfaces - the host removes that split without
// letting the core panel table name any language.

import { lazy, Suspense } from 'react';
import { useUiStore } from '../state/uiStore';
import { documentContributionFor } from '../workbench/documentTypes';
import { PropertiesPanel } from '../model/PropertiesPanel';

const LazySysmlProperties = lazy(() =>
  import('../sysml/SysMLPropertiesPanel').then((module) => ({
    default: module.SysMLPropertiesPanel,
  })),
);

export function PropertiesHost() {
  const activeFile = useUiStore((state) => state.activeFile);
  const isSysml = activeFile !== null && documentContributionFor(activeFile)?.id === 'sysml';
  if (!isSysml) return <PropertiesPanel />;
  return (
    <Suspense fallback={<div className="sysml-properties-empty">Loading SysML properties...</div>}>
      <LazySysmlProperties />
    </Suspense>
  );
}

// Properties host (workbench §5): ONE Properties tab on the right that
// switches its content by the active document kind. The model canvas keeps
// its DSL properties; other document kinds contribute their own property
// editor through the workbench propertiesEditor seam (Phase 2: the shell
// never names a paradigm - the old hardcoded SysML branch moved into the
// SysML plugin's contribution). Language panels used to register their own
// sibling tabs, which read as two parallel "properties" surfaces - the host
// removes that split without letting the core panel table name any language.

import { lazy, Suspense, type ComponentType } from 'react';
import { useUiStore } from '../state/uiStore';
import { documentContributionFor } from '../workbench/documentTypes';
import { PropertiesPanel } from '../plugins/builtin/properties';

/** Contributed property editors keyed by document contribution id. */
const contributedEditors = new Map<string, () => ComponentType>();

/** Register a properties editor for a document type (plugin contribution).
 *  Duplicate document types are rejected like every other registry. */
export function registerPropertiesEditor(
  documentType: string,
  load: () => ComponentType,
): () => void {
  if (contributedEditors.has(documentType)) {
    throw new Error(`properties editor for '${documentType}' is already registered`);
  }
  contributedEditors.set(documentType, load);
  return () => {
    if (contributedEditors.get(documentType) === load) contributedEditors.delete(documentType);
  };
}

/** Test/teardown helper. */
export function clearPropertiesEditors(): void {
  contributedEditors.clear();
}

export function PropertiesHost() {
  const activeFile = useUiStore((state) => state.activeFile);
  const documentType = activeFile !== null ? documentContributionFor(activeFile)?.id : undefined;
  const loadEditor = documentType !== undefined ? contributedEditors.get(documentType) : undefined;

  if (loadEditor === undefined) return <PropertiesPanel />;

  const Editor = lazy(async () => {
    const component = await Promise.resolve(loadEditor());
    return { default: component };
  });
  return (
    <Suspense fallback={<div className="sysml-properties-empty">Loading properties...</div>}>
      <Editor />
    </Suspense>
  );
}

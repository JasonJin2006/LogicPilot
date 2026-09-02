// SysML semantic provider seam. Concrete parser, projection, execution and
// layout modules are wired here; state and AI consumers depend only on this
// registry-owned surface.
export {
  autoLayoutSysML,
  projectSysML,
  type SysMLLayout,
  type SysMLPosition,
  type SysMLProjection,
} from '../../sysml/sysmlProjection';
export {
  extractExecutionTargets,
  runExecutionTarget,
  SYSML_EXECUTION_CONFORMANCE_VERSION,
  type TraceStep,
} from '../../sysml/sysmlExecution';
export {
  appendEvidence,
  makeEvidenceId,
  parseEvidence,
  serializeEvidence,
  type SysMLEvidenceRecord,
} from '../../sysml/sysmlEvidence';
export { autoLayoutChunkedWithElk, autoLayoutWithElk } from '../../sysml/sysmlAutoLayoutElk';
export { buildLinkedSysMLModel, type SysMLFileUnit } from '../../sysml/sysmlLinkedModel';
export {
  addRelationStatement,
  insertElement,
  renameElement,
  type RelationVerb,
} from '../../sysml/sysmlEdits';
export { definitionAt, referencesOf } from '../../sysml/sysmlLanguage';
export { lowerStateMachine } from '../../sysml/sysmlLowering';
export { buildSysMLProjectIndex, resolveInIndex } from '../../sysml/sysmlProjectIndex';

import {
  autoLayoutSysML as concreteAutoLayoutSysML,
  projectSysML as concreteProjectSysML,
} from '../../sysml/sysmlProjection';
import {
  extractExecutionTargets as concreteExtractExecutionTargets,
  runExecutionTarget as concreteRunExecutionTarget,
  SYSML_EXECUTION_CONFORMANCE_VERSION,
} from '../../sysml/sysmlExecution';
import {
  appendEvidence as concreteAppendEvidence,
  makeEvidenceId as concreteMakeEvidenceId,
  parseEvidence as concreteParseEvidence,
  serializeEvidence as concreteSerializeEvidence,
} from '../../sysml/sysmlEvidence';
import {
  autoLayoutChunkedWithElk as concreteAutoLayoutChunkedWithElk,
  autoLayoutWithElk as concreteAutoLayoutWithElk,
} from '../../sysml/sysmlAutoLayoutElk';
import { buildLinkedSysMLModel as concreteBuildLinkedSysMLModel } from '../../sysml/sysmlLinkedModel';
import {
  addRelationStatement as concreteAddRelationStatement,
  insertElement as concreteInsertElement,
  renameElement as concreteRenameElement,
} from '../../sysml/sysmlEdits';
import {
  definitionAt as concreteDefinitionAt,
  referencesOf as concreteReferencesOf,
} from '../../sysml/sysmlLanguage';
import { lowerStateMachine as concreteLowerStateMachine } from '../../sysml/sysmlLowering';
import {
  buildSysMLProjectIndex as concreteBuildSysMLProjectIndex,
  resolveInIndex as concreteResolveInIndex,
} from '../../sysml/sysmlProjectIndex';

export type { SysMLLayout, SysMLPosition, SysMLProjection } from '../../sysml/sysmlProjection';
export type { TraceStep } from '../../sysml/sysmlExecution';
export type { SysMLEvidenceRecord } from '../../sysml/sysmlEvidence';
export type { SysMLFileUnit } from '../../sysml/sysmlLinkedModel';
export type { RelationVerb } from '../../sysml/sysmlEdits';

export interface SysMLSemanticProvider {
  readonly id: string;
  readonly autoLayoutSysML: typeof concreteAutoLayoutSysML;
  readonly projectSysML: typeof concreteProjectSysML;
  readonly extractExecutionTargets: typeof concreteExtractExecutionTargets;
  readonly runExecutionTarget: typeof concreteRunExecutionTarget;
  readonly appendEvidence: typeof concreteAppendEvidence;
  readonly makeEvidenceId: typeof concreteMakeEvidenceId;
  readonly parseEvidence: typeof concreteParseEvidence;
  readonly serializeEvidence: typeof concreteSerializeEvidence;
  readonly autoLayoutChunkedWithElk: typeof concreteAutoLayoutChunkedWithElk;
  readonly autoLayoutWithElk: typeof concreteAutoLayoutWithElk;
  readonly buildLinkedSysMLModel: typeof concreteBuildLinkedSysMLModel;
  readonly addRelationStatement: typeof concreteAddRelationStatement;
  readonly insertElement: typeof concreteInsertElement;
  readonly renameElement: typeof concreteRenameElement;
  readonly definitionAt: typeof concreteDefinitionAt;
  readonly referencesOf: typeof concreteReferencesOf;
  readonly lowerStateMachine: typeof concreteLowerStateMachine;
  readonly buildSysMLProjectIndex: typeof concreteBuildSysMLProjectIndex;
  readonly resolveInIndex: typeof concreteResolveInIndex;
}

export const BUILTIN_SYSML_SEMANTIC_PROVIDER: SysMLSemanticProvider = Object.freeze({
  id: 'logicpilot-sysml',
  autoLayoutSysML: concreteAutoLayoutSysML,
  projectSysML: concreteProjectSysML,
  extractExecutionTargets: concreteExtractExecutionTargets,
  runExecutionTarget: concreteRunExecutionTarget,
  appendEvidence: concreteAppendEvidence,
  makeEvidenceId: concreteMakeEvidenceId,
  parseEvidence: concreteParseEvidence,
  serializeEvidence: concreteSerializeEvidence,
  autoLayoutChunkedWithElk: concreteAutoLayoutChunkedWithElk,
  autoLayoutWithElk: concreteAutoLayoutWithElk,
  buildLinkedSysMLModel: concreteBuildLinkedSysMLModel,
  addRelationStatement: concreteAddRelationStatement,
  insertElement: concreteInsertElement,
  renameElement: concreteRenameElement,
  definitionAt: concreteDefinitionAt,
  referencesOf: concreteReferencesOf,
  lowerStateMachine: concreteLowerStateMachine,
  buildSysMLProjectIndex: concreteBuildSysMLProjectIndex,
  resolveInIndex: concreteResolveInIndex,
});

const providers = new Map<string, SysMLSemanticProvider>();
let fallbackEnabled = true;

export function registerSysMLSemanticProvider(provider: SysMLSemanticProvider): () => void {
  if (providers.has(provider.id))
    throw new Error(`SysML semantic provider '${provider.id}' already exists`);
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

export function setSysMLSemanticFallbackEnabled(enabled: boolean): void {
  fallbackEnabled = enabled;
}

export function sysmlSemanticProviders(): readonly SysMLSemanticProvider[] {
  if (providers.size > 0) return [...providers.values()];
  return fallbackEnabled ? [BUILTIN_SYSML_SEMANTIC_PROVIDER] : [];
}

function activeProvider(): SysMLSemanticProvider {
  const provider = sysmlSemanticProviders()[0];
  if (!provider) throw new Error('SysML semantic provider is not active');
  return provider;
}

export const autoLayoutSysML: typeof concreteAutoLayoutSysML = (...args) =>
  activeProvider().autoLayoutSysML(...args);
export const projectSysML: typeof concreteProjectSysML = (...args) =>
  activeProvider().projectSysML(...args);
export const extractExecutionTargets: typeof concreteExtractExecutionTargets = (...args) =>
  activeProvider().extractExecutionTargets(...args);
export const runExecutionTarget: typeof concreteRunExecutionTarget = (...args) =>
  activeProvider().runExecutionTarget(...args);
export const appendEvidence: typeof concreteAppendEvidence = (...args) =>
  activeProvider().appendEvidence(...args);
export const makeEvidenceId: typeof concreteMakeEvidenceId = (...args) =>
  activeProvider().makeEvidenceId(...args);
export const parseEvidence: typeof concreteParseEvidence = (...args) =>
  activeProvider().parseEvidence(...args);
export const serializeEvidence: typeof concreteSerializeEvidence = (...args) =>
  activeProvider().serializeEvidence(...args);
export const autoLayoutChunkedWithElk: typeof concreteAutoLayoutChunkedWithElk = (...args) =>
  activeProvider().autoLayoutChunkedWithElk(...args);
export const autoLayoutWithElk: typeof concreteAutoLayoutWithElk = (...args) =>
  activeProvider().autoLayoutWithElk(...args);
export const buildLinkedSysMLModel: typeof concreteBuildLinkedSysMLModel = (...args) =>
  activeProvider().buildLinkedSysMLModel(...args);
export const addRelationStatement: typeof concreteAddRelationStatement = (...args) =>
  activeProvider().addRelationStatement(...args);
export const insertElement: typeof concreteInsertElement = (...args) =>
  activeProvider().insertElement(...args);
export const renameElement: typeof concreteRenameElement = (...args) =>
  activeProvider().renameElement(...args);
export const definitionAt: typeof concreteDefinitionAt = (...args) =>
  activeProvider().definitionAt(...args);
export const referencesOf: typeof concreteReferencesOf = (...args) =>
  activeProvider().referencesOf(...args);
export const lowerStateMachine: typeof concreteLowerStateMachine = (...args) =>
  activeProvider().lowerStateMachine(...args);
export const buildSysMLProjectIndex: typeof concreteBuildSysMLProjectIndex = (...args) =>
  activeProvider().buildSysMLProjectIndex(...args);
export const resolveInIndex: typeof concreteResolveInIndex = (...args) =>
  activeProvider().resolveInIndex(...args);

export { SYSML_EXECUTION_CONFORMANCE_VERSION };

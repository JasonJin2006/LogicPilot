// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs
// Source of truth: schemas/contracts/*.schema.json (Phase 1 contract freeze).

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

// --- AgentEngineId (agent-engine.schema.json) ---
export type AgentEngineId = string;

// --- ToolDescriptor (agent-engine.schema.json) ---
export interface ToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonSchemaFragment;
  readonly requiredPermission?: PermissionId;
  readonly scope?: string;
}

// --- ToolCall (agent-engine.schema.json) ---
export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
}

// --- ToolResult (agent-engine.schema.json) ---
export interface ToolResult {
  readonly callId: string;
  readonly ok: boolean;
  readonly content: JsonValue;
  readonly error?: string;
}

// --- AgentStepRequest (agent-engine.schema.json) ---
export interface AgentStepRequest {
  readonly schema: "logicpilot.agent-step-request/v1";
  readonly contractVersion: 1;
  readonly turnId: string;
  readonly engineId: AgentEngineId;
  readonly stepIndex: number;
  readonly input: JsonValue;
  readonly tools: ReadonlyArray<ToolDescriptor>;
  readonly compiledContext?: JsonValue;
  readonly maxTokens?: number;
}

// --- StepStatus (agent-engine.schema.json) ---
export type StepStatus = "continue" | "done" | "cancelled" | "failed";

// --- AgentUsage (agent-engine.schema.json) ---
export interface AgentUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
}

// --- AgentCheckpoint (agent-engine.schema.json) ---
export interface AgentCheckpoint {
  readonly schema: "logicpilot.agent-checkpoint/v1";
  readonly contractVersion: 1;
  readonly turnId: string;
  readonly engineId: AgentEngineId;
  readonly revision: number;
  readonly state: JsonValue;
  readonly createdAt?: Iso8601Timestamp;
}

// --- AgentStepResult (agent-engine.schema.json) ---
export interface AgentStepResult {
  readonly schema: "logicpilot.agent-step-result/v1";
  readonly contractVersion: 1;
  readonly turnId: string;
  readonly engineId: AgentEngineId;
  readonly stepIndex: number;
  readonly status: StepStatus;
  readonly message?: JsonValue;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolResults: ReadonlyArray<ToolResult>;
  readonly usage?: AgentUsage;
  readonly checkpoint?: AgentCheckpoint;
  readonly error?: string;
}

// --- AgentEngineDescriptor (agent-engine.schema.json) ---
export interface AgentEngineDescriptor {
  readonly schema: "logicpilot.agent-engine-descriptor/v1";
  readonly contractVersion: 1;
  readonly id: AgentEngineId;
  readonly implementation: "builtin" | "openai-agents";
  readonly config?: JsonValue;
}

// --- ArtifactKind (artifact-graph.schema.json) ---
export type ArtifactKind = "semantic-model" | "source-document" | "view-layout" | "knowledge-pack" | "plugin-draft" | "execution-target" | "experiment" | "run" | "evidence" | "diagnostic-set" | "migration-record";

// --- ArtifactId (artifact-graph.schema.json) ---
export type ArtifactId = string;

// --- RevisionId (artifact-graph.schema.json) ---
export type RevisionId = string;

// --- ArtifactRef (artifact-graph.schema.json) ---
export interface ArtifactRef {
  readonly artifactId: ArtifactId;
  readonly revisionId?: RevisionId;
}

// --- Artifact (artifact-graph.schema.json) ---
export interface Artifact {
  readonly schema: "logicpilot.artifact/v1";
  readonly contractVersion: 1;
  readonly id: ArtifactId;
  readonly kind: ArtifactKind;
  readonly projectId?: string;
  readonly createdAt: Iso8601Timestamp;
  readonly createdBy: Actor;
  readonly metadata?: { readonly [key: string]: string };
}

// --- TypedOperation (artifact-graph.schema.json) ---
export interface TypedOperation {
  readonly opId: string;
  readonly opType: string;
  readonly target?: string;
  readonly payload: JsonValue;
}

// --- Revision (artifact-graph.schema.json) ---
export interface Revision {
  readonly schema: "logicpilot.revision/v1";
  readonly contractVersion: 1;
  readonly id: RevisionId;
  readonly artifactId: ArtifactId;
  readonly parentRevisionId?: RevisionId;
  readonly createdAt: Iso8601Timestamp;
  readonly createdBy: Actor;
  readonly operations: ReadonlyArray<TypedOperation>;
  readonly digest: Sha256Hex;
}

// --- RelationKind (artifact-graph.schema.json) ---
export type RelationKind = "projects" | "executes" | "validates" | "produced-by" | "applies-to" | "provides" | "derives-from" | "supersedes";

// --- Relation (artifact-graph.schema.json) ---
export interface Relation {
  readonly schema: "logicpilot.relation/v1";
  readonly contractVersion: 1;
  readonly id: string;
  readonly kind: RelationKind;
  readonly from: ArtifactRef;
  readonly to: ArtifactRef;
  readonly metadata?: { readonly [key: string]: string };
}

// --- TransactionStatus (artifact-graph.schema.json) ---
export type TransactionStatus = "proposed" | "validated" | "awaiting-approval" | "committed" | "rejected" | "rolled-back";

// --- Transaction (artifact-graph.schema.json) ---
export interface Transaction {
  readonly schema: "logicpilot.transaction/v1";
  readonly contractVersion: 1;
  readonly id: string;
  readonly status: TransactionStatus;
  readonly proposedBy: Actor;
  readonly approvedBy?: Actor;
  readonly artifactRefs: ReadonlyArray<ArtifactRef>;
  readonly operations: ReadonlyArray<TypedOperation>;
  readonly committedRevisionId?: RevisionId;
  readonly createdAt?: Iso8601Timestamp;
  readonly resolutionRecord?: string;
}

// --- PluginId (common.schema.json) ---
export type PluginId = string;

// --- CapabilityId (common.schema.json) ---
export type CapabilityId = string;

// --- SemanticVersion (common.schema.json) ---
export type SemanticVersion = string;

// --- VersionRange (common.schema.json) ---
export type VersionRange = string;

// --- Sha256Hex (common.schema.json) ---
export type Sha256Hex = string;

// --- Iso8601Timestamp (common.schema.json) ---
export type Iso8601Timestamp = string;

// --- LocalizedKey (common.schema.json) ---
export type LocalizedKey = string;

// --- Actor (common.schema.json) ---
export type Actor = string;

// --- Provenance (common.schema.json) ---
export interface Provenance {
  readonly source: string;
  readonly reference?: string;
  readonly locator?: string;
  readonly confidence?: number;
}

// --- JsonSchemaFragment (common.schema.json) ---
export type JsonSchemaFragment = JsonValue;

// --- DiagnosticId (diagnostic.schema.json) ---
export type DiagnosticId = string;

// --- Severity (diagnostic.schema.json) ---
export type Severity = "info" | "warning" | "error" | "fatal";

// --- DiagnosticDefinition (diagnostic.schema.json) ---
export interface DiagnosticDefinition {
  readonly schema: "logicpilot.diagnostic-definition/v1";
  readonly contractVersion: 1;
  readonly id: DiagnosticId;
  readonly pluginId: PluginId;
  readonly constraintId?: string;
  readonly titleKey: LocalizedKey;
  readonly parameterSchema?: JsonSchemaFragment;
  readonly defaultSeverity: Severity;
  readonly explanationBlockId?: string;
  readonly fixIds: ReadonlyArray<FixId>;
  readonly appliesToParadigms?: ReadonlyArray<CapabilityId>;
  readonly minPluginVersion?: SemanticVersion;
  readonly conformanceCases?: ReadonlyArray<string>;
}

// --- FixId (diagnostic.schema.json) ---
export type FixId = string;

// --- FixKind (diagnostic.schema.json) ---
export type FixKind = "manual" | "assisted" | "automated";

// --- FixDefinition (diagnostic.schema.json) ---
export interface FixDefinition {
  readonly schema: "logicpilot.fix-definition/v1";
  readonly contractVersion: 1;
  readonly id: FixId;
  readonly definitionId: DiagnosticId;
  readonly kind: FixKind;
  readonly titleKey: LocalizedKey;
  readonly parameters?: JsonSchemaFragment;
  readonly recipe?: JsonValue;
}

// --- SourceSpan (diagnostic.schema.json) ---
export interface SourceSpan {
  readonly startLine: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

// --- DiagnosticInstance (diagnostic.schema.json) ---
export interface DiagnosticInstance {
  readonly schema: "logicpilot.diagnostic-instance/v1";
  readonly contractVersion: 1;
  readonly definitionId: DiagnosticId;
  readonly artifactRef: ArtifactRef;
  readonly elementId?: string;
  readonly sourceSpan?: SourceSpan;
  readonly parameterBindings?: JsonValue;
  readonly evidenceRefs?: ReadonlyArray<string>;
  readonly phase?: string;
  readonly severity?: Severity;
  readonly availableFixIds?: ReadonlyArray<FixId>;
}

// --- RuntimeKind (execution-target.schema.json) ---
export type RuntimeKind = "interpreter" | "wasm" | "native" | "external";

// --- RuntimeRef (execution-target.schema.json) ---
export interface RuntimeRef {
  readonly kind: RuntimeKind;
  readonly pluginId?: PluginId;
  readonly capability?: CapabilityId;
}

// --- ExecutionTarget (execution-target.schema.json) ---
export interface ExecutionTarget {
  readonly schema: "logicpilot.execution-target/v1";
  readonly contractVersion: 1;
  readonly id: CapabilityId;
  readonly titleKey?: LocalizedKey;
  readonly artifactRef: ArtifactRef;
  readonly runtime: RuntimeRef;
  readonly options?: JsonValue;
}

// --- ExecutionBudget (execution-target.schema.json) ---
export interface ExecutionBudget {
  readonly maxSteps?: number;
  readonly maxWallMs?: number;
}

// --- ExecutionRequest (execution-target.schema.json) ---
export interface ExecutionRequest {
  readonly schema: "logicpilot.execution-request/v1";
  readonly contractVersion: 1;
  readonly requestId: string;
  readonly targetId: CapabilityId;
  readonly seed?: number;
  readonly inputs?: JsonValue;
  readonly budget?: ExecutionBudget;
}

// --- RunStatus (execution-target.schema.json) ---
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// --- ExecutionRun (execution-target.schema.json) ---
export interface ExecutionRun {
  readonly schema: "logicpilot.execution-run/v1";
  readonly contractVersion: 1;
  readonly runId: string;
  readonly requestId: string;
  readonly targetId: CapabilityId;
  readonly artifactRef: ArtifactRef;
  readonly status: RunStatus;
  readonly seed?: number;
  readonly evidenceRef?: ArtifactRef;
  readonly startedAt?: Iso8601Timestamp;
  readonly finishedAt?: Iso8601Timestamp;
  readonly error?: string;
}

// --- ExecutionEvidence (execution-target.schema.json) ---
export interface ExecutionEvidence {
  readonly schema: "logicpilot.execution-evidence/v1";
  readonly contractVersion: 1;
  readonly runId: string;
  readonly digest: Sha256Hex;
  readonly traceRef?: ArtifactRef;
  readonly metrics?: { readonly [key: string]: number };
}

// --- KnowledgeBlockType (knowledge-block.schema.json) ---
export type KnowledgeBlockType = "concept" | "term" | "relation" | "constraint" | "formula" | "diagnostic" | "fix" | "workflow" | "instruction" | "example" | "counterexample" | "evidence" | "visual-template" | "transformation" | "conformance-case";

// --- KnowledgeBlockId (knowledge-block.schema.json) ---
export type KnowledgeBlockId = string;

// --- KnowledgeBlockRef (knowledge-block.schema.json) ---
export interface KnowledgeBlockRef {
  readonly id: KnowledgeBlockId;
  readonly version?: SemanticVersion;
}

// --- KnowledgeScope (knowledge-block.schema.json) ---
export interface KnowledgeScope {
  readonly paradigms?: ReadonlyArray<CapabilityId>;
  readonly domains?: ReadonlyArray<CapabilityId>;
}

// --- VerificationMethod (knowledge-block.schema.json) ---
export type VerificationMethod = "none" | "unit-test" | "conformance-case" | "human-review";

// --- KnowledgeVerification (knowledge-block.schema.json) ---
export interface KnowledgeVerification {
  readonly method: VerificationMethod;
  readonly cases?: ReadonlyArray<string>;
}

// --- KnowledgeStatus (knowledge-block.schema.json) ---
export type KnowledgeStatus = "draft" | "reviewed" | "trusted" | "deprecated";

// --- SymbolDef (knowledge-block.schema.json) ---
export interface SymbolDef {
  readonly name: string;
  readonly type?: string;
  readonly unit?: string;
  readonly descriptionKey?: LocalizedKey;
}

// --- FormulaContent (knowledge-block.schema.json) ---
export interface FormulaContent {
  readonly expressionAst: JsonValue;
  readonly symbolTable?: { readonly [key: string]: SymbolDef };
  readonly assumptions?: ReadonlyArray<string>;
  readonly validDomain?: JsonValue;
  readonly initialConditions?: JsonValue;
  readonly boundaryConditions?: JsonValue;
  readonly recommendedSolver?: string;
  readonly sourceEquation?: string;
}

// --- KnowledgeBlock (knowledge-block.schema.json) ---
export interface KnowledgeBlock {
  readonly schema: "logicpilot.knowledge-block/v1";
  readonly contractVersion: 1;
  readonly id: KnowledgeBlockId;
  readonly version: SemanticVersion;
  readonly owner: PluginId;
  readonly type: KnowledgeBlockType;
  readonly classification: "public" | "organization" | "workspace" | "plugin";
  readonly status: KnowledgeStatus;
  readonly scope?: KnowledgeScope;
  readonly applicability?: JsonValue;
  readonly dependencies?: ReadonlyArray<KnowledgeBlockRef>;
  readonly conflicts?: ReadonlyArray<KnowledgeBlockRef>;
  readonly supersedes?: ReadonlyArray<KnowledgeBlockRef>;
  readonly provenance: Provenance;
  readonly confidence?: number;
  readonly verification?: KnowledgeVerification;
  readonly localization?: { readonly [key: string]: string };
  readonly content?: JsonValue;
  readonly formula?: FormulaContent;
}

// --- KnowledgePack (knowledge-block.schema.json) ---
export interface KnowledgePack {
  readonly schema: "logicpilot.knowledge-pack/v1";
  readonly contractVersion: 1;
  readonly id: CapabilityId;
  readonly version: SemanticVersion;
  readonly owner: PluginId;
  readonly blocks: ReadonlyArray<KnowledgeBlock>;
  readonly digest: Sha256Hex;
}

// --- PermissionId (permission-trust.schema.json) ---
export type PermissionId = "knowledge.draft.write" | "skill.draft.write" | "instruction.draft.write" | "view.draft.write" | "notation.draft.write" | "theme.draft.write" | "validator.draft.write" | "runtime.wasm.build" | "runtime.native.build" | "plugin.install" | "plugin.upgrade" | "plugin.publish";

// --- TrustLevel (permission-trust.schema.json) ---
export type TrustLevel = "t0" | "t1" | "t2" | "t3" | "t4" | "t5";

// --- SandboxKind (permission-trust.schema.json) ---
export type SandboxKind = "none" | "wasm" | "worker" | "iframe";

// --- TrustRequirement (permission-trust.schema.json) ---
export interface TrustRequirement {
  readonly minLevel: TrustLevel;
  readonly sandbox?: SandboxKind;
  readonly requireSignature?: boolean;
  readonly requireReview?: boolean;
}

// --- PermissionGrant (permission-trust.schema.json) ---
export interface PermissionGrant {
  readonly permissionId: PermissionId;
  readonly granted: boolean;
  readonly scope?: string;
  readonly grantedBy?: Actor;
  readonly grantedAt?: Iso8601Timestamp;
}

// --- TrustPolicy (permission-trust.schema.json) ---
export interface TrustPolicy {
  readonly schema: "logicpilot.trust-policy/v1";
  readonly contractVersion: 1;
  readonly defaultLevel: TrustLevel;
  readonly grants: ReadonlyArray<PermissionGrant>;
  readonly overrides?: { readonly [key: string]: TrustLevel };
}

// --- PluginManifest (plugin-manifest-v2.schema.json) ---
export interface PluginManifest {
  readonly schema: "logicpilot.plugin-manifest/v2";
  readonly contractVersion: 1;
  readonly id: PluginId;
  readonly version: SemanticVersion;
  readonly apiVersion: number;
  readonly displayName?: string;
  readonly description?: string;
  readonly provides: ReadonlyArray<CapabilityId>;
  readonly requires: ReadonlyArray<PluginDependency>;
  readonly entrypoints: PluginEntrypoints;
  readonly permissions: ReadonlyArray<PermissionId>;
  readonly trust: TrustRequirement;
  readonly config?: JsonSchemaFragment;
  readonly migrations?: ReadonlyArray<PluginMigration>;
  readonly conformance?: ReadonlyArray<string>;
  readonly integrity?: PluginIntegrity;
}

// --- PluginDependency (plugin-manifest-v2.schema.json) ---
export interface PluginDependency {
  readonly id: PluginId;
  readonly range?: VersionRange;
  readonly optional?: boolean;
}

// --- PluginEntrypoints (plugin-manifest-v2.schema.json) ---
export interface PluginEntrypoints {
  readonly web?: string;
  readonly node?: string;
  readonly wasm?: string;
  readonly native?: string;
  readonly data?: string;
}

// --- PluginMigration (plugin-manifest-v2.schema.json) ---
export interface PluginMigration {
  readonly fromVersion: SemanticVersion;
  readonly toVersion: SemanticVersion;
  readonly script?: string;
}

// --- PluginIntegrity (plugin-manifest-v2.schema.json) ---
export interface PluginIntegrity {
  readonly sha256: Sha256Hex;
  readonly signature?: string;
  readonly signedBy?: string;
}

// --- PluginLockEntry (plugin-manifest-v2.schema.json) ---
export interface PluginLockEntry {
  readonly id: PluginId;
  readonly version: SemanticVersion;
  readonly apiVersion: number;
  readonly sha256: Sha256Hex;
  readonly source?: string;
  readonly trust: TrustLevel;
  readonly permissions: ReadonlyArray<PermissionGrant>;
  readonly dependencies?: ReadonlyArray<PluginDependency>;
}

// --- PluginLockfile (plugin-manifest-v2.schema.json) ---
export interface PluginLockfile {
  readonly schema: "logicpilot.plugin-lock/v1";
  readonly contractVersion: 1;
  readonly plugins: ReadonlyArray<PluginLockEntry>;
}

// --- CanvasEngineId (view-notation.schema.json) ---
export type CanvasEngineId = "graph2d" | "scene2d" | "scene3d" | "timeline" | "table" | "chart" | "text";

// --- LayoutPersistence (view-notation.schema.json) ---
export type LayoutPersistence = "none" | "sidecar" | "artifact";

// --- ViewQuery (view-notation.schema.json) ---
export interface ViewQuery {
  readonly artifactKinds: ReadonlyArray<ArtifactKind>;
  readonly relationKinds?: ReadonlyArray<RelationKind>;
  readonly filter?: JsonValue;
}

// --- ViewDefinition (view-notation.schema.json) ---
export interface ViewDefinition {
  readonly schema: "logicpilot.view-definition/v1";
  readonly contractVersion: 1;
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly titleKey: LocalizedKey;
  readonly canvas: CanvasEngineId;
  readonly query: ViewQuery;
  readonly projection?: JsonValue;
  readonly interactions: ReadonlyArray<string>;
  readonly supportsInverseEdit: boolean;
  readonly layoutPersistence: LayoutPersistence;
  readonly requiredContributions?: ViewContributions;
}

// --- ViewContributions (view-notation.schema.json) ---
export interface ViewContributions {
  readonly notations?: ReadonlyArray<CapabilityId>;
  readonly domains?: ReadonlyArray<CapabilityId>;
}

// --- GlyphMapping (view-notation.schema.json) ---
export interface GlyphMapping {
  readonly semanticKind: string;
  readonly glyph: string;
  readonly compartments?: ReadonlyArray<string>;
}

// --- EdgeMapping (view-notation.schema.json) ---
export interface EdgeMapping {
  readonly relationKind: string;
  readonly edgeStyle: string;
  readonly directed?: boolean;
}

// --- PortRule (view-notation.schema.json) ---
export interface PortRule {
  readonly portKind: string;
  readonly connectableTo: ReadonlyArray<string>;
}

// --- NotationPack (view-notation.schema.json) ---
export interface NotationPack {
  readonly schema: "logicpilot.notation-pack/v1";
  readonly contractVersion: 1;
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly glyphs: ReadonlyArray<GlyphMapping>;
  readonly edges: ReadonlyArray<EdgeMapping>;
  readonly ports?: ReadonlyArray<PortRule>;
  readonly propertyEditor?: CapabilityId;
  readonly layoutHints?: JsonValue;
  readonly createActions: ReadonlyArray<CreateActionRef>;
}

// --- CreateActionRef (view-notation.schema.json) ---
export interface CreateActionRef {
  readonly id: CapabilityId;
  readonly order?: number;
}

// --- CreateAction (view-notation.schema.json) ---
export interface CreateAction {
  readonly schema: "logicpilot.create-action/v1";
  readonly contractVersion: 1;
  readonly id: CapabilityId;
  readonly owner: PluginId;
  readonly titleKey: LocalizedKey;
  readonly icon?: string;
  readonly notationId: CapabilityId;
  readonly targetSemanticKind: string;
  readonly order?: number;
}


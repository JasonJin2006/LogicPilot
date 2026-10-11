// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs
// Source of truth: schemas/contracts/*.schema.json (Phase 1 contract freeze).
// Parsing is strict: unknown fields are rejected and const/version fields are
// enforced. Full JSON Schema validation (patterns, bounds) runs on the TS side.
#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace logicpilot::contracts {

// Any JSON value; used for opaque structured payloads.
using JsonValue = nlohmann::ordered_json;

enum class StepStatus : std::uint8_t {
  kContinue,
  kDone,
  kCancelled,
  kFailed,
};

[[nodiscard]] std::string dump(StepStatus value);
[[nodiscard]] bool parse(std::string_view text, StepStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(StepStatus value);

enum class ArtifactKind : std::uint8_t {
  kSemanticModel,
  kSourceDocument,
  kViewLayout,
  kKnowledgePack,
  kPluginDraft,
  kExecutionTarget,
  kExperiment,
  kRun,
  kEvidence,
  kDiagnosticSet,
  kMigrationRecord,
};

[[nodiscard]] std::string dump(ArtifactKind value);
[[nodiscard]] bool parse(std::string_view text, ArtifactKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(ArtifactKind value);

enum class RelationKind : std::uint8_t {
  kProjects,
  kExecutes,
  kValidates,
  kProducedBy,
  kAppliesTo,
  kProvides,
  kDerivesFrom,
  kSupersedes,
};

[[nodiscard]] std::string dump(RelationKind value);
[[nodiscard]] bool parse(std::string_view text, RelationKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(RelationKind value);

enum class TransactionStatus : std::uint8_t {
  kProposed,
  kValidated,
  kAwaitingApproval,
  kCommitted,
  kRejected,
  kRolledBack,
};

[[nodiscard]] std::string dump(TransactionStatus value);
[[nodiscard]] bool parse(std::string_view text, TransactionStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(TransactionStatus value);

enum class CapabilityRpcStatus : std::uint8_t {
  kOk,
  kDenied,
  kInvalid,
  kTimeout,
  kFailed,
};

[[nodiscard]] std::string dump(CapabilityRpcStatus value);
[[nodiscard]] bool parse(std::string_view text, CapabilityRpcStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(CapabilityRpcStatus value);

enum class Severity : std::uint8_t {
  kInfo,
  kWarning,
  kError,
  kFatal,
};

[[nodiscard]] std::string dump(Severity value);
[[nodiscard]] bool parse(std::string_view text, Severity& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(Severity value);

enum class FixKind : std::uint8_t {
  kManual,
  kAssisted,
  kAutomated,
};

[[nodiscard]] std::string dump(FixKind value);
[[nodiscard]] bool parse(std::string_view text, FixKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(FixKind value);

enum class ExecutionSessionState : std::uint8_t {
  kQueued,
  kPreparing,
  kRunning,
  kPaused,
  kFinalizing,
  kCompleted,
  kCancelling,
  kCancelled,
  kFailed,
};

[[nodiscard]] std::string dump(ExecutionSessionState value);
[[nodiscard]] bool parse(std::string_view text, ExecutionSessionState& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(ExecutionSessionState value);

enum class ExecutionCommandAction : std::uint8_t {
  kPause,
  kResume,
  kStep,
  kStop,
  kCancel,
};

[[nodiscard]] std::string dump(ExecutionCommandAction value);
[[nodiscard]] bool parse(std::string_view text, ExecutionCommandAction& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(ExecutionCommandAction value);

enum class ExecutionEventKind : std::uint8_t {
  kSnapshot,
  kState,
  kTelemetry,
  kDiagnostic,
  kGap,
  kTerminal,
};

[[nodiscard]] std::string dump(ExecutionEventKind value);
[[nodiscard]] bool parse(std::string_view text, ExecutionEventKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(ExecutionEventKind value);

enum class RuntimeKind : std::uint8_t {
  kInterpreter,
  kWasm,
  kNative,
  kExternal,
};

[[nodiscard]] std::string dump(RuntimeKind value);
[[nodiscard]] bool parse(std::string_view text, RuntimeKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(RuntimeKind value);

enum class RunStatus : std::uint8_t {
  kPending,
  kRunning,
  kCompleted,
  kFailed,
  kCancelled,
};

[[nodiscard]] std::string dump(RunStatus value);
[[nodiscard]] bool parse(std::string_view text, RunStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(RunStatus value);

enum class KnowledgeBlockType : std::uint8_t {
  kConcept,
  kTerm,
  kRelation,
  kConstraint,
  kFormula,
  kDiagnostic,
  kFix,
  kWorkflow,
  kInstruction,
  kExample,
  kCounterexample,
  kEvidence,
  kVisualTemplate,
  kTransformation,
  kConformanceCase,
};

[[nodiscard]] std::string dump(KnowledgeBlockType value);
[[nodiscard]] bool parse(std::string_view text, KnowledgeBlockType& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(KnowledgeBlockType value);

enum class VerificationMethod : std::uint8_t {
  kNone,
  kUnitTest,
  kConformanceCase,
  kHumanReview,
};

[[nodiscard]] std::string dump(VerificationMethod value);
[[nodiscard]] bool parse(std::string_view text, VerificationMethod& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(VerificationMethod value);

enum class KnowledgeStatus : std::uint8_t {
  kDraft,
  kReviewed,
  kTrusted,
  kDeprecated,
};

[[nodiscard]] std::string dump(KnowledgeStatus value);
[[nodiscard]] bool parse(std::string_view text, KnowledgeStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(KnowledgeStatus value);

enum class PermissionId : std::uint8_t {
  kKnowledgeDraftWrite,
  kSkillDraftWrite,
  kInstructionDraftWrite,
  kViewDraftWrite,
  kNotationDraftWrite,
  kThemeDraftWrite,
  kValidatorDraftWrite,
  kRuntimeWasmBuild,
  kRuntimeLogWrite,
  kRuntimeRandomRead,
  kRuntimeClockRead,
  kRuntimeEventEmit,
  kRuntimeEventSubscribe,
  kRuntimeServiceProvide,
  kRuntimeServiceCall,
  kRuntimeStorageRead,
  kRuntimeStorageWrite,
  kRuntimeNetworkFetch,
  kRuntimeNativeBuild,
  kPluginInstall,
  kPluginUpgrade,
  kPluginPublish,
};

[[nodiscard]] std::string dump(PermissionId value);
[[nodiscard]] bool parse(std::string_view text, PermissionId& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PermissionId value);

enum class TrustLevel : std::uint8_t {
  kT0,
  kT1,
  kT2,
  kT3,
  kT4,
  kT5,
};

[[nodiscard]] std::string dump(TrustLevel value);
[[nodiscard]] bool parse(std::string_view text, TrustLevel& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(TrustLevel value);

enum class SandboxKind : std::uint8_t {
  kNone,
  kWasm,
  kWorker,
  kIframe,
};

[[nodiscard]] std::string dump(SandboxKind value);
[[nodiscard]] bool parse(std::string_view text, SandboxKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(SandboxKind value);

enum class PluginScope : std::uint8_t {
  kSystem,
  kUser,
  kWorkspace,
};

[[nodiscard]] std::string dump(PluginScope value);
[[nodiscard]] bool parse(std::string_view text, PluginScope& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PluginScope value);

enum class PluginCatalogSeverity : std::uint8_t {
  kError,
  kWarning,
};

[[nodiscard]] std::string dump(PluginCatalogSeverity value);
[[nodiscard]] bool parse(std::string_view text, PluginCatalogSeverity& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PluginCatalogSeverity value);

enum class PluginCatalogDiagnosticKind : std::uint8_t {
  kJson,
  kSchema,
  kFilesystem,
  kApiVersion,
  kHashDrift,
  kDuplicateId,
  kDependency,
  kLoadable,
  kTransport,
};

[[nodiscard]] std::string dump(PluginCatalogDiagnosticKind value);
[[nodiscard]] bool parse(std::string_view text, PluginCatalogDiagnosticKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PluginCatalogDiagnosticKind value);

enum class PluginContributionKind : std::uint8_t {
  kKnowledge,
  kSkill,
  kInstruction,
  kDiagnostic,
  kView,
  kPalette,
  kTool,
};

[[nodiscard]] std::string dump(PluginContributionKind value);
[[nodiscard]] bool parse(std::string_view text, PluginContributionKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PluginContributionKind value);

enum class RunParameterKind : std::uint8_t {
  kInteger,
  kNumber,
  kText,
  kBoolean,
};

[[nodiscard]] std::string dump(RunParameterKind value);
[[nodiscard]] bool parse(std::string_view text, RunParameterKind& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(RunParameterKind value);

enum class RunParameterOwner : std::uint8_t {
  kModel,
  kRun,
};

[[nodiscard]] std::string dump(RunParameterOwner value);
[[nodiscard]] bool parse(std::string_view text, RunParameterOwner& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(RunParameterOwner value);

enum class PluginDraftStatus : std::uint8_t {
  kDraft,
  kValidated,
  kApproved,
  kRejected,
  kPublished,
};

[[nodiscard]] std::string dump(PluginDraftStatus value);
[[nodiscard]] bool parse(std::string_view text, PluginDraftStatus& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(PluginDraftStatus value);

enum class CanvasEngineId : std::uint8_t {
  kGraph2d,
  kScene2d,
  kScene3d,
  kTimeline,
  kTable,
  kChart,
  kText,
  kFlow,
  kStatechart,
  kSequence,
  kStockFlow,
  kCausalLoop,
};

[[nodiscard]] std::string dump(CanvasEngineId value);
[[nodiscard]] bool parse(std::string_view text, CanvasEngineId& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(CanvasEngineId value);

enum class LayoutPersistence : std::uint8_t {
  kNone,
  kSidecar,
  kArtifact,
};

[[nodiscard]] std::string dump(LayoutPersistence value);
[[nodiscard]] bool parse(std::string_view text, LayoutPersistence& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(LayoutPersistence value);

enum class WasmAbiValueType : std::uint8_t {
  kI32,
  kI64,
  kF32,
  kF64,
  kString,
  kBytes,
  kVoid,
};

[[nodiscard]] std::string dump(WasmAbiValueType value);
[[nodiscard]] bool parse(std::string_view text, WasmAbiValueType& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(WasmAbiValueType value);

using AgentEngineId = std::string;
using ArtifactId = std::string;
using RevisionId = std::string;
using PluginId = std::string;
using CapabilityId = std::string;
using SemanticVersion = std::string;
using VersionRange = std::string;
using Sha256Hex = std::string;
using Iso8601Timestamp = std::string;
using LocalizedKey = std::string;
using Actor = std::string;
using JsonSchemaFragment = JsonValue;
using DiagnosticId = std::string;
using FixId = std::string;
using MethodId = std::string;
using KnowledgeBlockId = std::string;
using PluginCatalogRootId = std::string;
using PluginCatalogPath = std::string;

struct ToolDescriptor;
struct ToolCall;
struct ToolResult;
struct AgentStepRequest;
struct AgentUsage;
struct AgentCheckpoint;
struct AgentPlanStep;
struct AgentStepResult;
struct AgentEngineDescriptor;
struct ArtifactRef;
struct Artifact;
struct TypedOperation;
struct Revision;
struct Relation;
struct Transaction;
struct CapabilityRpcEnvelope;
struct CapabilityRpcResponse;
struct Provenance;
struct DiagnosticDefinition;
struct FixDefinition;
struct SourceSpan;
struct DiagnosticInstance;
struct ExecutionProviderCapabilities;
struct ExecutionSession;
struct ExecutionCommand;
struct ExecutionCommandAck;
struct ExecutionEvent;
struct ExecutionConformance;
struct ExecutionEvidenceDetails;
struct RuntimeRef;
struct ExecutionTarget;
struct ExecutionBudget;
struct ExecutionRequest;
struct ExecutionRun;
struct ExecutionEvidence;
struct KnowledgeBlockRef;
struct KnowledgeScope;
struct KnowledgeVerification;
struct SymbolDef;
struct FormulaContent;
struct KnowledgeBlock;
struct KnowledgePack;
struct TrustRequirement;
struct PermissionGrant;
struct TrustPolicy;
struct PluginCatalogRoot;
struct PluginCatalogEntry;
struct PluginCatalogDiagnostic;
struct PluginCatalog;
struct PluginSkillStep;
struct PluginSkillContribution;
struct PluginInstructionContribution;
struct PluginPaletteContribution;
struct PluginToolContribution;
struct PluginRunParameterContribution;
struct RunParameterChoice;
struct PluginContributionSet;
struct PermissionDiff;
struct PluginDraft;
struct PluginManifest;
struct PluginDependency;
struct PluginEntrypoints;
struct PluginMigration;
struct PluginIntegrity;
struct PluginLockEntry;
struct PluginLockfile;
struct PluginRegistryIntegrity;
struct PluginRegistry;
struct PluginRuntimeSession;
struct PluginServiceMethod;
struct PluginService;
struct ViewQuery;
struct ViewDefinition;
struct ViewContributions;
struct GlyphMapping;
struct EdgeMapping;
struct PortRule;
struct NotationPack;
struct CreateActionRef;
struct CreateAction;
struct WasmHostImport;
struct WasmHostAbi;

// agent-engine.schema.json
struct AgentCheckpoint {
  std::string schema;
  std::int64_t contract_version;
  std::string turn_id;
  std::string engine_id;
  std::int64_t revision;
  JsonValue state;
  std::optional<std::string> created_at;
};

[[nodiscard]] bool operator==(const AgentCheckpoint& lhs, const AgentCheckpoint& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentCheckpoint& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentCheckpoint& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentCheckpoint& value);
[[nodiscard]] std::string dump(const AgentCheckpoint& value);

// agent-engine.schema.json
struct AgentEngineDescriptor {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string implementation;
  std::optional<JsonValue> config;
};

[[nodiscard]] bool operator==(const AgentEngineDescriptor& lhs, const AgentEngineDescriptor& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentEngineDescriptor& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentEngineDescriptor& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentEngineDescriptor& value);
[[nodiscard]] std::string dump(const AgentEngineDescriptor& value);

// agent-engine.schema.json
struct AgentPlanStep {
  std::string id;
  std::string label;
};

[[nodiscard]] bool operator==(const AgentPlanStep& lhs, const AgentPlanStep& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentPlanStep& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentPlanStep& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentPlanStep& value);
[[nodiscard]] std::string dump(const AgentPlanStep& value);

// agent-engine.schema.json
struct AgentUsage {
  std::optional<std::int64_t> input_tokens;
  std::optional<std::int64_t> output_tokens;
  std::optional<std::int64_t> latency_ms;
};

[[nodiscard]] bool operator==(const AgentUsage& lhs, const AgentUsage& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentUsage& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentUsage& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentUsage& value);
[[nodiscard]] std::string dump(const AgentUsage& value);

// artifact-graph.schema.json
struct Artifact {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  ArtifactKind kind;
  std::optional<std::string> project_id;
  std::string created_at;
  std::string created_by;
  std::optional<std::map<std::string, std::string>> metadata;
};

[[nodiscard]] bool operator==(const Artifact& lhs, const Artifact& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, Artifact& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, Artifact& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const Artifact& value);
[[nodiscard]] std::string dump(const Artifact& value);

// artifact-graph.schema.json
struct ArtifactRef {
  std::string artifact_id;
  std::optional<std::string> revision_id;
};

[[nodiscard]] bool operator==(const ArtifactRef& lhs, const ArtifactRef& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ArtifactRef& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ArtifactRef& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ArtifactRef& value);
[[nodiscard]] std::string dump(const ArtifactRef& value);

// capability-rpc.schema.json
struct CapabilityRpcEnvelope {
  std::string schema;
  std::int64_t contract_version;
  std::int64_t generation;
  std::string session_id;
  std::string plugin_id;
  std::string request_id;
  std::int64_t deadline_ms;
  std::string capability;
  std::string operation;
  nlohmann::ordered_json payload;
};

[[nodiscard]] bool operator==(const CapabilityRpcEnvelope& lhs, const CapabilityRpcEnvelope& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, CapabilityRpcEnvelope& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, CapabilityRpcEnvelope& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const CapabilityRpcEnvelope& value);
[[nodiscard]] std::string dump(const CapabilityRpcEnvelope& value);

// capability-rpc.schema.json
struct CapabilityRpcResponse {
  std::string schema;
  std::int64_t contract_version;
  std::int64_t generation;
  std::string session_id;
  std::string request_id;
  CapabilityRpcStatus status;
  std::optional<std::string> error_code;
  nlohmann::ordered_json payload;
};

[[nodiscard]] bool operator==(const CapabilityRpcResponse& lhs, const CapabilityRpcResponse& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, CapabilityRpcResponse& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, CapabilityRpcResponse& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const CapabilityRpcResponse& value);
[[nodiscard]] std::string dump(const CapabilityRpcResponse& value);

// view-notation.schema.json
struct CreateAction {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string owner;
  std::string title_key;
  std::optional<std::string> icon;
  std::string notation_id;
  std::string target_semantic_kind;
  std::optional<std::int64_t> order;
};

[[nodiscard]] bool operator==(const CreateAction& lhs, const CreateAction& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, CreateAction& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, CreateAction& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const CreateAction& value);
[[nodiscard]] std::string dump(const CreateAction& value);

// view-notation.schema.json
struct CreateActionRef {
  std::string id;
  std::optional<std::int64_t> order;
};

[[nodiscard]] bool operator==(const CreateActionRef& lhs, const CreateActionRef& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, CreateActionRef& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, CreateActionRef& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const CreateActionRef& value);
[[nodiscard]] std::string dump(const CreateActionRef& value);

// diagnostic.schema.json
struct DiagnosticDefinition {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string plugin_id;
  std::optional<std::string> constraint_id;
  std::string title_key;
  std::optional<JsonSchemaFragment> parameter_schema;
  Severity default_severity;
  std::optional<std::string> explanation_block_id;
  std::vector<std::string> fix_ids;
  std::optional<std::vector<std::string>> applies_to_paradigms;
  std::optional<std::string> min_plugin_version;
  std::optional<std::vector<std::string>> conformance_cases;
};

[[nodiscard]] bool operator==(const DiagnosticDefinition& lhs, const DiagnosticDefinition& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, DiagnosticDefinition& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, DiagnosticDefinition& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const DiagnosticDefinition& value);
[[nodiscard]] std::string dump(const DiagnosticDefinition& value);

// view-notation.schema.json
struct EdgeMapping {
  std::string relation_kind;
  std::string edge_style;
  std::optional<bool> directed;
};

[[nodiscard]] bool operator==(const EdgeMapping& lhs, const EdgeMapping& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, EdgeMapping& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, EdgeMapping& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const EdgeMapping& value);
[[nodiscard]] std::string dump(const EdgeMapping& value);

// execution-target.schema.json
struct ExecutionBudget {
  std::optional<std::int64_t> max_steps;
  std::optional<std::int64_t> max_wall_ms;
};

[[nodiscard]] bool operator==(const ExecutionBudget& lhs, const ExecutionBudget& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionBudget& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionBudget& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionBudget& value);
[[nodiscard]] std::string dump(const ExecutionBudget& value);

// execution-session.schema.json
struct ExecutionCommand {
  std::string schema;
  std::int64_t contract_version;
  std::string command_id;
  std::string run_id;
  ExecutionCommandAction action;
  std::int64_t expected_state_version;
};

[[nodiscard]] bool operator==(const ExecutionCommand& lhs, const ExecutionCommand& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionCommand& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionCommand& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionCommand& value);
[[nodiscard]] std::string dump(const ExecutionCommand& value);

// execution-session.schema.json
struct ExecutionCommandAck {
  std::string schema;
  std::int64_t contract_version;
  std::string command_id;
  std::string run_id;
  bool accepted;
  std::int64_t state_version;
  ExecutionSessionState status;
  std::optional<std::string> error_code;
  std::optional<std::string> error;
};

[[nodiscard]] bool operator==(const ExecutionCommandAck& lhs, const ExecutionCommandAck& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionCommandAck& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionCommandAck& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionCommandAck& value);
[[nodiscard]] std::string dump(const ExecutionCommandAck& value);

// execution-target.schema.json
struct ExecutionConformance {
  bool passed;
  JsonValue checks;
};

[[nodiscard]] bool operator==(const ExecutionConformance& lhs, const ExecutionConformance& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionConformance& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionConformance& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionConformance& value);
[[nodiscard]] std::string dump(const ExecutionConformance& value);

// execution-session.schema.json
struct ExecutionEvent {
  std::string schema;
  std::int64_t contract_version;
  std::string run_id;
  std::optional<std::string> replication_id;
  std::int64_t seq;
  ExecutionEventKind kind;
  nlohmann::ordered_json payload;
};

[[nodiscard]] bool operator==(const ExecutionEvent& lhs, const ExecutionEvent& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionEvent& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionEvent& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionEvent& value);
[[nodiscard]] std::string dump(const ExecutionEvent& value);

// execution-target.schema.json
struct ExecutionEvidenceDetails {
  std::string kind;
  JsonValue summary;
};

[[nodiscard]] bool operator==(const ExecutionEvidenceDetails& lhs, const ExecutionEvidenceDetails& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionEvidenceDetails& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionEvidenceDetails& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionEvidenceDetails& value);
[[nodiscard]] std::string dump(const ExecutionEvidenceDetails& value);

// execution-session.schema.json
struct ExecutionProviderCapabilities {
  std::optional<bool> pause;
  std::optional<bool> resume;
  std::optional<bool> event_step;
  bool cancel;
  bool telemetry;
  bool snapshot;
  std::optional<std::int64_t> max_concurrent_runs;
};

[[nodiscard]] bool operator==(const ExecutionProviderCapabilities& lhs, const ExecutionProviderCapabilities& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionProviderCapabilities& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionProviderCapabilities& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionProviderCapabilities& value);
[[nodiscard]] std::string dump(const ExecutionProviderCapabilities& value);

// execution-target.schema.json
struct ExecutionRequest {
  std::string schema;
  std::int64_t contract_version;
  std::string request_id;
  std::optional<std::string> run_id;
  std::string target_id;
  std::optional<ArtifactRef> artifact_ref;
  std::optional<std::int64_t> seed;
  std::optional<JsonValue> inputs;
  std::optional<ExecutionBudget> budget;
};

[[nodiscard]] bool operator==(const ExecutionRequest& lhs, const ExecutionRequest& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionRequest& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionRequest& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionRequest& value);
[[nodiscard]] std::string dump(const ExecutionRequest& value);

// execution-target.schema.json
struct ExecutionRun {
  std::string schema;
  std::int64_t contract_version;
  std::string run_id;
  std::string request_id;
  std::string target_id;
  ArtifactRef artifact_ref;
  RunStatus status;
  std::optional<std::int64_t> seed;
  std::optional<ArtifactRef> evidence_ref;
  std::optional<std::string> started_at;
  std::optional<std::string> finished_at;
  std::optional<std::string> error;
};

[[nodiscard]] bool operator==(const ExecutionRun& lhs, const ExecutionRun& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionRun& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionRun& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionRun& value);
[[nodiscard]] std::string dump(const ExecutionRun& value);

// execution-session.schema.json
struct ExecutionSession {
  std::string schema;
  std::int64_t contract_version;
  std::string run_id;
  std::string request_id;
  std::string target_id;
  std::optional<ArtifactRef> artifact_ref;
  ExecutionSessionState status;
  std::int64_t state_version;
  ExecutionProviderCapabilities capabilities;
  std::string created_at;
  std::optional<std::string> started_at;
  std::optional<std::string> finished_at;
  std::optional<std::string> error;
};

[[nodiscard]] bool operator==(const ExecutionSession& lhs, const ExecutionSession& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionSession& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionSession& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionSession& value);
[[nodiscard]] std::string dump(const ExecutionSession& value);

// diagnostic.schema.json
struct FixDefinition {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string definition_id;
  FixKind kind;
  std::string title_key;
  std::optional<JsonSchemaFragment> parameters;
  std::optional<JsonValue> recipe;
};

[[nodiscard]] bool operator==(const FixDefinition& lhs, const FixDefinition& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, FixDefinition& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, FixDefinition& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const FixDefinition& value);
[[nodiscard]] std::string dump(const FixDefinition& value);

// view-notation.schema.json
struct GlyphMapping {
  std::string semantic_kind;
  std::string glyph;
  std::optional<std::vector<std::string>> compartments;
};

[[nodiscard]] bool operator==(const GlyphMapping& lhs, const GlyphMapping& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, GlyphMapping& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, GlyphMapping& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const GlyphMapping& value);
[[nodiscard]] std::string dump(const GlyphMapping& value);

// knowledge-block.schema.json
struct KnowledgeBlockRef {
  std::string id;
  std::optional<std::string> version;
};

[[nodiscard]] bool operator==(const KnowledgeBlockRef& lhs, const KnowledgeBlockRef& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, KnowledgeBlockRef& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, KnowledgeBlockRef& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const KnowledgeBlockRef& value);
[[nodiscard]] std::string dump(const KnowledgeBlockRef& value);

// knowledge-block.schema.json
struct KnowledgeScope {
  std::optional<std::vector<std::string>> paradigms;
  std::optional<std::vector<std::string>> domains;
};

[[nodiscard]] bool operator==(const KnowledgeScope& lhs, const KnowledgeScope& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, KnowledgeScope& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, KnowledgeScope& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const KnowledgeScope& value);
[[nodiscard]] std::string dump(const KnowledgeScope& value);

// knowledge-block.schema.json
struct KnowledgeVerification {
  VerificationMethod method;
  std::optional<std::vector<std::string>> cases;
};

[[nodiscard]] bool operator==(const KnowledgeVerification& lhs, const KnowledgeVerification& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, KnowledgeVerification& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, KnowledgeVerification& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const KnowledgeVerification& value);
[[nodiscard]] std::string dump(const KnowledgeVerification& value);

// plugin-draft.schema.json
struct PermissionDiff {
  std::vector<PermissionId> added;
  std::vector<PermissionId> removed;
  std::optional<bool> trust_escalation;
};

[[nodiscard]] bool operator==(const PermissionDiff& lhs, const PermissionDiff& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PermissionDiff& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PermissionDiff& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PermissionDiff& value);
[[nodiscard]] std::string dump(const PermissionDiff& value);

// permission-trust.schema.json
struct PermissionGrant {
  PermissionId permission_id;
  bool granted;
  std::optional<std::string> scope;
  std::optional<std::string> granted_by;
  std::optional<std::string> granted_at;
};

[[nodiscard]] bool operator==(const PermissionGrant& lhs, const PermissionGrant& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PermissionGrant& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PermissionGrant& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PermissionGrant& value);
[[nodiscard]] std::string dump(const PermissionGrant& value);

// plugin-catalog.schema.json
struct PluginCatalogDiagnostic {
  PluginCatalogSeverity severity;
  PluginCatalogDiagnosticKind kind;
  std::string message;
  std::optional<PluginScope> scope;
  std::optional<std::string> root_id;
  std::optional<std::string> path;
  std::optional<std::string> plugin_id;
};

[[nodiscard]] bool operator==(const PluginCatalogDiagnostic& lhs, const PluginCatalogDiagnostic& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginCatalogDiagnostic& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginCatalogDiagnostic& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginCatalogDiagnostic& value);
[[nodiscard]] std::string dump(const PluginCatalogDiagnostic& value);

// plugin-catalog.schema.json
struct PluginCatalogRoot {
  std::string id;
  PluginScope scope;
};

[[nodiscard]] bool operator==(const PluginCatalogRoot& lhs, const PluginCatalogRoot& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginCatalogRoot& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginCatalogRoot& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginCatalogRoot& value);
[[nodiscard]] std::string dump(const PluginCatalogRoot& value);

// plugin-manifest-v2.schema.json
struct PluginDependency {
  std::string id;
  std::optional<std::string> range;
  std::optional<bool> optional;
};

[[nodiscard]] bool operator==(const PluginDependency& lhs, const PluginDependency& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginDependency& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginDependency& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginDependency& value);
[[nodiscard]] std::string dump(const PluginDependency& value);

// plugin-manifest-v2.schema.json
struct PluginEntrypoints {
  std::optional<std::string> web;
  std::optional<std::string> node;
  std::optional<std::string> wasm;
  std::optional<std::string> component;
  std::optional<std::string> native;
  std::optional<std::string> data;
};

[[nodiscard]] bool operator==(const PluginEntrypoints& lhs, const PluginEntrypoints& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginEntrypoints& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginEntrypoints& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginEntrypoints& value);
[[nodiscard]] std::string dump(const PluginEntrypoints& value);

// plugin-contributions.schema.json
struct PluginInstructionContribution {
  std::string id;
  std::string scope;
  std::int64_t priority;
  std::vector<std::string> rules;
  std::vector<std::string> forbidden;
};

[[nodiscard]] bool operator==(const PluginInstructionContribution& lhs, const PluginInstructionContribution& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginInstructionContribution& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginInstructionContribution& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginInstructionContribution& value);
[[nodiscard]] std::string dump(const PluginInstructionContribution& value);

// plugin-manifest-v2.schema.json
struct PluginIntegrity {
  std::string sha256;
  std::optional<std::string> signature;
  std::optional<std::string> signed_by;
};

[[nodiscard]] bool operator==(const PluginIntegrity& lhs, const PluginIntegrity& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginIntegrity& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginIntegrity& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginIntegrity& value);
[[nodiscard]] std::string dump(const PluginIntegrity& value);

// plugin-manifest-v2.schema.json
struct PluginLockEntry {
  std::string id;
  std::string version;
  std::int64_t api_version;
  std::string sha256;
  std::optional<std::string> source;
  TrustLevel trust;
  std::vector<PermissionGrant> permissions;
  std::optional<std::vector<PluginDependency>> dependencies;
};

[[nodiscard]] bool operator==(const PluginLockEntry& lhs, const PluginLockEntry& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginLockEntry& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginLockEntry& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginLockEntry& value);
[[nodiscard]] std::string dump(const PluginLockEntry& value);

// plugin-manifest-v2.schema.json
struct PluginLockfile {
  std::string schema;
  std::int64_t contract_version;
  std::vector<PluginLockEntry> plugins;
};

[[nodiscard]] bool operator==(const PluginLockfile& lhs, const PluginLockfile& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginLockfile& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginLockfile& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginLockfile& value);
[[nodiscard]] std::string dump(const PluginLockfile& value);

// plugin-manifest-v2.schema.json
struct PluginMigration {
  std::string from_version;
  std::string to_version;
  std::optional<std::string> script;
};

[[nodiscard]] bool operator==(const PluginMigration& lhs, const PluginMigration& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginMigration& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginMigration& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginMigration& value);
[[nodiscard]] std::string dump(const PluginMigration& value);

// plugin-contributions.schema.json
struct PluginPaletteContribution {
  std::string id;
  CanvasEngineId canvas;
  std::string item_kind;
  std::string label;
  std::optional<std::string> icon;
  std::string semantic_type;
  std::optional<JsonSchemaFragment> defaults;
};

[[nodiscard]] bool operator==(const PluginPaletteContribution& lhs, const PluginPaletteContribution& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginPaletteContribution& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginPaletteContribution& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginPaletteContribution& value);
[[nodiscard]] std::string dump(const PluginPaletteContribution& value);

// plugin-registry.schema.json
struct PluginRegistryIntegrity {
  std::string sha256;
  std::optional<std::string> signature;
  std::optional<std::string> signed_by;
};

[[nodiscard]] bool operator==(const PluginRegistryIntegrity& lhs, const PluginRegistryIntegrity& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginRegistryIntegrity& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginRegistryIntegrity& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginRegistryIntegrity& value);
[[nodiscard]] std::string dump(const PluginRegistryIntegrity& value);

// plugin-runtime-session.schema.json
struct PluginRuntimeSession {
  std::string schema;
  std::int64_t contract_version;
  std::string session_id;
  std::string plugin_id;
  std::int64_t generation;
  std::string sha256;
  TrustLevel trust;
  std::vector<PermissionGrant> grants;
  std::string expires_at;
};

[[nodiscard]] bool operator==(const PluginRuntimeSession& lhs, const PluginRuntimeSession& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginRuntimeSession& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginRuntimeSession& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginRuntimeSession& value);
[[nodiscard]] std::string dump(const PluginRuntimeSession& value);

// plugin-services.schema.json
struct PluginServiceMethod {
  std::string name;
  std::optional<JsonSchemaFragment> input;
  std::optional<JsonSchemaFragment> output;
};

[[nodiscard]] bool operator==(const PluginServiceMethod& lhs, const PluginServiceMethod& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginServiceMethod& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginServiceMethod& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginServiceMethod& value);
[[nodiscard]] std::string dump(const PluginServiceMethod& value);

// plugin-contributions.schema.json
struct PluginSkillStep {
  std::string id;
  std::string action;
  std::optional<nlohmann::ordered_json> arguments;
};

[[nodiscard]] bool operator==(const PluginSkillStep& lhs, const PluginSkillStep& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginSkillStep& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginSkillStep& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginSkillStep& value);
[[nodiscard]] std::string dump(const PluginSkillStep& value);

// plugin-contributions.schema.json
struct PluginToolContribution {
  std::string id;
  std::string name;
  std::string capability;
  JsonSchemaFragment input_schema;
  JsonSchemaFragment output_schema;
  std::vector<PermissionId> permissions;
};

[[nodiscard]] bool operator==(const PluginToolContribution& lhs, const PluginToolContribution& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginToolContribution& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginToolContribution& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginToolContribution& value);
[[nodiscard]] std::string dump(const PluginToolContribution& value);

// view-notation.schema.json
struct PortRule {
  std::string port_kind;
  std::vector<std::string> connectable_to;
};

[[nodiscard]] bool operator==(const PortRule& lhs, const PortRule& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PortRule& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PortRule& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PortRule& value);
[[nodiscard]] std::string dump(const PortRule& value);

// common.schema.json
struct Provenance {
  std::string source;
  std::optional<std::string> reference;
  std::optional<std::string> locator;
  std::optional<double> confidence;
};

[[nodiscard]] bool operator==(const Provenance& lhs, const Provenance& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, Provenance& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, Provenance& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const Provenance& value);
[[nodiscard]] std::string dump(const Provenance& value);

// artifact-graph.schema.json
struct Relation {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  RelationKind kind;
  ArtifactRef from;
  ArtifactRef to;
  std::optional<std::map<std::string, std::string>> metadata;
};

[[nodiscard]] bool operator==(const Relation& lhs, const Relation& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, Relation& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, Relation& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const Relation& value);
[[nodiscard]] std::string dump(const Relation& value);

// plugin-contributions.schema.json
struct RunParameterChoice {
  std::string value;
  std::optional<std::string> label;
};

[[nodiscard]] bool operator==(const RunParameterChoice& lhs, const RunParameterChoice& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, RunParameterChoice& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, RunParameterChoice& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const RunParameterChoice& value);
[[nodiscard]] std::string dump(const RunParameterChoice& value);

// execution-target.schema.json
struct RuntimeRef {
  RuntimeKind kind;
  std::optional<std::string> plugin_id;
  std::optional<std::string> capability;
};

[[nodiscard]] bool operator==(const RuntimeRef& lhs, const RuntimeRef& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, RuntimeRef& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, RuntimeRef& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const RuntimeRef& value);
[[nodiscard]] std::string dump(const RuntimeRef& value);

// diagnostic.schema.json
struct SourceSpan {
  std::int64_t start_line;
  std::optional<std::int64_t> start_column;
  std::optional<std::int64_t> end_line;
  std::optional<std::int64_t> end_column;
};

[[nodiscard]] bool operator==(const SourceSpan& lhs, const SourceSpan& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, SourceSpan& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, SourceSpan& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const SourceSpan& value);
[[nodiscard]] std::string dump(const SourceSpan& value);

// knowledge-block.schema.json
struct SymbolDef {
  std::string name;
  std::optional<std::string> type;
  std::optional<std::string> unit;
  std::optional<std::string> description_key;
};

[[nodiscard]] bool operator==(const SymbolDef& lhs, const SymbolDef& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, SymbolDef& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, SymbolDef& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const SymbolDef& value);
[[nodiscard]] std::string dump(const SymbolDef& value);

// agent-engine.schema.json
struct ToolCall {
  std::string call_id;
  std::string name;
  JsonValue arguments;
};

[[nodiscard]] bool operator==(const ToolCall& lhs, const ToolCall& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ToolCall& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ToolCall& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ToolCall& value);
[[nodiscard]] std::string dump(const ToolCall& value);

// agent-engine.schema.json
struct ToolDescriptor {
  std::string name;
  std::optional<std::string> description;
  JsonSchemaFragment parameters;
  std::optional<PermissionId> required_permission;
  std::optional<std::string> scope;
};

[[nodiscard]] bool operator==(const ToolDescriptor& lhs, const ToolDescriptor& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ToolDescriptor& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ToolDescriptor& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ToolDescriptor& value);
[[nodiscard]] std::string dump(const ToolDescriptor& value);

// agent-engine.schema.json
struct ToolResult {
  std::string call_id;
  bool ok;
  JsonValue content;
  std::optional<std::string> error;
};

[[nodiscard]] bool operator==(const ToolResult& lhs, const ToolResult& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ToolResult& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ToolResult& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ToolResult& value);
[[nodiscard]] std::string dump(const ToolResult& value);

// permission-trust.schema.json
struct TrustPolicy {
  std::string schema;
  std::int64_t contract_version;
  TrustLevel default_level;
  std::vector<PermissionGrant> grants;
  std::optional<std::map<std::string, TrustLevel>> overrides;
};

[[nodiscard]] bool operator==(const TrustPolicy& lhs, const TrustPolicy& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, TrustPolicy& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, TrustPolicy& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const TrustPolicy& value);
[[nodiscard]] std::string dump(const TrustPolicy& value);

// permission-trust.schema.json
struct TrustRequirement {
  TrustLevel min_level;
  std::optional<SandboxKind> sandbox;
  std::optional<bool> require_signature;
  std::optional<bool> require_review;
};

[[nodiscard]] bool operator==(const TrustRequirement& lhs, const TrustRequirement& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, TrustRequirement& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, TrustRequirement& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const TrustRequirement& value);
[[nodiscard]] std::string dump(const TrustRequirement& value);

// artifact-graph.schema.json
struct TypedOperation {
  std::string op_id;
  std::string op_type;
  std::optional<std::string> target;
  JsonValue payload;
};

[[nodiscard]] bool operator==(const TypedOperation& lhs, const TypedOperation& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, TypedOperation& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, TypedOperation& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const TypedOperation& value);
[[nodiscard]] std::string dump(const TypedOperation& value);

// view-notation.schema.json
struct ViewContributions {
  std::optional<std::vector<std::string>> notations;
  std::optional<std::vector<std::string>> domains;
};

[[nodiscard]] bool operator==(const ViewContributions& lhs, const ViewContributions& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ViewContributions& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ViewContributions& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ViewContributions& value);
[[nodiscard]] std::string dump(const ViewContributions& value);

// view-notation.schema.json
struct ViewQuery {
  std::vector<ArtifactKind> artifact_kinds;
  std::optional<std::vector<RelationKind>> relation_kinds;
  std::optional<JsonValue> filter;
};

[[nodiscard]] bool operator==(const ViewQuery& lhs, const ViewQuery& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ViewQuery& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ViewQuery& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ViewQuery& value);
[[nodiscard]] std::string dump(const ViewQuery& value);

// wasm-host-abi.schema.json
struct WasmHostImport {
  std::string name;
  std::string capability;
  PermissionId permission_id;
  std::vector<WasmAbiValueType> params;
  WasmAbiValueType result;
};

[[nodiscard]] bool operator==(const WasmHostImport& lhs, const WasmHostImport& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, WasmHostImport& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, WasmHostImport& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const WasmHostImport& value);
[[nodiscard]] std::string dump(const WasmHostImport& value);

// agent-engine.schema.json
struct AgentStepRequest {
  std::string schema;
  std::int64_t contract_version;
  std::string turn_id;
  std::string engine_id;
  std::int64_t step_index;
  JsonValue input;
  std::vector<ToolDescriptor> tools;
  std::optional<JsonValue> compiled_context;
  std::optional<std::int64_t> max_tokens;
  std::optional<AgentCheckpoint> checkpoint;
  std::optional<std::vector<ToolResult>> tool_results;
};

[[nodiscard]] bool operator==(const AgentStepRequest& lhs, const AgentStepRequest& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentStepRequest& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentStepRequest& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentStepRequest& value);
[[nodiscard]] std::string dump(const AgentStepRequest& value);

// agent-engine.schema.json
struct AgentStepResult {
  std::string schema;
  std::int64_t contract_version;
  std::string turn_id;
  std::string engine_id;
  std::int64_t step_index;
  StepStatus status;
  std::optional<JsonValue> message;
  std::optional<std::vector<AgentPlanStep>> plan;
  std::vector<ToolCall> tool_calls;
  std::vector<ToolResult> tool_results;
  std::optional<AgentUsage> usage;
  std::optional<AgentCheckpoint> checkpoint;
  std::optional<std::string> error;
};

[[nodiscard]] bool operator==(const AgentStepResult& lhs, const AgentStepResult& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, AgentStepResult& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, AgentStepResult& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const AgentStepResult& value);
[[nodiscard]] std::string dump(const AgentStepResult& value);

// diagnostic.schema.json
struct DiagnosticInstance {
  std::string schema;
  std::int64_t contract_version;
  std::string definition_id;
  ArtifactRef artifact_ref;
  std::optional<std::string> element_id;
  std::optional<SourceSpan> source_span;
  std::optional<JsonValue> parameter_bindings;
  std::optional<std::vector<std::string>> evidence_refs;
  std::optional<std::string> phase;
  std::optional<Severity> severity;
  std::optional<std::vector<std::string>> available_fix_ids;
};

[[nodiscard]] bool operator==(const DiagnosticInstance& lhs, const DiagnosticInstance& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, DiagnosticInstance& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, DiagnosticInstance& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const DiagnosticInstance& value);
[[nodiscard]] std::string dump(const DiagnosticInstance& value);

// execution-target.schema.json
struct ExecutionEvidence {
  std::string schema;
  std::int64_t contract_version;
  std::string run_id;
  std::string digest;
  std::optional<std::vector<std::string>> methods;
  std::optional<std::string> ir_digest;
  std::optional<std::string> runtime_kind;
  std::optional<std::string> method;
  std::optional<ExecutionConformance> conformance;
  std::optional<ExecutionEvidenceDetails> details;
  std::optional<ArtifactRef> trace_ref;
  std::optional<std::map<std::string, double>> metrics;
};

[[nodiscard]] bool operator==(const ExecutionEvidence& lhs, const ExecutionEvidence& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionEvidence& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionEvidence& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionEvidence& value);
[[nodiscard]] std::string dump(const ExecutionEvidence& value);

// execution-target.schema.json
struct ExecutionTarget {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::optional<std::string> title_key;
  ArtifactRef artifact_ref;
  RuntimeRef runtime;
  std::optional<ExecutionProviderCapabilities> capabilities;
  std::optional<JsonValue> options;
};

[[nodiscard]] bool operator==(const ExecutionTarget& lhs, const ExecutionTarget& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ExecutionTarget& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ExecutionTarget& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ExecutionTarget& value);
[[nodiscard]] std::string dump(const ExecutionTarget& value);

// knowledge-block.schema.json
struct FormulaContent {
  JsonValue expression_ast;
  std::optional<std::map<std::string, SymbolDef>> symbol_table;
  std::optional<std::vector<std::string>> assumptions;
  std::optional<JsonValue> valid_domain;
  std::optional<JsonValue> initial_conditions;
  std::optional<JsonValue> boundary_conditions;
  std::optional<std::string> recommended_solver;
  std::optional<std::string> source_equation;
};

[[nodiscard]] bool operator==(const FormulaContent& lhs, const FormulaContent& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, FormulaContent& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, FormulaContent& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const FormulaContent& value);
[[nodiscard]] std::string dump(const FormulaContent& value);

// knowledge-block.schema.json
struct KnowledgeBlock {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string version;
  std::string owner;
  KnowledgeBlockType type;
  std::string classification;
  KnowledgeStatus status;
  std::optional<KnowledgeScope> scope;
  std::optional<JsonValue> applicability;
  std::optional<std::vector<KnowledgeBlockRef>> dependencies;
  std::optional<std::vector<KnowledgeBlockRef>> conflicts;
  std::optional<std::vector<KnowledgeBlockRef>> supersedes;
  Provenance provenance;
  std::optional<double> confidence;
  std::optional<KnowledgeVerification> verification;
  std::optional<std::map<std::string, std::string>> localization;
  std::optional<JsonValue> content;
  std::optional<FormulaContent> formula;
};

[[nodiscard]] bool operator==(const KnowledgeBlock& lhs, const KnowledgeBlock& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, KnowledgeBlock& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, KnowledgeBlock& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const KnowledgeBlock& value);
[[nodiscard]] std::string dump(const KnowledgeBlock& value);

// knowledge-block.schema.json
struct KnowledgePack {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string version;
  std::string owner;
  std::vector<KnowledgeBlock> blocks;
  std::string digest;
};

[[nodiscard]] bool operator==(const KnowledgePack& lhs, const KnowledgePack& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, KnowledgePack& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, KnowledgePack& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const KnowledgePack& value);
[[nodiscard]] std::string dump(const KnowledgePack& value);

// view-notation.schema.json
struct NotationPack {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string owner;
  std::vector<GlyphMapping> glyphs;
  std::vector<EdgeMapping> edges;
  std::optional<std::vector<PortRule>> ports;
  std::optional<std::string> property_editor;
  std::optional<JsonValue> layout_hints;
  std::vector<CreateActionRef> create_actions;
};

[[nodiscard]] bool operator==(const NotationPack& lhs, const NotationPack& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, NotationPack& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, NotationPack& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const NotationPack& value);
[[nodiscard]] std::string dump(const NotationPack& value);

// plugin-contributions.schema.json
struct PluginRunParameterContribution {
  std::string id;
  std::string label;
  RunParameterKind kind;
  RunParameterOwner owner;
  std::optional<std::string> hint;
  std::optional<double> minimum;
  std::optional<double> maximum;
  std::optional<std::vector<RunParameterChoice>> choices;
};

[[nodiscard]] bool operator==(const PluginRunParameterContribution& lhs, const PluginRunParameterContribution& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginRunParameterContribution& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginRunParameterContribution& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginRunParameterContribution& value);
[[nodiscard]] std::string dump(const PluginRunParameterContribution& value);

// plugin-services.schema.json
struct PluginService {
  std::string name;
  std::vector<PluginServiceMethod> methods;
};

[[nodiscard]] bool operator==(const PluginService& lhs, const PluginService& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginService& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginService& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginService& value);
[[nodiscard]] std::string dump(const PluginService& value);

// plugin-contributions.schema.json
struct PluginSkillContribution {
  std::string id;
  std::string name;
  std::string trigger;
  std::vector<std::string> inputs;
  std::vector<PluginSkillStep> steps;
  std::vector<PermissionId> permissions;
};

[[nodiscard]] bool operator==(const PluginSkillContribution& lhs, const PluginSkillContribution& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginSkillContribution& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginSkillContribution& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginSkillContribution& value);
[[nodiscard]] std::string dump(const PluginSkillContribution& value);

// artifact-graph.schema.json
struct Revision {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string artifact_id;
  std::optional<std::string> parent_revision_id;
  std::string created_at;
  std::string created_by;
  std::vector<TypedOperation> operations;
  std::string digest;
};

[[nodiscard]] bool operator==(const Revision& lhs, const Revision& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, Revision& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, Revision& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const Revision& value);
[[nodiscard]] std::string dump(const Revision& value);

// artifact-graph.schema.json
struct Transaction {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::optional<std::string> idempotency_key;
  TransactionStatus status;
  std::string proposed_by;
  std::optional<std::string> approved_by;
  std::vector<ArtifactRef> artifact_refs;
  std::vector<TypedOperation> operations;
  std::optional<std::string> committed_revision_id;
  std::optional<std::string> created_at;
  std::optional<std::string> resolution_record;
};

[[nodiscard]] bool operator==(const Transaction& lhs, const Transaction& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, Transaction& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, Transaction& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const Transaction& value);
[[nodiscard]] std::string dump(const Transaction& value);

// view-notation.schema.json
struct ViewDefinition {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string owner;
  std::string title_key;
  CanvasEngineId canvas;
  ViewQuery query;
  std::optional<JsonValue> projection;
  std::vector<std::string> interactions;
  bool supports_inverse_edit;
  LayoutPersistence layout_persistence;
  std::optional<ViewContributions> required_contributions;
};

[[nodiscard]] bool operator==(const ViewDefinition& lhs, const ViewDefinition& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, ViewDefinition& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, ViewDefinition& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const ViewDefinition& value);
[[nodiscard]] std::string dump(const ViewDefinition& value);

// wasm-host-abi.schema.json
struct WasmHostAbi {
  std::string schema;
  std::int64_t contract_version;
  std::int64_t abi_version;
  std::vector<WasmHostImport> imports;
  std::string abi_version_export;
  std::string activate_export;
  std::string deactivate_export;
};

[[nodiscard]] bool operator==(const WasmHostAbi& lhs, const WasmHostAbi& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, WasmHostAbi& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, WasmHostAbi& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const WasmHostAbi& value);
[[nodiscard]] std::string dump(const WasmHostAbi& value);

// plugin-contributions.schema.json
struct PluginContributionSet {
  std::string schema;
  std::int64_t contract_version;
  std::string plugin_id;
  std::string version;
  std::vector<KnowledgeBlock> knowledge;
  std::vector<PluginSkillContribution> skills;
  std::vector<PluginInstructionContribution> instructions;
  std::vector<DiagnosticDefinition> diagnostics;
  std::vector<ViewDefinition> views;
  std::vector<NotationPack> notations;
  std::vector<CreateAction> create_actions;
  std::vector<PluginPaletteContribution> palettes;
  std::vector<PluginToolContribution> tools;
  std::optional<std::vector<PluginRunParameterContribution>> run_parameters;
};

[[nodiscard]] bool operator==(const PluginContributionSet& lhs, const PluginContributionSet& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginContributionSet& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginContributionSet& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginContributionSet& value);
[[nodiscard]] std::string dump(const PluginContributionSet& value);

// plugin-manifest-v2.schema.json
struct PluginManifest {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string version;
  std::int64_t api_version;
  std::optional<std::string> display_name;
  std::optional<std::string> description;
  std::vector<std::string> provides;
  std::vector<PluginDependency> requires_;
  PluginEntrypoints entrypoints;
  std::vector<PermissionId> permissions;
  std::optional<std::vector<PluginService>> services;
  std::optional<std::vector<ExecutionTarget>> execution_targets;
  TrustRequirement trust;
  std::optional<JsonSchemaFragment> config;
  std::optional<std::vector<PluginMigration>> migrations;
  std::optional<std::vector<std::string>> conformance;
  std::optional<PluginIntegrity> integrity;
};

[[nodiscard]] bool operator==(const PluginManifest& lhs, const PluginManifest& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginManifest& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginManifest& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginManifest& value);
[[nodiscard]] std::string dump(const PluginManifest& value);

// plugin-registry.schema.json
struct PluginRegistry {
  std::string schema;
  std::int64_t contract_version;
  std::int64_t generation;
  std::vector<std::string> plugins;
  std::vector<PluginContributionSet> contributions;
  std::optional<PluginRegistryIntegrity> integrity;
};

[[nodiscard]] bool operator==(const PluginRegistry& lhs, const PluginRegistry& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginRegistry& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginRegistry& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginRegistry& value);
[[nodiscard]] std::string dump(const PluginRegistry& value);

// plugin-catalog.schema.json
struct PluginCatalogEntry {
  std::string id;
  PluginScope scope;
  std::string root_id;
  std::string path;
  std::string sha256;
  PluginManifest manifest;
};

[[nodiscard]] bool operator==(const PluginCatalogEntry& lhs, const PluginCatalogEntry& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginCatalogEntry& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginCatalogEntry& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginCatalogEntry& value);
[[nodiscard]] std::string dump(const PluginCatalogEntry& value);

// plugin-draft.schema.json
struct PluginDraft {
  std::string schema;
  std::int64_t contract_version;
  std::string id;
  std::string base_plugin_id;
  PluginManifest manifest;
  PluginContributionSet contributions;
  PluginDraftStatus status;
  std::string created_by;
  std::string created_at;
  std::optional<std::string> validated_at;
  std::optional<std::string> approved_by;
  std::optional<std::string> approved_at;
  PermissionDiff permission_diff;
  std::optional<std::map<std::string, std::string>> files;
  std::optional<std::vector<std::string>> diagnostics;
};

[[nodiscard]] bool operator==(const PluginDraft& lhs, const PluginDraft& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginDraft& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginDraft& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginDraft& value);
[[nodiscard]] std::string dump(const PluginDraft& value);

// plugin-catalog.schema.json
struct PluginCatalog {
  std::string schema;
  std::int64_t contract_version;
  std::vector<PluginCatalogRoot> roots;
  std::vector<PluginCatalogEntry> entries;
  std::vector<PluginCatalogDiagnostic> diagnostics;
};

[[nodiscard]] bool operator==(const PluginCatalog& lhs, const PluginCatalog& rhs);
[[nodiscard]] bool parse_json(const nlohmann::ordered_json& j, PluginCatalog& out, std::string& error);
[[nodiscard]] bool parse(std::string_view text, PluginCatalog& out, std::string& error);
[[nodiscard]] nlohmann::ordered_json to_json(const PluginCatalog& value);
[[nodiscard]] std::string dump(const PluginCatalog& value);

}  // namespace logicpilot::contracts

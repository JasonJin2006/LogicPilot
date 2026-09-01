// GENERATED FILE - do not edit. Regenerate with: node scripts/gen-contracts.mjs
#include "logicpilot/contracts/contracts_generated.h"

#include <stdexcept>
#include <utility>

namespace logicpilot::contracts {

namespace {

[[noreturn]] void fail_missing(std::string& error, const std::string& path, const char* key) {
  error = path + ": missing required field '" + key + "'";
  throw std::runtime_error(error);
}

const nlohmann::ordered_json& field_or_fail(std::string& error, const nlohmann::ordered_json& j,
                                            const char* key, const std::string& path) {
  auto it = j.find(key);
  if (it == j.end()) fail_missing(error, path, key);
  return *it;
}

nlohmann::ordered_json to_json_value(const std::string& v) { return nlohmann::ordered_json(v); }
nlohmann::ordered_json to_json_value(std::int64_t v) { return nlohmann::ordered_json(v); }
nlohmann::ordered_json to_json_value(double v) { return nlohmann::ordered_json(v); }
nlohmann::ordered_json to_json_value(bool v) { return nlohmann::ordered_json(v); }
nlohmann::ordered_json to_json_value(const JsonValue& v) { return v; }
nlohmann::ordered_json to_json_value(StepStatus v) { return to_json(v); }
nlohmann::ordered_json to_json_value(ArtifactKind v) { return to_json(v); }
nlohmann::ordered_json to_json_value(RelationKind v) { return to_json(v); }
nlohmann::ordered_json to_json_value(TransactionStatus v) { return to_json(v); }
nlohmann::ordered_json to_json_value(Severity v) { return to_json(v); }
nlohmann::ordered_json to_json_value(FixKind v) { return to_json(v); }
nlohmann::ordered_json to_json_value(RuntimeKind v) { return to_json(v); }
nlohmann::ordered_json to_json_value(RunStatus v) { return to_json(v); }
nlohmann::ordered_json to_json_value(KnowledgeBlockType v) { return to_json(v); }
nlohmann::ordered_json to_json_value(VerificationMethod v) { return to_json(v); }
nlohmann::ordered_json to_json_value(KnowledgeStatus v) { return to_json(v); }
nlohmann::ordered_json to_json_value(PermissionId v) { return to_json(v); }
nlohmann::ordered_json to_json_value(TrustLevel v) { return to_json(v); }
nlohmann::ordered_json to_json_value(SandboxKind v) { return to_json(v); }
nlohmann::ordered_json to_json_value(CanvasEngineId v) { return to_json(v); }
nlohmann::ordered_json to_json_value(LayoutPersistence v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ToolDescriptor& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ToolCall& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ToolResult& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const AgentStepRequest& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const AgentUsage& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const AgentCheckpoint& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const AgentStepResult& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const AgentEngineDescriptor& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ArtifactRef& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const Artifact& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const TypedOperation& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const Revision& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const Relation& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const Transaction& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const Provenance& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const DiagnosticDefinition& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const FixDefinition& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const SourceSpan& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const DiagnosticInstance& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const RuntimeRef& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ExecutionTarget& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ExecutionBudget& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ExecutionRequest& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ExecutionRun& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ExecutionEvidence& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const KnowledgeBlockRef& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const KnowledgeScope& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const KnowledgeVerification& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const SymbolDef& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const FormulaContent& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const KnowledgeBlock& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const KnowledgePack& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const TrustRequirement& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PermissionGrant& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const TrustPolicy& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginManifest& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginDependency& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginEntrypoints& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginMigration& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginIntegrity& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginLockEntry& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PluginLockfile& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ViewQuery& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ViewDefinition& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const ViewContributions& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const GlyphMapping& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const EdgeMapping& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const PortRule& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const NotationPack& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const CreateActionRef& v) { return to_json(v); }
nlohmann::ordered_json to_json_value(const CreateAction& v) { return to_json(v); }
template <typename T>
nlohmann::ordered_json to_json_value(const std::vector<T>& v) {
  auto arr = nlohmann::ordered_json::array();
  for (const auto& item : v) arr.push_back(to_json_value(item));
  return arr;
}
template <typename T>
nlohmann::ordered_json to_json_value(const std::map<std::string, T>& v) {
  auto obj = nlohmann::ordered_json::object();
  for (const auto& [key, value] : v) obj[key] = to_json_value(value);
  return obj;
}

}  // namespace

std::string dump(StepStatus value) {
  switch (value) {
    case StepStatus::kContinue: return "continue";
    case StepStatus::kDone: return "done";
    case StepStatus::kCancelled: return "cancelled";
    case StepStatus::kFailed: return "failed";
  }
  return "<invalid StepStatus>";
}

bool parse(std::string_view text, StepStatus& out, std::string& error) {
  static const std::pair<std::string_view, StepStatus> kTable[] = {
      {"continue", StepStatus::kContinue},
      {"done", StepStatus::kDone},
      {"cancelled", StepStatus::kCancelled},
      {"failed", StepStatus::kFailed},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid StepStatus value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(StepStatus value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(ArtifactKind value) {
  switch (value) {
    case ArtifactKind::kSemanticModel: return "semantic-model";
    case ArtifactKind::kSourceDocument: return "source-document";
    case ArtifactKind::kViewLayout: return "view-layout";
    case ArtifactKind::kKnowledgePack: return "knowledge-pack";
    case ArtifactKind::kPluginDraft: return "plugin-draft";
    case ArtifactKind::kExecutionTarget: return "execution-target";
    case ArtifactKind::kExperiment: return "experiment";
    case ArtifactKind::kRun: return "run";
    case ArtifactKind::kEvidence: return "evidence";
    case ArtifactKind::kDiagnosticSet: return "diagnostic-set";
    case ArtifactKind::kMigrationRecord: return "migration-record";
  }
  return "<invalid ArtifactKind>";
}

bool parse(std::string_view text, ArtifactKind& out, std::string& error) {
  static const std::pair<std::string_view, ArtifactKind> kTable[] = {
      {"semantic-model", ArtifactKind::kSemanticModel},
      {"source-document", ArtifactKind::kSourceDocument},
      {"view-layout", ArtifactKind::kViewLayout},
      {"knowledge-pack", ArtifactKind::kKnowledgePack},
      {"plugin-draft", ArtifactKind::kPluginDraft},
      {"execution-target", ArtifactKind::kExecutionTarget},
      {"experiment", ArtifactKind::kExperiment},
      {"run", ArtifactKind::kRun},
      {"evidence", ArtifactKind::kEvidence},
      {"diagnostic-set", ArtifactKind::kDiagnosticSet},
      {"migration-record", ArtifactKind::kMigrationRecord},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid ArtifactKind value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(ArtifactKind value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(RelationKind value) {
  switch (value) {
    case RelationKind::kProjects: return "projects";
    case RelationKind::kExecutes: return "executes";
    case RelationKind::kValidates: return "validates";
    case RelationKind::kProducedBy: return "produced-by";
    case RelationKind::kAppliesTo: return "applies-to";
    case RelationKind::kProvides: return "provides";
    case RelationKind::kDerivesFrom: return "derives-from";
    case RelationKind::kSupersedes: return "supersedes";
  }
  return "<invalid RelationKind>";
}

bool parse(std::string_view text, RelationKind& out, std::string& error) {
  static const std::pair<std::string_view, RelationKind> kTable[] = {
      {"projects", RelationKind::kProjects},
      {"executes", RelationKind::kExecutes},
      {"validates", RelationKind::kValidates},
      {"produced-by", RelationKind::kProducedBy},
      {"applies-to", RelationKind::kAppliesTo},
      {"provides", RelationKind::kProvides},
      {"derives-from", RelationKind::kDerivesFrom},
      {"supersedes", RelationKind::kSupersedes},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid RelationKind value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(RelationKind value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(TransactionStatus value) {
  switch (value) {
    case TransactionStatus::kProposed: return "proposed";
    case TransactionStatus::kValidated: return "validated";
    case TransactionStatus::kAwaitingApproval: return "awaiting-approval";
    case TransactionStatus::kCommitted: return "committed";
    case TransactionStatus::kRejected: return "rejected";
    case TransactionStatus::kRolledBack: return "rolled-back";
  }
  return "<invalid TransactionStatus>";
}

bool parse(std::string_view text, TransactionStatus& out, std::string& error) {
  static const std::pair<std::string_view, TransactionStatus> kTable[] = {
      {"proposed", TransactionStatus::kProposed},
      {"validated", TransactionStatus::kValidated},
      {"awaiting-approval", TransactionStatus::kAwaitingApproval},
      {"committed", TransactionStatus::kCommitted},
      {"rejected", TransactionStatus::kRejected},
      {"rolled-back", TransactionStatus::kRolledBack},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid TransactionStatus value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(TransactionStatus value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(Severity value) {
  switch (value) {
    case Severity::kInfo: return "info";
    case Severity::kWarning: return "warning";
    case Severity::kError: return "error";
    case Severity::kFatal: return "fatal";
  }
  return "<invalid Severity>";
}

bool parse(std::string_view text, Severity& out, std::string& error) {
  static const std::pair<std::string_view, Severity> kTable[] = {
      {"info", Severity::kInfo},
      {"warning", Severity::kWarning},
      {"error", Severity::kError},
      {"fatal", Severity::kFatal},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid Severity value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(Severity value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(FixKind value) {
  switch (value) {
    case FixKind::kManual: return "manual";
    case FixKind::kAssisted: return "assisted";
    case FixKind::kAutomated: return "automated";
  }
  return "<invalid FixKind>";
}

bool parse(std::string_view text, FixKind& out, std::string& error) {
  static const std::pair<std::string_view, FixKind> kTable[] = {
      {"manual", FixKind::kManual},
      {"assisted", FixKind::kAssisted},
      {"automated", FixKind::kAutomated},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid FixKind value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(FixKind value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(RuntimeKind value) {
  switch (value) {
    case RuntimeKind::kInterpreter: return "interpreter";
    case RuntimeKind::kWasm: return "wasm";
    case RuntimeKind::kNative: return "native";
    case RuntimeKind::kExternal: return "external";
  }
  return "<invalid RuntimeKind>";
}

bool parse(std::string_view text, RuntimeKind& out, std::string& error) {
  static const std::pair<std::string_view, RuntimeKind> kTable[] = {
      {"interpreter", RuntimeKind::kInterpreter},
      {"wasm", RuntimeKind::kWasm},
      {"native", RuntimeKind::kNative},
      {"external", RuntimeKind::kExternal},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid RuntimeKind value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(RuntimeKind value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(RunStatus value) {
  switch (value) {
    case RunStatus::kPending: return "pending";
    case RunStatus::kRunning: return "running";
    case RunStatus::kCompleted: return "completed";
    case RunStatus::kFailed: return "failed";
    case RunStatus::kCancelled: return "cancelled";
  }
  return "<invalid RunStatus>";
}

bool parse(std::string_view text, RunStatus& out, std::string& error) {
  static const std::pair<std::string_view, RunStatus> kTable[] = {
      {"pending", RunStatus::kPending},
      {"running", RunStatus::kRunning},
      {"completed", RunStatus::kCompleted},
      {"failed", RunStatus::kFailed},
      {"cancelled", RunStatus::kCancelled},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid RunStatus value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(RunStatus value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(KnowledgeBlockType value) {
  switch (value) {
    case KnowledgeBlockType::kConcept: return "concept";
    case KnowledgeBlockType::kTerm: return "term";
    case KnowledgeBlockType::kRelation: return "relation";
    case KnowledgeBlockType::kConstraint: return "constraint";
    case KnowledgeBlockType::kFormula: return "formula";
    case KnowledgeBlockType::kDiagnostic: return "diagnostic";
    case KnowledgeBlockType::kFix: return "fix";
    case KnowledgeBlockType::kWorkflow: return "workflow";
    case KnowledgeBlockType::kInstruction: return "instruction";
    case KnowledgeBlockType::kExample: return "example";
    case KnowledgeBlockType::kCounterexample: return "counterexample";
    case KnowledgeBlockType::kEvidence: return "evidence";
    case KnowledgeBlockType::kVisualTemplate: return "visual-template";
    case KnowledgeBlockType::kTransformation: return "transformation";
    case KnowledgeBlockType::kConformanceCase: return "conformance-case";
  }
  return "<invalid KnowledgeBlockType>";
}

bool parse(std::string_view text, KnowledgeBlockType& out, std::string& error) {
  static const std::pair<std::string_view, KnowledgeBlockType> kTable[] = {
      {"concept", KnowledgeBlockType::kConcept},
      {"term", KnowledgeBlockType::kTerm},
      {"relation", KnowledgeBlockType::kRelation},
      {"constraint", KnowledgeBlockType::kConstraint},
      {"formula", KnowledgeBlockType::kFormula},
      {"diagnostic", KnowledgeBlockType::kDiagnostic},
      {"fix", KnowledgeBlockType::kFix},
      {"workflow", KnowledgeBlockType::kWorkflow},
      {"instruction", KnowledgeBlockType::kInstruction},
      {"example", KnowledgeBlockType::kExample},
      {"counterexample", KnowledgeBlockType::kCounterexample},
      {"evidence", KnowledgeBlockType::kEvidence},
      {"visual-template", KnowledgeBlockType::kVisualTemplate},
      {"transformation", KnowledgeBlockType::kTransformation},
      {"conformance-case", KnowledgeBlockType::kConformanceCase},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid KnowledgeBlockType value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(KnowledgeBlockType value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(VerificationMethod value) {
  switch (value) {
    case VerificationMethod::kNone: return "none";
    case VerificationMethod::kUnitTest: return "unit-test";
    case VerificationMethod::kConformanceCase: return "conformance-case";
    case VerificationMethod::kHumanReview: return "human-review";
  }
  return "<invalid VerificationMethod>";
}

bool parse(std::string_view text, VerificationMethod& out, std::string& error) {
  static const std::pair<std::string_view, VerificationMethod> kTable[] = {
      {"none", VerificationMethod::kNone},
      {"unit-test", VerificationMethod::kUnitTest},
      {"conformance-case", VerificationMethod::kConformanceCase},
      {"human-review", VerificationMethod::kHumanReview},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid VerificationMethod value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(VerificationMethod value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(KnowledgeStatus value) {
  switch (value) {
    case KnowledgeStatus::kDraft: return "draft";
    case KnowledgeStatus::kReviewed: return "reviewed";
    case KnowledgeStatus::kTrusted: return "trusted";
    case KnowledgeStatus::kDeprecated: return "deprecated";
  }
  return "<invalid KnowledgeStatus>";
}

bool parse(std::string_view text, KnowledgeStatus& out, std::string& error) {
  static const std::pair<std::string_view, KnowledgeStatus> kTable[] = {
      {"draft", KnowledgeStatus::kDraft},
      {"reviewed", KnowledgeStatus::kReviewed},
      {"trusted", KnowledgeStatus::kTrusted},
      {"deprecated", KnowledgeStatus::kDeprecated},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid KnowledgeStatus value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(KnowledgeStatus value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(PermissionId value) {
  switch (value) {
    case PermissionId::kKnowledgeDraftWrite: return "knowledge.draft.write";
    case PermissionId::kSkillDraftWrite: return "skill.draft.write";
    case PermissionId::kInstructionDraftWrite: return "instruction.draft.write";
    case PermissionId::kViewDraftWrite: return "view.draft.write";
    case PermissionId::kNotationDraftWrite: return "notation.draft.write";
    case PermissionId::kThemeDraftWrite: return "theme.draft.write";
    case PermissionId::kValidatorDraftWrite: return "validator.draft.write";
    case PermissionId::kRuntimeWasmBuild: return "runtime.wasm.build";
    case PermissionId::kRuntimeNativeBuild: return "runtime.native.build";
    case PermissionId::kPluginInstall: return "plugin.install";
    case PermissionId::kPluginUpgrade: return "plugin.upgrade";
    case PermissionId::kPluginPublish: return "plugin.publish";
  }
  return "<invalid PermissionId>";
}

bool parse(std::string_view text, PermissionId& out, std::string& error) {
  static const std::pair<std::string_view, PermissionId> kTable[] = {
      {"knowledge.draft.write", PermissionId::kKnowledgeDraftWrite},
      {"skill.draft.write", PermissionId::kSkillDraftWrite},
      {"instruction.draft.write", PermissionId::kInstructionDraftWrite},
      {"view.draft.write", PermissionId::kViewDraftWrite},
      {"notation.draft.write", PermissionId::kNotationDraftWrite},
      {"theme.draft.write", PermissionId::kThemeDraftWrite},
      {"validator.draft.write", PermissionId::kValidatorDraftWrite},
      {"runtime.wasm.build", PermissionId::kRuntimeWasmBuild},
      {"runtime.native.build", PermissionId::kRuntimeNativeBuild},
      {"plugin.install", PermissionId::kPluginInstall},
      {"plugin.upgrade", PermissionId::kPluginUpgrade},
      {"plugin.publish", PermissionId::kPluginPublish},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid PermissionId value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(PermissionId value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(TrustLevel value) {
  switch (value) {
    case TrustLevel::kT0: return "t0";
    case TrustLevel::kT1: return "t1";
    case TrustLevel::kT2: return "t2";
    case TrustLevel::kT3: return "t3";
    case TrustLevel::kT4: return "t4";
    case TrustLevel::kT5: return "t5";
  }
  return "<invalid TrustLevel>";
}

bool parse(std::string_view text, TrustLevel& out, std::string& error) {
  static const std::pair<std::string_view, TrustLevel> kTable[] = {
      {"t0", TrustLevel::kT0},
      {"t1", TrustLevel::kT1},
      {"t2", TrustLevel::kT2},
      {"t3", TrustLevel::kT3},
      {"t4", TrustLevel::kT4},
      {"t5", TrustLevel::kT5},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid TrustLevel value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(TrustLevel value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(SandboxKind value) {
  switch (value) {
    case SandboxKind::kNone: return "none";
    case SandboxKind::kWasm: return "wasm";
    case SandboxKind::kWorker: return "worker";
    case SandboxKind::kIframe: return "iframe";
  }
  return "<invalid SandboxKind>";
}

bool parse(std::string_view text, SandboxKind& out, std::string& error) {
  static const std::pair<std::string_view, SandboxKind> kTable[] = {
      {"none", SandboxKind::kNone},
      {"wasm", SandboxKind::kWasm},
      {"worker", SandboxKind::kWorker},
      {"iframe", SandboxKind::kIframe},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid SandboxKind value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(SandboxKind value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(CanvasEngineId value) {
  switch (value) {
    case CanvasEngineId::kGraph2d: return "graph2d";
    case CanvasEngineId::kScene2d: return "scene2d";
    case CanvasEngineId::kScene3d: return "scene3d";
    case CanvasEngineId::kTimeline: return "timeline";
    case CanvasEngineId::kTable: return "table";
    case CanvasEngineId::kChart: return "chart";
    case CanvasEngineId::kText: return "text";
  }
  return "<invalid CanvasEngineId>";
}

bool parse(std::string_view text, CanvasEngineId& out, std::string& error) {
  static const std::pair<std::string_view, CanvasEngineId> kTable[] = {
      {"graph2d", CanvasEngineId::kGraph2d},
      {"scene2d", CanvasEngineId::kScene2d},
      {"scene3d", CanvasEngineId::kScene3d},
      {"timeline", CanvasEngineId::kTimeline},
      {"table", CanvasEngineId::kTable},
      {"chart", CanvasEngineId::kChart},
      {"text", CanvasEngineId::kText},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid CanvasEngineId value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(CanvasEngineId value) { return nlohmann::ordered_json(dump(value)); }

std::string dump(LayoutPersistence value) {
  switch (value) {
    case LayoutPersistence::kNone: return "none";
    case LayoutPersistence::kSidecar: return "sidecar";
    case LayoutPersistence::kArtifact: return "artifact";
  }
  return "<invalid LayoutPersistence>";
}

bool parse(std::string_view text, LayoutPersistence& out, std::string& error) {
  static const std::pair<std::string_view, LayoutPersistence> kTable[] = {
      {"none", LayoutPersistence::kNone},
      {"sidecar", LayoutPersistence::kSidecar},
      {"artifact", LayoutPersistence::kArtifact},
  };
  for (const auto& [label, parsed] : kTable) {
    if (text == label) {
      out = parsed;
      return true;
    }
  }
  error = "invalid LayoutPersistence value: " + std::string(text);
  return false;
}

nlohmann::ordered_json to_json(LayoutPersistence value) { return nlohmann::ordered_json(dump(value)); }

bool parse_json(const nlohmann::ordered_json& j, ToolDescriptor& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ToolDescriptor";
    return false;
  }
  static const char* const kKnownFields[] = {
      "name",
      "description",
      "parameters",
      "requiredPermission",
      "scope",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ToolDescriptor: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "name", "ToolDescriptor");
      if (!value.is_string()) {
        error = std::string("ToolDescriptor.name") + ": expected string";
        return false;
      }
      out.name = value.get<std::string>();
  }
  {
    auto field_it = j.find("description");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ToolDescriptor.description") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.description = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "parameters", "ToolDescriptor");
      out.parameters = value;
  }
  {
    auto field_it = j.find("requiredPermission");
    if (field_it != j.end()) {
      PermissionId parsed{};
      std::string enum_error;
      if (!parse((*field_it).get<std::string>(), parsed, enum_error)) {
        error = std::string("ToolDescriptor.requiredPermission") + ": " + enum_error;
        return false;
      }
      out.required_permission = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("scope");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ToolDescriptor.scope") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.scope = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ToolDescriptor& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ToolDescriptor& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["name"] = to_json_value(value.name);
  if (value.description.has_value()) {
    j["description"] = to_json_value(*value.description);
  }
    j["parameters"] = to_json_value(value.parameters);
  if (value.required_permission.has_value()) {
    j["requiredPermission"] = to_json(*value.required_permission);
  }
  if (value.scope.has_value()) {
    j["scope"] = to_json_value(*value.scope);
  }
  return j;
}

std::string dump(const ToolDescriptor& value) { return to_json(value).dump(2); }

bool operator==(const ToolDescriptor& lhs, const ToolDescriptor& rhs) {
  return lhs.name == rhs.name
      && lhs.description == rhs.description
      && lhs.parameters.dump() == rhs.parameters.dump()
      && lhs.required_permission == rhs.required_permission
      && lhs.scope == rhs.scope;
}

bool parse_json(const nlohmann::ordered_json& j, ToolCall& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ToolCall";
    return false;
  }
  static const char* const kKnownFields[] = {
      "callId",
      "name",
      "arguments",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ToolCall: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "callId", "ToolCall");
      if (!value.is_string()) {
        error = std::string("ToolCall.callId") + ": expected string";
        return false;
      }
      out.call_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "name", "ToolCall");
      if (!value.is_string()) {
        error = std::string("ToolCall.name") + ": expected string";
        return false;
      }
      out.name = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "arguments", "ToolCall");
      out.arguments = value;
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ToolCall& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ToolCall& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["callId"] = to_json_value(value.call_id);
    j["name"] = to_json_value(value.name);
    j["arguments"] = to_json_value(value.arguments);
  return j;
}

std::string dump(const ToolCall& value) { return to_json(value).dump(2); }

bool operator==(const ToolCall& lhs, const ToolCall& rhs) {
  return lhs.call_id == rhs.call_id
      && lhs.name == rhs.name
      && lhs.arguments.dump() == rhs.arguments.dump();
}

bool parse_json(const nlohmann::ordered_json& j, ToolResult& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ToolResult";
    return false;
  }
  static const char* const kKnownFields[] = {
      "callId",
      "ok",
      "content",
      "error",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ToolResult: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "callId", "ToolResult");
      if (!value.is_string()) {
        error = std::string("ToolResult.callId") + ": expected string";
        return false;
      }
      out.call_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "ok", "ToolResult");
      if (!value.is_boolean()) {
        error = std::string("ToolResult.ok") + ": expected boolean";
        return false;
      }
      out.ok = value.get<bool>();
  }
  {
    const auto& value = field_or_fail(error, j, "content", "ToolResult");
      out.content = value;
  }
  {
    auto field_it = j.find("error");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ToolResult.error") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.error = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ToolResult& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ToolResult& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["callId"] = to_json_value(value.call_id);
    j["ok"] = to_json_value(value.ok);
    j["content"] = to_json_value(value.content);
  if (value.error.has_value()) {
    j["error"] = to_json_value(*value.error);
  }
  return j;
}

std::string dump(const ToolResult& value) { return to_json(value).dump(2); }

bool operator==(const ToolResult& lhs, const ToolResult& rhs) {
  return lhs.call_id == rhs.call_id
      && lhs.ok == rhs.ok
      && lhs.content.dump() == rhs.content.dump()
      && lhs.error == rhs.error;
}

bool parse_json(const nlohmann::ordered_json& j, AgentStepRequest& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for AgentStepRequest";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "turnId",
      "engineId",
      "stepIndex",
      "input",
      "tools",
      "compiledContext",
      "maxTokens",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "AgentStepRequest: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "AgentStepRequest");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.agent-step-request/v1") {
        error = std::string("AgentStepRequest.schema") + ": expected constant " + "logicpilot.agent-step-request/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "AgentStepRequest");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("AgentStepRequest.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "turnId", "AgentStepRequest");
      if (!value.is_string()) {
        error = std::string("AgentStepRequest.turnId") + ": expected string";
        return false;
      }
      out.turn_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "engineId", "AgentStepRequest");
      if (!value.is_string()) {
        error = std::string("AgentStepRequest.engineId") + ": expected string";
        return false;
      }
      out.engine_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "stepIndex", "AgentStepRequest");
      if (!value.is_number_integer()) {
        error = std::string("AgentStepRequest.stepIndex") + ": expected integer";
        return false;
      }
      out.step_index = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "input", "AgentStepRequest");
      out.input = value;
  }
  {
    const auto& value = field_or_fail(error, j, "tools", "AgentStepRequest");
      if (!value.is_array()) {
        error = std::string("AgentStepRequest.tools") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.tools.emplace_back(), error)) {
          error = std::string("AgentStepRequest.tools") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("compiledContext");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.compiled_context = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("maxTokens");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("AgentStepRequest.maxTokens") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.max_tokens = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, AgentStepRequest& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const AgentStepRequest& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["turnId"] = to_json_value(value.turn_id);
    j["engineId"] = to_json_value(value.engine_id);
    j["stepIndex"] = to_json_value(value.step_index);
    j["input"] = to_json_value(value.input);
    j["tools"] = to_json_value(value.tools);
  if (value.compiled_context.has_value()) {
    j["compiledContext"] = to_json_value(*value.compiled_context);
  }
  if (value.max_tokens.has_value()) {
    j["maxTokens"] = to_json_value(*value.max_tokens);
  }
  return j;
}

std::string dump(const AgentStepRequest& value) { return to_json(value).dump(2); }

bool operator==(const AgentStepRequest& lhs, const AgentStepRequest& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.turn_id == rhs.turn_id
      && lhs.engine_id == rhs.engine_id
      && lhs.step_index == rhs.step_index
      && lhs.input.dump() == rhs.input.dump()
      && lhs.tools == rhs.tools
      && (lhs.compiled_context.has_value() == rhs.compiled_context.has_value()
      && (!lhs.compiled_context.has_value() || lhs.compiled_context->dump() == rhs.compiled_context->dump()))
      && lhs.max_tokens == rhs.max_tokens;
}

bool parse_json(const nlohmann::ordered_json& j, AgentUsage& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for AgentUsage";
    return false;
  }
  static const char* const kKnownFields[] = {
      "inputTokens",
      "outputTokens",
      "latencyMs",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "AgentUsage: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    auto field_it = j.find("inputTokens");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("AgentUsage.inputTokens") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.input_tokens = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("outputTokens");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("AgentUsage.outputTokens") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.output_tokens = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("latencyMs");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("AgentUsage.latencyMs") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.latency_ms = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, AgentUsage& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const AgentUsage& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
  if (value.input_tokens.has_value()) {
    j["inputTokens"] = to_json_value(*value.input_tokens);
  }
  if (value.output_tokens.has_value()) {
    j["outputTokens"] = to_json_value(*value.output_tokens);
  }
  if (value.latency_ms.has_value()) {
    j["latencyMs"] = to_json_value(*value.latency_ms);
  }
  return j;
}

std::string dump(const AgentUsage& value) { return to_json(value).dump(2); }

bool operator==(const AgentUsage& lhs, const AgentUsage& rhs) {
  return lhs.input_tokens == rhs.input_tokens
      && lhs.output_tokens == rhs.output_tokens
      && lhs.latency_ms == rhs.latency_ms;
}

bool parse_json(const nlohmann::ordered_json& j, AgentCheckpoint& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for AgentCheckpoint";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "turnId",
      "engineId",
      "revision",
      "state",
      "createdAt",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "AgentCheckpoint: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "AgentCheckpoint");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.agent-checkpoint/v1") {
        error = std::string("AgentCheckpoint.schema") + ": expected constant " + "logicpilot.agent-checkpoint/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "AgentCheckpoint");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("AgentCheckpoint.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "turnId", "AgentCheckpoint");
      if (!value.is_string()) {
        error = std::string("AgentCheckpoint.turnId") + ": expected string";
        return false;
      }
      out.turn_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "engineId", "AgentCheckpoint");
      if (!value.is_string()) {
        error = std::string("AgentCheckpoint.engineId") + ": expected string";
        return false;
      }
      out.engine_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "revision", "AgentCheckpoint");
      if (!value.is_number_integer()) {
        error = std::string("AgentCheckpoint.revision") + ": expected integer";
        return false;
      }
      out.revision = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "state", "AgentCheckpoint");
      out.state = value;
  }
  {
    auto field_it = j.find("createdAt");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("AgentCheckpoint.createdAt") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.created_at = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, AgentCheckpoint& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const AgentCheckpoint& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["turnId"] = to_json_value(value.turn_id);
    j["engineId"] = to_json_value(value.engine_id);
    j["revision"] = to_json_value(value.revision);
    j["state"] = to_json_value(value.state);
  if (value.created_at.has_value()) {
    j["createdAt"] = to_json_value(*value.created_at);
  }
  return j;
}

std::string dump(const AgentCheckpoint& value) { return to_json(value).dump(2); }

bool operator==(const AgentCheckpoint& lhs, const AgentCheckpoint& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.turn_id == rhs.turn_id
      && lhs.engine_id == rhs.engine_id
      && lhs.revision == rhs.revision
      && lhs.state.dump() == rhs.state.dump()
      && lhs.created_at == rhs.created_at;
}

bool parse_json(const nlohmann::ordered_json& j, AgentStepResult& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for AgentStepResult";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "turnId",
      "engineId",
      "stepIndex",
      "status",
      "message",
      "toolCalls",
      "toolResults",
      "usage",
      "checkpoint",
      "error",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "AgentStepResult: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "AgentStepResult");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.agent-step-result/v1") {
        error = std::string("AgentStepResult.schema") + ": expected constant " + "logicpilot.agent-step-result/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "AgentStepResult");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("AgentStepResult.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "turnId", "AgentStepResult");
      if (!value.is_string()) {
        error = std::string("AgentStepResult.turnId") + ": expected string";
        return false;
      }
      out.turn_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "engineId", "AgentStepResult");
      if (!value.is_string()) {
        error = std::string("AgentStepResult.engineId") + ": expected string";
        return false;
      }
      out.engine_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "stepIndex", "AgentStepResult");
      if (!value.is_number_integer()) {
        error = std::string("AgentStepResult.stepIndex") + ": expected integer";
        return false;
      }
      out.step_index = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "status", "AgentStepResult");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.status, enum_error)) {
        error = std::string("AgentStepResult.status") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("message");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.message = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "toolCalls", "AgentStepResult");
      if (!value.is_array()) {
        error = std::string("AgentStepResult.toolCalls") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.tool_calls.emplace_back(), error)) {
          error = std::string("AgentStepResult.toolCalls") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "toolResults", "AgentStepResult");
      if (!value.is_array()) {
        error = std::string("AgentStepResult.toolResults") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.tool_results.emplace_back(), error)) {
          error = std::string("AgentStepResult.toolResults") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("usage");
    if (field_it != j.end()) {
      AgentUsage parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("AgentStepResult.usage") + ": " + error;
        return false;
      }
      out.usage = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("checkpoint");
    if (field_it != j.end()) {
      AgentCheckpoint parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("AgentStepResult.checkpoint") + ": " + error;
        return false;
      }
      out.checkpoint = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("error");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("AgentStepResult.error") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.error = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, AgentStepResult& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const AgentStepResult& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["turnId"] = to_json_value(value.turn_id);
    j["engineId"] = to_json_value(value.engine_id);
    j["stepIndex"] = to_json_value(value.step_index);
    j["status"] = to_json(value.status);
  if (value.message.has_value()) {
    j["message"] = to_json_value(*value.message);
  }
    j["toolCalls"] = to_json_value(value.tool_calls);
    j["toolResults"] = to_json_value(value.tool_results);
  if (value.usage.has_value()) {
    j["usage"] = to_json(*value.usage);
  }
  if (value.checkpoint.has_value()) {
    j["checkpoint"] = to_json(*value.checkpoint);
  }
  if (value.error.has_value()) {
    j["error"] = to_json_value(*value.error);
  }
  return j;
}

std::string dump(const AgentStepResult& value) { return to_json(value).dump(2); }

bool operator==(const AgentStepResult& lhs, const AgentStepResult& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.turn_id == rhs.turn_id
      && lhs.engine_id == rhs.engine_id
      && lhs.step_index == rhs.step_index
      && lhs.status == rhs.status
      && (lhs.message.has_value() == rhs.message.has_value()
      && (!lhs.message.has_value() || lhs.message->dump() == rhs.message->dump()))
      && lhs.tool_calls == rhs.tool_calls
      && lhs.tool_results == rhs.tool_results
      && lhs.usage == rhs.usage
      && lhs.checkpoint == rhs.checkpoint
      && lhs.error == rhs.error;
}

bool parse_json(const nlohmann::ordered_json& j, AgentEngineDescriptor& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for AgentEngineDescriptor";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "implementation",
      "config",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "AgentEngineDescriptor: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "AgentEngineDescriptor");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.agent-engine-descriptor/v1") {
        error = std::string("AgentEngineDescriptor.schema") + ": expected constant " + "logicpilot.agent-engine-descriptor/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "AgentEngineDescriptor");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("AgentEngineDescriptor.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "AgentEngineDescriptor");
      if (!value.is_string()) {
        error = std::string("AgentEngineDescriptor.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "implementation", "AgentEngineDescriptor");
      if (!value.is_string()) {
        error = std::string("AgentEngineDescriptor.implementation") + ": expected string";
        return false;
      }
      out.implementation = value.get<std::string>();
  }
  {
    auto field_it = j.find("config");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.config = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, AgentEngineDescriptor& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const AgentEngineDescriptor& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["implementation"] = to_json_value(value.implementation);
  if (value.config.has_value()) {
    j["config"] = to_json_value(*value.config);
  }
  return j;
}

std::string dump(const AgentEngineDescriptor& value) { return to_json(value).dump(2); }

bool operator==(const AgentEngineDescriptor& lhs, const AgentEngineDescriptor& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.implementation == rhs.implementation
      && (lhs.config.has_value() == rhs.config.has_value()
      && (!lhs.config.has_value() || lhs.config->dump() == rhs.config->dump()));
}

bool parse_json(const nlohmann::ordered_json& j, ArtifactRef& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ArtifactRef";
    return false;
  }
  static const char* const kKnownFields[] = {
      "artifactId",
      "revisionId",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ArtifactRef: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "artifactId", "ArtifactRef");
      if (!value.is_string()) {
        error = std::string("ArtifactRef.artifactId") + ": expected string";
        return false;
      }
      out.artifact_id = value.get<std::string>();
  }
  {
    auto field_it = j.find("revisionId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ArtifactRef.revisionId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.revision_id = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ArtifactRef& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ArtifactRef& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["artifactId"] = to_json_value(value.artifact_id);
  if (value.revision_id.has_value()) {
    j["revisionId"] = to_json_value(*value.revision_id);
  }
  return j;
}

std::string dump(const ArtifactRef& value) { return to_json(value).dump(2); }

bool operator==(const ArtifactRef& lhs, const ArtifactRef& rhs) {
  return lhs.artifact_id == rhs.artifact_id
      && lhs.revision_id == rhs.revision_id;
}

bool parse_json(const nlohmann::ordered_json& j, Artifact& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for Artifact";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "kind",
      "projectId",
      "createdAt",
      "createdBy",
      "metadata",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "Artifact: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "Artifact");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.artifact/v1") {
        error = std::string("Artifact.schema") + ": expected constant " + "logicpilot.artifact/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "Artifact");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("Artifact.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "Artifact");
      if (!value.is_string()) {
        error = std::string("Artifact.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "kind", "Artifact");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.kind, enum_error)) {
        error = std::string("Artifact.kind") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("projectId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Artifact.projectId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.project_id = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "createdAt", "Artifact");
      if (!value.is_string()) {
        error = std::string("Artifact.createdAt") + ": expected string";
        return false;
      }
      out.created_at = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "createdBy", "Artifact");
      if (!value.is_string()) {
        error = std::string("Artifact.createdBy") + ": expected string";
        return false;
      }
      out.created_by = value.get<std::string>();
  }
  {
    auto field_it = j.find("metadata");
    if (field_it != j.end()) {
      std::map<std::string, std::string> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("Artifact.metadata") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        if (!entry_it.value().is_string()) {
          error = std::string("Artifact.metadata") + ": expected string item";
          return false;
        }
        parsed[entry_it.key()] = entry_it.value().get<std::string>();
      }
      out.metadata = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, Artifact& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const Artifact& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["kind"] = to_json(value.kind);
  if (value.project_id.has_value()) {
    j["projectId"] = to_json_value(*value.project_id);
  }
    j["createdAt"] = to_json_value(value.created_at);
    j["createdBy"] = to_json_value(value.created_by);
  if (value.metadata.has_value()) {
    j["metadata"] = to_json_value(*value.metadata);
  }
  return j;
}

std::string dump(const Artifact& value) { return to_json(value).dump(2); }

bool operator==(const Artifact& lhs, const Artifact& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.kind == rhs.kind
      && lhs.project_id == rhs.project_id
      && lhs.created_at == rhs.created_at
      && lhs.created_by == rhs.created_by
      && lhs.metadata == rhs.metadata;
}

bool parse_json(const nlohmann::ordered_json& j, TypedOperation& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for TypedOperation";
    return false;
  }
  static const char* const kKnownFields[] = {
      "opId",
      "opType",
      "target",
      "payload",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "TypedOperation: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "opId", "TypedOperation");
      if (!value.is_string()) {
        error = std::string("TypedOperation.opId") + ": expected string";
        return false;
      }
      out.op_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "opType", "TypedOperation");
      if (!value.is_string()) {
        error = std::string("TypedOperation.opType") + ": expected string";
        return false;
      }
      out.op_type = value.get<std::string>();
  }
  {
    auto field_it = j.find("target");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("TypedOperation.target") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.target = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "payload", "TypedOperation");
      out.payload = value;
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, TypedOperation& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const TypedOperation& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["opId"] = to_json_value(value.op_id);
    j["opType"] = to_json_value(value.op_type);
  if (value.target.has_value()) {
    j["target"] = to_json_value(*value.target);
  }
    j["payload"] = to_json_value(value.payload);
  return j;
}

std::string dump(const TypedOperation& value) { return to_json(value).dump(2); }

bool operator==(const TypedOperation& lhs, const TypedOperation& rhs) {
  return lhs.op_id == rhs.op_id
      && lhs.op_type == rhs.op_type
      && lhs.target == rhs.target
      && lhs.payload.dump() == rhs.payload.dump();
}

bool parse_json(const nlohmann::ordered_json& j, Revision& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for Revision";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "artifactId",
      "parentRevisionId",
      "createdAt",
      "createdBy",
      "operations",
      "digest",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "Revision: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "Revision");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.revision/v1") {
        error = std::string("Revision.schema") + ": expected constant " + "logicpilot.revision/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "Revision");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("Revision.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "Revision");
      if (!value.is_string()) {
        error = std::string("Revision.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "artifactId", "Revision");
      if (!value.is_string()) {
        error = std::string("Revision.artifactId") + ": expected string";
        return false;
      }
      out.artifact_id = value.get<std::string>();
  }
  {
    auto field_it = j.find("parentRevisionId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Revision.parentRevisionId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.parent_revision_id = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "createdAt", "Revision");
      if (!value.is_string()) {
        error = std::string("Revision.createdAt") + ": expected string";
        return false;
      }
      out.created_at = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "createdBy", "Revision");
      if (!value.is_string()) {
        error = std::string("Revision.createdBy") + ": expected string";
        return false;
      }
      out.created_by = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "operations", "Revision");
      if (!value.is_array()) {
        error = std::string("Revision.operations") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.operations.emplace_back(), error)) {
          error = std::string("Revision.operations") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "digest", "Revision");
      if (!value.is_string()) {
        error = std::string("Revision.digest") + ": expected string";
        return false;
      }
      out.digest = value.get<std::string>();
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, Revision& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const Revision& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["artifactId"] = to_json_value(value.artifact_id);
  if (value.parent_revision_id.has_value()) {
    j["parentRevisionId"] = to_json_value(*value.parent_revision_id);
  }
    j["createdAt"] = to_json_value(value.created_at);
    j["createdBy"] = to_json_value(value.created_by);
    j["operations"] = to_json_value(value.operations);
    j["digest"] = to_json_value(value.digest);
  return j;
}

std::string dump(const Revision& value) { return to_json(value).dump(2); }

bool operator==(const Revision& lhs, const Revision& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.artifact_id == rhs.artifact_id
      && lhs.parent_revision_id == rhs.parent_revision_id
      && lhs.created_at == rhs.created_at
      && lhs.created_by == rhs.created_by
      && lhs.operations == rhs.operations
      && lhs.digest == rhs.digest;
}

bool parse_json(const nlohmann::ordered_json& j, Relation& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for Relation";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "kind",
      "from",
      "to",
      "metadata",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "Relation: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "Relation");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.relation/v1") {
        error = std::string("Relation.schema") + ": expected constant " + "logicpilot.relation/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "Relation");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("Relation.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "Relation");
      if (!value.is_string()) {
        error = std::string("Relation.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "kind", "Relation");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.kind, enum_error)) {
        error = std::string("Relation.kind") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "from", "Relation");
      if (!parse_json(value, out.from, error)) {
        error = std::string("Relation.from") + ": " + error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "to", "Relation");
      if (!parse_json(value, out.to, error)) {
        error = std::string("Relation.to") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("metadata");
    if (field_it != j.end()) {
      std::map<std::string, std::string> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("Relation.metadata") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        if (!entry_it.value().is_string()) {
          error = std::string("Relation.metadata") + ": expected string item";
          return false;
        }
        parsed[entry_it.key()] = entry_it.value().get<std::string>();
      }
      out.metadata = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, Relation& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const Relation& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["kind"] = to_json(value.kind);
    j["from"] = to_json(value.from);
    j["to"] = to_json(value.to);
  if (value.metadata.has_value()) {
    j["metadata"] = to_json_value(*value.metadata);
  }
  return j;
}

std::string dump(const Relation& value) { return to_json(value).dump(2); }

bool operator==(const Relation& lhs, const Relation& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.kind == rhs.kind
      && lhs.from == rhs.from
      && lhs.to == rhs.to
      && lhs.metadata == rhs.metadata;
}

bool parse_json(const nlohmann::ordered_json& j, Transaction& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for Transaction";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "status",
      "proposedBy",
      "approvedBy",
      "artifactRefs",
      "operations",
      "committedRevisionId",
      "createdAt",
      "resolutionRecord",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "Transaction: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "Transaction");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.transaction/v1") {
        error = std::string("Transaction.schema") + ": expected constant " + "logicpilot.transaction/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "Transaction");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("Transaction.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "Transaction");
      if (!value.is_string()) {
        error = std::string("Transaction.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "status", "Transaction");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.status, enum_error)) {
        error = std::string("Transaction.status") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "proposedBy", "Transaction");
      if (!value.is_string()) {
        error = std::string("Transaction.proposedBy") + ": expected string";
        return false;
      }
      out.proposed_by = value.get<std::string>();
  }
  {
    auto field_it = j.find("approvedBy");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Transaction.approvedBy") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.approved_by = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "artifactRefs", "Transaction");
      if (!value.is_array()) {
        error = std::string("Transaction.artifactRefs") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.artifact_refs.emplace_back(), error)) {
          error = std::string("Transaction.artifactRefs") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "operations", "Transaction");
      if (!value.is_array()) {
        error = std::string("Transaction.operations") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.operations.emplace_back(), error)) {
          error = std::string("Transaction.operations") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("committedRevisionId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Transaction.committedRevisionId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.committed_revision_id = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("createdAt");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Transaction.createdAt") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.created_at = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("resolutionRecord");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Transaction.resolutionRecord") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.resolution_record = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, Transaction& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const Transaction& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["status"] = to_json(value.status);
    j["proposedBy"] = to_json_value(value.proposed_by);
  if (value.approved_by.has_value()) {
    j["approvedBy"] = to_json_value(*value.approved_by);
  }
    j["artifactRefs"] = to_json_value(value.artifact_refs);
    j["operations"] = to_json_value(value.operations);
  if (value.committed_revision_id.has_value()) {
    j["committedRevisionId"] = to_json_value(*value.committed_revision_id);
  }
  if (value.created_at.has_value()) {
    j["createdAt"] = to_json_value(*value.created_at);
  }
  if (value.resolution_record.has_value()) {
    j["resolutionRecord"] = to_json_value(*value.resolution_record);
  }
  return j;
}

std::string dump(const Transaction& value) { return to_json(value).dump(2); }

bool operator==(const Transaction& lhs, const Transaction& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.status == rhs.status
      && lhs.proposed_by == rhs.proposed_by
      && lhs.approved_by == rhs.approved_by
      && lhs.artifact_refs == rhs.artifact_refs
      && lhs.operations == rhs.operations
      && lhs.committed_revision_id == rhs.committed_revision_id
      && lhs.created_at == rhs.created_at
      && lhs.resolution_record == rhs.resolution_record;
}

bool parse_json(const nlohmann::ordered_json& j, Provenance& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for Provenance";
    return false;
  }
  static const char* const kKnownFields[] = {
      "source",
      "reference",
      "locator",
      "confidence",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "Provenance: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "source", "Provenance");
      if (!value.is_string()) {
        error = std::string("Provenance.source") + ": expected string";
        return false;
      }
      out.source = value.get<std::string>();
  }
  {
    auto field_it = j.find("reference");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Provenance.reference") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.reference = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("locator");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("Provenance.locator") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.locator = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("confidence");
    if (field_it != j.end()) {
      double parsed{};
      if (!(*field_it).is_number()) {
        error = std::string("Provenance.confidence") + ": expected number";
        return false;
      }
      parsed = (*field_it).get<double>();
      out.confidence = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, Provenance& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const Provenance& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["source"] = to_json_value(value.source);
  if (value.reference.has_value()) {
    j["reference"] = to_json_value(*value.reference);
  }
  if (value.locator.has_value()) {
    j["locator"] = to_json_value(*value.locator);
  }
  if (value.confidence.has_value()) {
    j["confidence"] = to_json_value(*value.confidence);
  }
  return j;
}

std::string dump(const Provenance& value) { return to_json(value).dump(2); }

bool operator==(const Provenance& lhs, const Provenance& rhs) {
  return lhs.source == rhs.source
      && lhs.reference == rhs.reference
      && lhs.locator == rhs.locator
      && lhs.confidence == rhs.confidence;
}

bool parse_json(const nlohmann::ordered_json& j, DiagnosticDefinition& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for DiagnosticDefinition";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "pluginId",
      "constraintId",
      "titleKey",
      "parameterSchema",
      "defaultSeverity",
      "explanationBlockId",
      "fixIds",
      "appliesToParadigms",
      "minPluginVersion",
      "conformanceCases",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "DiagnosticDefinition: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "DiagnosticDefinition");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.diagnostic-definition/v1") {
        error = std::string("DiagnosticDefinition.schema") + ": expected constant " + "logicpilot.diagnostic-definition/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "DiagnosticDefinition");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("DiagnosticDefinition.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "DiagnosticDefinition");
      if (!value.is_string()) {
        error = std::string("DiagnosticDefinition.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "pluginId", "DiagnosticDefinition");
      if (!value.is_string()) {
        error = std::string("DiagnosticDefinition.pluginId") + ": expected string";
        return false;
      }
      out.plugin_id = value.get<std::string>();
  }
  {
    auto field_it = j.find("constraintId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("DiagnosticDefinition.constraintId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.constraint_id = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "titleKey", "DiagnosticDefinition");
      if (!value.is_string()) {
        error = std::string("DiagnosticDefinition.titleKey") + ": expected string";
        return false;
      }
      out.title_key = value.get<std::string>();
  }
  {
    auto field_it = j.find("parameterSchema");
    if (field_it != j.end()) {
      JsonSchemaFragment parsed{};
      parsed = (*field_it);
      out.parameter_schema = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "defaultSeverity", "DiagnosticDefinition");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.default_severity, enum_error)) {
        error = std::string("DiagnosticDefinition.defaultSeverity") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("explanationBlockId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("DiagnosticDefinition.explanationBlockId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.explanation_block_id = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "fixIds", "DiagnosticDefinition");
      if (!value.is_array()) {
        error = std::string("DiagnosticDefinition.fixIds") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!item.is_string()) {
          error = std::string("DiagnosticDefinition.fixIds") + ": expected string item";
          return false;
        }
        out.fix_ids.emplace_back() = item.get<std::string>();
      }
  }
  {
    auto field_it = j.find("appliesToParadigms");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("DiagnosticDefinition.appliesToParadigms") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("DiagnosticDefinition.appliesToParadigms") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.applies_to_paradigms = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("minPluginVersion");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("DiagnosticDefinition.minPluginVersion") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.min_plugin_version = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("conformanceCases");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("DiagnosticDefinition.conformanceCases") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("DiagnosticDefinition.conformanceCases") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.conformance_cases = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, DiagnosticDefinition& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const DiagnosticDefinition& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["pluginId"] = to_json_value(value.plugin_id);
  if (value.constraint_id.has_value()) {
    j["constraintId"] = to_json_value(*value.constraint_id);
  }
    j["titleKey"] = to_json_value(value.title_key);
  if (value.parameter_schema.has_value()) {
    j["parameterSchema"] = to_json_value(*value.parameter_schema);
  }
    j["defaultSeverity"] = to_json(value.default_severity);
  if (value.explanation_block_id.has_value()) {
    j["explanationBlockId"] = to_json_value(*value.explanation_block_id);
  }
    j["fixIds"] = to_json_value(value.fix_ids);
  if (value.applies_to_paradigms.has_value()) {
    j["appliesToParadigms"] = to_json_value(*value.applies_to_paradigms);
  }
  if (value.min_plugin_version.has_value()) {
    j["minPluginVersion"] = to_json_value(*value.min_plugin_version);
  }
  if (value.conformance_cases.has_value()) {
    j["conformanceCases"] = to_json_value(*value.conformance_cases);
  }
  return j;
}

std::string dump(const DiagnosticDefinition& value) { return to_json(value).dump(2); }

bool operator==(const DiagnosticDefinition& lhs, const DiagnosticDefinition& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.plugin_id == rhs.plugin_id
      && lhs.constraint_id == rhs.constraint_id
      && lhs.title_key == rhs.title_key
      && (lhs.parameter_schema.has_value() == rhs.parameter_schema.has_value()
      && (!lhs.parameter_schema.has_value() || lhs.parameter_schema->dump() == rhs.parameter_schema->dump()))
      && lhs.default_severity == rhs.default_severity
      && lhs.explanation_block_id == rhs.explanation_block_id
      && lhs.fix_ids == rhs.fix_ids
      && lhs.applies_to_paradigms == rhs.applies_to_paradigms
      && lhs.min_plugin_version == rhs.min_plugin_version
      && lhs.conformance_cases == rhs.conformance_cases;
}

bool parse_json(const nlohmann::ordered_json& j, FixDefinition& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for FixDefinition";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "definitionId",
      "kind",
      "titleKey",
      "parameters",
      "recipe",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "FixDefinition: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "FixDefinition");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.fix-definition/v1") {
        error = std::string("FixDefinition.schema") + ": expected constant " + "logicpilot.fix-definition/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "FixDefinition");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("FixDefinition.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "FixDefinition");
      if (!value.is_string()) {
        error = std::string("FixDefinition.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "definitionId", "FixDefinition");
      if (!value.is_string()) {
        error = std::string("FixDefinition.definitionId") + ": expected string";
        return false;
      }
      out.definition_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "kind", "FixDefinition");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.kind, enum_error)) {
        error = std::string("FixDefinition.kind") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "titleKey", "FixDefinition");
      if (!value.is_string()) {
        error = std::string("FixDefinition.titleKey") + ": expected string";
        return false;
      }
      out.title_key = value.get<std::string>();
  }
  {
    auto field_it = j.find("parameters");
    if (field_it != j.end()) {
      JsonSchemaFragment parsed{};
      parsed = (*field_it);
      out.parameters = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("recipe");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.recipe = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, FixDefinition& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const FixDefinition& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["definitionId"] = to_json_value(value.definition_id);
    j["kind"] = to_json(value.kind);
    j["titleKey"] = to_json_value(value.title_key);
  if (value.parameters.has_value()) {
    j["parameters"] = to_json_value(*value.parameters);
  }
  if (value.recipe.has_value()) {
    j["recipe"] = to_json_value(*value.recipe);
  }
  return j;
}

std::string dump(const FixDefinition& value) { return to_json(value).dump(2); }

bool operator==(const FixDefinition& lhs, const FixDefinition& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.definition_id == rhs.definition_id
      && lhs.kind == rhs.kind
      && lhs.title_key == rhs.title_key
      && (lhs.parameters.has_value() == rhs.parameters.has_value()
      && (!lhs.parameters.has_value() || lhs.parameters->dump() == rhs.parameters->dump()))
      && (lhs.recipe.has_value() == rhs.recipe.has_value()
      && (!lhs.recipe.has_value() || lhs.recipe->dump() == rhs.recipe->dump()));
}

bool parse_json(const nlohmann::ordered_json& j, SourceSpan& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for SourceSpan";
    return false;
  }
  static const char* const kKnownFields[] = {
      "startLine",
      "startColumn",
      "endLine",
      "endColumn",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "SourceSpan: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "startLine", "SourceSpan");
      if (!value.is_number_integer()) {
        error = std::string("SourceSpan.startLine") + ": expected integer";
        return false;
      }
      out.start_line = value.get<std::int64_t>();
  }
  {
    auto field_it = j.find("startColumn");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("SourceSpan.startColumn") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.start_column = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("endLine");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("SourceSpan.endLine") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.end_line = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("endColumn");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("SourceSpan.endColumn") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.end_column = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, SourceSpan& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const SourceSpan& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["startLine"] = to_json_value(value.start_line);
  if (value.start_column.has_value()) {
    j["startColumn"] = to_json_value(*value.start_column);
  }
  if (value.end_line.has_value()) {
    j["endLine"] = to_json_value(*value.end_line);
  }
  if (value.end_column.has_value()) {
    j["endColumn"] = to_json_value(*value.end_column);
  }
  return j;
}

std::string dump(const SourceSpan& value) { return to_json(value).dump(2); }

bool operator==(const SourceSpan& lhs, const SourceSpan& rhs) {
  return lhs.start_line == rhs.start_line
      && lhs.start_column == rhs.start_column
      && lhs.end_line == rhs.end_line
      && lhs.end_column == rhs.end_column;
}

bool parse_json(const nlohmann::ordered_json& j, DiagnosticInstance& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for DiagnosticInstance";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "definitionId",
      "artifactRef",
      "elementId",
      "sourceSpan",
      "parameterBindings",
      "evidenceRefs",
      "phase",
      "severity",
      "availableFixIds",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "DiagnosticInstance: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "DiagnosticInstance");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.diagnostic-instance/v1") {
        error = std::string("DiagnosticInstance.schema") + ": expected constant " + "logicpilot.diagnostic-instance/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "DiagnosticInstance");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("DiagnosticInstance.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "definitionId", "DiagnosticInstance");
      if (!value.is_string()) {
        error = std::string("DiagnosticInstance.definitionId") + ": expected string";
        return false;
      }
      out.definition_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "artifactRef", "DiagnosticInstance");
      if (!parse_json(value, out.artifact_ref, error)) {
        error = std::string("DiagnosticInstance.artifactRef") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("elementId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("DiagnosticInstance.elementId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.element_id = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("sourceSpan");
    if (field_it != j.end()) {
      SourceSpan parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("DiagnosticInstance.sourceSpan") + ": " + error;
        return false;
      }
      out.source_span = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("parameterBindings");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.parameter_bindings = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("evidenceRefs");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("DiagnosticInstance.evidenceRefs") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("DiagnosticInstance.evidenceRefs") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.evidence_refs = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("phase");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("DiagnosticInstance.phase") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.phase = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("severity");
    if (field_it != j.end()) {
      Severity parsed{};
      std::string enum_error;
      if (!parse((*field_it).get<std::string>(), parsed, enum_error)) {
        error = std::string("DiagnosticInstance.severity") + ": " + enum_error;
        return false;
      }
      out.severity = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("availableFixIds");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("DiagnosticInstance.availableFixIds") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("DiagnosticInstance.availableFixIds") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.available_fix_ids = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, DiagnosticInstance& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const DiagnosticInstance& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["definitionId"] = to_json_value(value.definition_id);
    j["artifactRef"] = to_json(value.artifact_ref);
  if (value.element_id.has_value()) {
    j["elementId"] = to_json_value(*value.element_id);
  }
  if (value.source_span.has_value()) {
    j["sourceSpan"] = to_json(*value.source_span);
  }
  if (value.parameter_bindings.has_value()) {
    j["parameterBindings"] = to_json_value(*value.parameter_bindings);
  }
  if (value.evidence_refs.has_value()) {
    j["evidenceRefs"] = to_json_value(*value.evidence_refs);
  }
  if (value.phase.has_value()) {
    j["phase"] = to_json_value(*value.phase);
  }
  if (value.severity.has_value()) {
    j["severity"] = to_json(*value.severity);
  }
  if (value.available_fix_ids.has_value()) {
    j["availableFixIds"] = to_json_value(*value.available_fix_ids);
  }
  return j;
}

std::string dump(const DiagnosticInstance& value) { return to_json(value).dump(2); }

bool operator==(const DiagnosticInstance& lhs, const DiagnosticInstance& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.definition_id == rhs.definition_id
      && lhs.artifact_ref == rhs.artifact_ref
      && lhs.element_id == rhs.element_id
      && lhs.source_span == rhs.source_span
      && (lhs.parameter_bindings.has_value() == rhs.parameter_bindings.has_value()
      && (!lhs.parameter_bindings.has_value() || lhs.parameter_bindings->dump() == rhs.parameter_bindings->dump()))
      && lhs.evidence_refs == rhs.evidence_refs
      && lhs.phase == rhs.phase
      && lhs.severity == rhs.severity
      && lhs.available_fix_ids == rhs.available_fix_ids;
}

bool parse_json(const nlohmann::ordered_json& j, RuntimeRef& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for RuntimeRef";
    return false;
  }
  static const char* const kKnownFields[] = {
      "kind",
      "pluginId",
      "capability",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "RuntimeRef: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "kind", "RuntimeRef");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.kind, enum_error)) {
        error = std::string("RuntimeRef.kind") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("pluginId");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("RuntimeRef.pluginId") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.plugin_id = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("capability");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("RuntimeRef.capability") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.capability = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, RuntimeRef& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const RuntimeRef& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["kind"] = to_json(value.kind);
  if (value.plugin_id.has_value()) {
    j["pluginId"] = to_json_value(*value.plugin_id);
  }
  if (value.capability.has_value()) {
    j["capability"] = to_json_value(*value.capability);
  }
  return j;
}

std::string dump(const RuntimeRef& value) { return to_json(value).dump(2); }

bool operator==(const RuntimeRef& lhs, const RuntimeRef& rhs) {
  return lhs.kind == rhs.kind
      && lhs.plugin_id == rhs.plugin_id
      && lhs.capability == rhs.capability;
}

bool parse_json(const nlohmann::ordered_json& j, ExecutionTarget& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ExecutionTarget";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "titleKey",
      "artifactRef",
      "runtime",
      "options",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ExecutionTarget: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "ExecutionTarget");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.execution-target/v1") {
        error = std::string("ExecutionTarget.schema") + ": expected constant " + "logicpilot.execution-target/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "ExecutionTarget");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("ExecutionTarget.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "ExecutionTarget");
      if (!value.is_string()) {
        error = std::string("ExecutionTarget.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    auto field_it = j.find("titleKey");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ExecutionTarget.titleKey") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.title_key = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "artifactRef", "ExecutionTarget");
      if (!parse_json(value, out.artifact_ref, error)) {
        error = std::string("ExecutionTarget.artifactRef") + ": " + error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "runtime", "ExecutionTarget");
      if (!parse_json(value, out.runtime, error)) {
        error = std::string("ExecutionTarget.runtime") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("options");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.options = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ExecutionTarget& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ExecutionTarget& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
  if (value.title_key.has_value()) {
    j["titleKey"] = to_json_value(*value.title_key);
  }
    j["artifactRef"] = to_json(value.artifact_ref);
    j["runtime"] = to_json(value.runtime);
  if (value.options.has_value()) {
    j["options"] = to_json_value(*value.options);
  }
  return j;
}

std::string dump(const ExecutionTarget& value) { return to_json(value).dump(2); }

bool operator==(const ExecutionTarget& lhs, const ExecutionTarget& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.title_key == rhs.title_key
      && lhs.artifact_ref == rhs.artifact_ref
      && lhs.runtime == rhs.runtime
      && (lhs.options.has_value() == rhs.options.has_value()
      && (!lhs.options.has_value() || lhs.options->dump() == rhs.options->dump()));
}

bool parse_json(const nlohmann::ordered_json& j, ExecutionBudget& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ExecutionBudget";
    return false;
  }
  static const char* const kKnownFields[] = {
      "maxSteps",
      "maxWallMs",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ExecutionBudget: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    auto field_it = j.find("maxSteps");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("ExecutionBudget.maxSteps") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.max_steps = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("maxWallMs");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("ExecutionBudget.maxWallMs") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.max_wall_ms = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ExecutionBudget& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ExecutionBudget& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
  if (value.max_steps.has_value()) {
    j["maxSteps"] = to_json_value(*value.max_steps);
  }
  if (value.max_wall_ms.has_value()) {
    j["maxWallMs"] = to_json_value(*value.max_wall_ms);
  }
  return j;
}

std::string dump(const ExecutionBudget& value) { return to_json(value).dump(2); }

bool operator==(const ExecutionBudget& lhs, const ExecutionBudget& rhs) {
  return lhs.max_steps == rhs.max_steps
      && lhs.max_wall_ms == rhs.max_wall_ms;
}

bool parse_json(const nlohmann::ordered_json& j, ExecutionRequest& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ExecutionRequest";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "requestId",
      "targetId",
      "seed",
      "inputs",
      "budget",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ExecutionRequest: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "ExecutionRequest");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.execution-request/v1") {
        error = std::string("ExecutionRequest.schema") + ": expected constant " + "logicpilot.execution-request/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "ExecutionRequest");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("ExecutionRequest.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "requestId", "ExecutionRequest");
      if (!value.is_string()) {
        error = std::string("ExecutionRequest.requestId") + ": expected string";
        return false;
      }
      out.request_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "targetId", "ExecutionRequest");
      if (!value.is_string()) {
        error = std::string("ExecutionRequest.targetId") + ": expected string";
        return false;
      }
      out.target_id = value.get<std::string>();
  }
  {
    auto field_it = j.find("seed");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("ExecutionRequest.seed") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.seed = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("inputs");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.inputs = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("budget");
    if (field_it != j.end()) {
      ExecutionBudget parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("ExecutionRequest.budget") + ": " + error;
        return false;
      }
      out.budget = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ExecutionRequest& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ExecutionRequest& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["requestId"] = to_json_value(value.request_id);
    j["targetId"] = to_json_value(value.target_id);
  if (value.seed.has_value()) {
    j["seed"] = to_json_value(*value.seed);
  }
  if (value.inputs.has_value()) {
    j["inputs"] = to_json_value(*value.inputs);
  }
  if (value.budget.has_value()) {
    j["budget"] = to_json(*value.budget);
  }
  return j;
}

std::string dump(const ExecutionRequest& value) { return to_json(value).dump(2); }

bool operator==(const ExecutionRequest& lhs, const ExecutionRequest& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.request_id == rhs.request_id
      && lhs.target_id == rhs.target_id
      && lhs.seed == rhs.seed
      && (lhs.inputs.has_value() == rhs.inputs.has_value()
      && (!lhs.inputs.has_value() || lhs.inputs->dump() == rhs.inputs->dump()))
      && lhs.budget == rhs.budget;
}

bool parse_json(const nlohmann::ordered_json& j, ExecutionRun& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ExecutionRun";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "runId",
      "requestId",
      "targetId",
      "artifactRef",
      "status",
      "seed",
      "evidenceRef",
      "startedAt",
      "finishedAt",
      "error",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ExecutionRun: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "ExecutionRun");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.execution-run/v1") {
        error = std::string("ExecutionRun.schema") + ": expected constant " + "logicpilot.execution-run/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "ExecutionRun");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("ExecutionRun.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "runId", "ExecutionRun");
      if (!value.is_string()) {
        error = std::string("ExecutionRun.runId") + ": expected string";
        return false;
      }
      out.run_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "requestId", "ExecutionRun");
      if (!value.is_string()) {
        error = std::string("ExecutionRun.requestId") + ": expected string";
        return false;
      }
      out.request_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "targetId", "ExecutionRun");
      if (!value.is_string()) {
        error = std::string("ExecutionRun.targetId") + ": expected string";
        return false;
      }
      out.target_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "artifactRef", "ExecutionRun");
      if (!parse_json(value, out.artifact_ref, error)) {
        error = std::string("ExecutionRun.artifactRef") + ": " + error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "status", "ExecutionRun");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.status, enum_error)) {
        error = std::string("ExecutionRun.status") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("seed");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("ExecutionRun.seed") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.seed = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("evidenceRef");
    if (field_it != j.end()) {
      ArtifactRef parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("ExecutionRun.evidenceRef") + ": " + error;
        return false;
      }
      out.evidence_ref = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("startedAt");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ExecutionRun.startedAt") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.started_at = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("finishedAt");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ExecutionRun.finishedAt") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.finished_at = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("error");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("ExecutionRun.error") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.error = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ExecutionRun& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ExecutionRun& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["runId"] = to_json_value(value.run_id);
    j["requestId"] = to_json_value(value.request_id);
    j["targetId"] = to_json_value(value.target_id);
    j["artifactRef"] = to_json(value.artifact_ref);
    j["status"] = to_json(value.status);
  if (value.seed.has_value()) {
    j["seed"] = to_json_value(*value.seed);
  }
  if (value.evidence_ref.has_value()) {
    j["evidenceRef"] = to_json(*value.evidence_ref);
  }
  if (value.started_at.has_value()) {
    j["startedAt"] = to_json_value(*value.started_at);
  }
  if (value.finished_at.has_value()) {
    j["finishedAt"] = to_json_value(*value.finished_at);
  }
  if (value.error.has_value()) {
    j["error"] = to_json_value(*value.error);
  }
  return j;
}

std::string dump(const ExecutionRun& value) { return to_json(value).dump(2); }

bool operator==(const ExecutionRun& lhs, const ExecutionRun& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.run_id == rhs.run_id
      && lhs.request_id == rhs.request_id
      && lhs.target_id == rhs.target_id
      && lhs.artifact_ref == rhs.artifact_ref
      && lhs.status == rhs.status
      && lhs.seed == rhs.seed
      && lhs.evidence_ref == rhs.evidence_ref
      && lhs.started_at == rhs.started_at
      && lhs.finished_at == rhs.finished_at
      && lhs.error == rhs.error;
}

bool parse_json(const nlohmann::ordered_json& j, ExecutionEvidence& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ExecutionEvidence";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "runId",
      "digest",
      "traceRef",
      "metrics",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ExecutionEvidence: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "ExecutionEvidence");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.execution-evidence/v1") {
        error = std::string("ExecutionEvidence.schema") + ": expected constant " + "logicpilot.execution-evidence/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "ExecutionEvidence");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("ExecutionEvidence.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "runId", "ExecutionEvidence");
      if (!value.is_string()) {
        error = std::string("ExecutionEvidence.runId") + ": expected string";
        return false;
      }
      out.run_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "digest", "ExecutionEvidence");
      if (!value.is_string()) {
        error = std::string("ExecutionEvidence.digest") + ": expected string";
        return false;
      }
      out.digest = value.get<std::string>();
  }
  {
    auto field_it = j.find("traceRef");
    if (field_it != j.end()) {
      ArtifactRef parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("ExecutionEvidence.traceRef") + ": " + error;
        return false;
      }
      out.trace_ref = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("metrics");
    if (field_it != j.end()) {
      std::map<std::string, double> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("ExecutionEvidence.metrics") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        if (!entry_it.value().is_number()) {
          error = std::string("ExecutionEvidence.metrics") + ": expected number item";
          return false;
        }
        parsed[entry_it.key()] = entry_it.value().get<double>();
      }
      out.metrics = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ExecutionEvidence& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ExecutionEvidence& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["runId"] = to_json_value(value.run_id);
    j["digest"] = to_json_value(value.digest);
  if (value.trace_ref.has_value()) {
    j["traceRef"] = to_json(*value.trace_ref);
  }
  if (value.metrics.has_value()) {
    j["metrics"] = to_json_value(*value.metrics);
  }
  return j;
}

std::string dump(const ExecutionEvidence& value) { return to_json(value).dump(2); }

bool operator==(const ExecutionEvidence& lhs, const ExecutionEvidence& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.run_id == rhs.run_id
      && lhs.digest == rhs.digest
      && lhs.trace_ref == rhs.trace_ref
      && lhs.metrics == rhs.metrics;
}

bool parse_json(const nlohmann::ordered_json& j, KnowledgeBlockRef& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for KnowledgeBlockRef";
    return false;
  }
  static const char* const kKnownFields[] = {
      "id",
      "version",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "KnowledgeBlockRef: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "id", "KnowledgeBlockRef");
      if (!value.is_string()) {
        error = std::string("KnowledgeBlockRef.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    auto field_it = j.find("version");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("KnowledgeBlockRef.version") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.version = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, KnowledgeBlockRef& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const KnowledgeBlockRef& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["id"] = to_json_value(value.id);
  if (value.version.has_value()) {
    j["version"] = to_json_value(*value.version);
  }
  return j;
}

std::string dump(const KnowledgeBlockRef& value) { return to_json(value).dump(2); }

bool operator==(const KnowledgeBlockRef& lhs, const KnowledgeBlockRef& rhs) {
  return lhs.id == rhs.id
      && lhs.version == rhs.version;
}

bool parse_json(const nlohmann::ordered_json& j, KnowledgeScope& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for KnowledgeScope";
    return false;
  }
  static const char* const kKnownFields[] = {
      "paradigms",
      "domains",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "KnowledgeScope: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    auto field_it = j.find("paradigms");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeScope.paradigms") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("KnowledgeScope.paradigms") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.paradigms = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("domains");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeScope.domains") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("KnowledgeScope.domains") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.domains = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, KnowledgeScope& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const KnowledgeScope& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
  if (value.paradigms.has_value()) {
    j["paradigms"] = to_json_value(*value.paradigms);
  }
  if (value.domains.has_value()) {
    j["domains"] = to_json_value(*value.domains);
  }
  return j;
}

std::string dump(const KnowledgeScope& value) { return to_json(value).dump(2); }

bool operator==(const KnowledgeScope& lhs, const KnowledgeScope& rhs) {
  return lhs.paradigms == rhs.paradigms
      && lhs.domains == rhs.domains;
}

bool parse_json(const nlohmann::ordered_json& j, KnowledgeVerification& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for KnowledgeVerification";
    return false;
  }
  static const char* const kKnownFields[] = {
      "method",
      "cases",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "KnowledgeVerification: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "method", "KnowledgeVerification");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.method, enum_error)) {
        error = std::string("KnowledgeVerification.method") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("cases");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeVerification.cases") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("KnowledgeVerification.cases") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.cases = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, KnowledgeVerification& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const KnowledgeVerification& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["method"] = to_json(value.method);
  if (value.cases.has_value()) {
    j["cases"] = to_json_value(*value.cases);
  }
  return j;
}

std::string dump(const KnowledgeVerification& value) { return to_json(value).dump(2); }

bool operator==(const KnowledgeVerification& lhs, const KnowledgeVerification& rhs) {
  return lhs.method == rhs.method
      && lhs.cases == rhs.cases;
}

bool parse_json(const nlohmann::ordered_json& j, SymbolDef& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for SymbolDef";
    return false;
  }
  static const char* const kKnownFields[] = {
      "name",
      "type",
      "unit",
      "descriptionKey",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "SymbolDef: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "name", "SymbolDef");
      if (!value.is_string()) {
        error = std::string("SymbolDef.name") + ": expected string";
        return false;
      }
      out.name = value.get<std::string>();
  }
  {
    auto field_it = j.find("type");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("SymbolDef.type") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.type = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("unit");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("SymbolDef.unit") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.unit = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("descriptionKey");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("SymbolDef.descriptionKey") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.description_key = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, SymbolDef& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const SymbolDef& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["name"] = to_json_value(value.name);
  if (value.type.has_value()) {
    j["type"] = to_json_value(*value.type);
  }
  if (value.unit.has_value()) {
    j["unit"] = to_json_value(*value.unit);
  }
  if (value.description_key.has_value()) {
    j["descriptionKey"] = to_json_value(*value.description_key);
  }
  return j;
}

std::string dump(const SymbolDef& value) { return to_json(value).dump(2); }

bool operator==(const SymbolDef& lhs, const SymbolDef& rhs) {
  return lhs.name == rhs.name
      && lhs.type == rhs.type
      && lhs.unit == rhs.unit
      && lhs.description_key == rhs.description_key;
}

bool parse_json(const nlohmann::ordered_json& j, FormulaContent& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for FormulaContent";
    return false;
  }
  static const char* const kKnownFields[] = {
      "expressionAst",
      "symbolTable",
      "assumptions",
      "validDomain",
      "initialConditions",
      "boundaryConditions",
      "recommendedSolver",
      "sourceEquation",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "FormulaContent: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "expressionAst", "FormulaContent");
      out.expression_ast = value;
  }
  {
    auto field_it = j.find("symbolTable");
    if (field_it != j.end()) {
      std::map<std::string, SymbolDef> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("FormulaContent.symbolTable") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        if (!parse_json(entry_it.value(), parsed[entry_it.key()], error)) {
          error = std::string("FormulaContent.symbolTable") + ": " + error;
          return false;
        }
      }
      out.symbol_table = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("assumptions");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("FormulaContent.assumptions") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("FormulaContent.assumptions") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.assumptions = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("validDomain");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.valid_domain = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("initialConditions");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.initial_conditions = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("boundaryConditions");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.boundary_conditions = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("recommendedSolver");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("FormulaContent.recommendedSolver") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.recommended_solver = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("sourceEquation");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("FormulaContent.sourceEquation") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.source_equation = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, FormulaContent& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const FormulaContent& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["expressionAst"] = to_json_value(value.expression_ast);
  if (value.symbol_table.has_value()) {
    j["symbolTable"] = to_json_value(*value.symbol_table);
  }
  if (value.assumptions.has_value()) {
    j["assumptions"] = to_json_value(*value.assumptions);
  }
  if (value.valid_domain.has_value()) {
    j["validDomain"] = to_json_value(*value.valid_domain);
  }
  if (value.initial_conditions.has_value()) {
    j["initialConditions"] = to_json_value(*value.initial_conditions);
  }
  if (value.boundary_conditions.has_value()) {
    j["boundaryConditions"] = to_json_value(*value.boundary_conditions);
  }
  if (value.recommended_solver.has_value()) {
    j["recommendedSolver"] = to_json_value(*value.recommended_solver);
  }
  if (value.source_equation.has_value()) {
    j["sourceEquation"] = to_json_value(*value.source_equation);
  }
  return j;
}

std::string dump(const FormulaContent& value) { return to_json(value).dump(2); }

bool operator==(const FormulaContent& lhs, const FormulaContent& rhs) {
  return lhs.expression_ast.dump() == rhs.expression_ast.dump()
      && lhs.symbol_table == rhs.symbol_table
      && lhs.assumptions == rhs.assumptions
      && (lhs.valid_domain.has_value() == rhs.valid_domain.has_value()
      && (!lhs.valid_domain.has_value() || lhs.valid_domain->dump() == rhs.valid_domain->dump()))
      && (lhs.initial_conditions.has_value() == rhs.initial_conditions.has_value()
      && (!lhs.initial_conditions.has_value() || lhs.initial_conditions->dump() == rhs.initial_conditions->dump()))
      && (lhs.boundary_conditions.has_value() == rhs.boundary_conditions.has_value()
      && (!lhs.boundary_conditions.has_value() || lhs.boundary_conditions->dump() == rhs.boundary_conditions->dump()))
      && lhs.recommended_solver == rhs.recommended_solver
      && lhs.source_equation == rhs.source_equation;
}

bool parse_json(const nlohmann::ordered_json& j, KnowledgeBlock& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for KnowledgeBlock";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "version",
      "owner",
      "type",
      "classification",
      "status",
      "scope",
      "applicability",
      "dependencies",
      "conflicts",
      "supersedes",
      "provenance",
      "confidence",
      "verification",
      "localization",
      "content",
      "formula",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "KnowledgeBlock: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "KnowledgeBlock");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.knowledge-block/v1") {
        error = std::string("KnowledgeBlock.schema") + ": expected constant " + "logicpilot.knowledge-block/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "KnowledgeBlock");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("KnowledgeBlock.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "KnowledgeBlock");
      if (!value.is_string()) {
        error = std::string("KnowledgeBlock.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "version", "KnowledgeBlock");
      if (!value.is_string()) {
        error = std::string("KnowledgeBlock.version") + ": expected string";
        return false;
      }
      out.version = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "owner", "KnowledgeBlock");
      if (!value.is_string()) {
        error = std::string("KnowledgeBlock.owner") + ": expected string";
        return false;
      }
      out.owner = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "type", "KnowledgeBlock");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.type, enum_error)) {
        error = std::string("KnowledgeBlock.type") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "classification", "KnowledgeBlock");
      if (!value.is_string()) {
        error = std::string("KnowledgeBlock.classification") + ": expected string";
        return false;
      }
      out.classification = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "status", "KnowledgeBlock");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.status, enum_error)) {
        error = std::string("KnowledgeBlock.status") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("scope");
    if (field_it != j.end()) {
      KnowledgeScope parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("KnowledgeBlock.scope") + ": " + error;
        return false;
      }
      out.scope = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("applicability");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.applicability = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("dependencies");
    if (field_it != j.end()) {
      std::vector<KnowledgeBlockRef> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeBlock.dependencies") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("KnowledgeBlock.dependencies") + ": " + error;
          return false;
        }
      }
      out.dependencies = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("conflicts");
    if (field_it != j.end()) {
      std::vector<KnowledgeBlockRef> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeBlock.conflicts") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("KnowledgeBlock.conflicts") + ": " + error;
          return false;
        }
      }
      out.conflicts = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("supersedes");
    if (field_it != j.end()) {
      std::vector<KnowledgeBlockRef> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("KnowledgeBlock.supersedes") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("KnowledgeBlock.supersedes") + ": " + error;
          return false;
        }
      }
      out.supersedes = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "provenance", "KnowledgeBlock");
      if (!parse_json(value, out.provenance, error)) {
        error = std::string("KnowledgeBlock.provenance") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("confidence");
    if (field_it != j.end()) {
      double parsed{};
      if (!(*field_it).is_number()) {
        error = std::string("KnowledgeBlock.confidence") + ": expected number";
        return false;
      }
      parsed = (*field_it).get<double>();
      out.confidence = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("verification");
    if (field_it != j.end()) {
      KnowledgeVerification parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("KnowledgeBlock.verification") + ": " + error;
        return false;
      }
      out.verification = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("localization");
    if (field_it != j.end()) {
      std::map<std::string, std::string> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("KnowledgeBlock.localization") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        if (!entry_it.value().is_string()) {
          error = std::string("KnowledgeBlock.localization") + ": expected string item";
          return false;
        }
        parsed[entry_it.key()] = entry_it.value().get<std::string>();
      }
      out.localization = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("content");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.content = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("formula");
    if (field_it != j.end()) {
      FormulaContent parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("KnowledgeBlock.formula") + ": " + error;
        return false;
      }
      out.formula = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, KnowledgeBlock& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const KnowledgeBlock& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["version"] = to_json_value(value.version);
    j["owner"] = to_json_value(value.owner);
    j["type"] = to_json(value.type);
    j["classification"] = to_json_value(value.classification);
    j["status"] = to_json(value.status);
  if (value.scope.has_value()) {
    j["scope"] = to_json(*value.scope);
  }
  if (value.applicability.has_value()) {
    j["applicability"] = to_json_value(*value.applicability);
  }
  if (value.dependencies.has_value()) {
    j["dependencies"] = to_json_value(*value.dependencies);
  }
  if (value.conflicts.has_value()) {
    j["conflicts"] = to_json_value(*value.conflicts);
  }
  if (value.supersedes.has_value()) {
    j["supersedes"] = to_json_value(*value.supersedes);
  }
    j["provenance"] = to_json(value.provenance);
  if (value.confidence.has_value()) {
    j["confidence"] = to_json_value(*value.confidence);
  }
  if (value.verification.has_value()) {
    j["verification"] = to_json(*value.verification);
  }
  if (value.localization.has_value()) {
    j["localization"] = to_json_value(*value.localization);
  }
  if (value.content.has_value()) {
    j["content"] = to_json_value(*value.content);
  }
  if (value.formula.has_value()) {
    j["formula"] = to_json(*value.formula);
  }
  return j;
}

std::string dump(const KnowledgeBlock& value) { return to_json(value).dump(2); }

bool operator==(const KnowledgeBlock& lhs, const KnowledgeBlock& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.version == rhs.version
      && lhs.owner == rhs.owner
      && lhs.type == rhs.type
      && lhs.classification == rhs.classification
      && lhs.status == rhs.status
      && lhs.scope == rhs.scope
      && (lhs.applicability.has_value() == rhs.applicability.has_value()
      && (!lhs.applicability.has_value() || lhs.applicability->dump() == rhs.applicability->dump()))
      && lhs.dependencies == rhs.dependencies
      && lhs.conflicts == rhs.conflicts
      && lhs.supersedes == rhs.supersedes
      && lhs.provenance == rhs.provenance
      && lhs.confidence == rhs.confidence
      && lhs.verification == rhs.verification
      && lhs.localization == rhs.localization
      && (lhs.content.has_value() == rhs.content.has_value()
      && (!lhs.content.has_value() || lhs.content->dump() == rhs.content->dump()))
      && lhs.formula == rhs.formula;
}

bool parse_json(const nlohmann::ordered_json& j, KnowledgePack& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for KnowledgePack";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "version",
      "owner",
      "blocks",
      "digest",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "KnowledgePack: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "KnowledgePack");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.knowledge-pack/v1") {
        error = std::string("KnowledgePack.schema") + ": expected constant " + "logicpilot.knowledge-pack/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "KnowledgePack");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("KnowledgePack.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "KnowledgePack");
      if (!value.is_string()) {
        error = std::string("KnowledgePack.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "version", "KnowledgePack");
      if (!value.is_string()) {
        error = std::string("KnowledgePack.version") + ": expected string";
        return false;
      }
      out.version = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "owner", "KnowledgePack");
      if (!value.is_string()) {
        error = std::string("KnowledgePack.owner") + ": expected string";
        return false;
      }
      out.owner = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "blocks", "KnowledgePack");
      if (!value.is_array()) {
        error = std::string("KnowledgePack.blocks") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.blocks.emplace_back(), error)) {
          error = std::string("KnowledgePack.blocks") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "digest", "KnowledgePack");
      if (!value.is_string()) {
        error = std::string("KnowledgePack.digest") + ": expected string";
        return false;
      }
      out.digest = value.get<std::string>();
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, KnowledgePack& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const KnowledgePack& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["version"] = to_json_value(value.version);
    j["owner"] = to_json_value(value.owner);
    j["blocks"] = to_json_value(value.blocks);
    j["digest"] = to_json_value(value.digest);
  return j;
}

std::string dump(const KnowledgePack& value) { return to_json(value).dump(2); }

bool operator==(const KnowledgePack& lhs, const KnowledgePack& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.version == rhs.version
      && lhs.owner == rhs.owner
      && lhs.blocks == rhs.blocks
      && lhs.digest == rhs.digest;
}

bool parse_json(const nlohmann::ordered_json& j, TrustRequirement& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for TrustRequirement";
    return false;
  }
  static const char* const kKnownFields[] = {
      "minLevel",
      "sandbox",
      "requireSignature",
      "requireReview",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "TrustRequirement: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "minLevel", "TrustRequirement");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.min_level, enum_error)) {
        error = std::string("TrustRequirement.minLevel") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("sandbox");
    if (field_it != j.end()) {
      SandboxKind parsed{};
      std::string enum_error;
      if (!parse((*field_it).get<std::string>(), parsed, enum_error)) {
        error = std::string("TrustRequirement.sandbox") + ": " + enum_error;
        return false;
      }
      out.sandbox = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("requireSignature");
    if (field_it != j.end()) {
      bool parsed{};
      if (!(*field_it).is_boolean()) {
        error = std::string("TrustRequirement.requireSignature") + ": expected boolean";
        return false;
      }
      parsed = (*field_it).get<bool>();
      out.require_signature = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("requireReview");
    if (field_it != j.end()) {
      bool parsed{};
      if (!(*field_it).is_boolean()) {
        error = std::string("TrustRequirement.requireReview") + ": expected boolean";
        return false;
      }
      parsed = (*field_it).get<bool>();
      out.require_review = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, TrustRequirement& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const TrustRequirement& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["minLevel"] = to_json(value.min_level);
  if (value.sandbox.has_value()) {
    j["sandbox"] = to_json(*value.sandbox);
  }
  if (value.require_signature.has_value()) {
    j["requireSignature"] = to_json_value(*value.require_signature);
  }
  if (value.require_review.has_value()) {
    j["requireReview"] = to_json_value(*value.require_review);
  }
  return j;
}

std::string dump(const TrustRequirement& value) { return to_json(value).dump(2); }

bool operator==(const TrustRequirement& lhs, const TrustRequirement& rhs) {
  return lhs.min_level == rhs.min_level
      && lhs.sandbox == rhs.sandbox
      && lhs.require_signature == rhs.require_signature
      && lhs.require_review == rhs.require_review;
}

bool parse_json(const nlohmann::ordered_json& j, PermissionGrant& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PermissionGrant";
    return false;
  }
  static const char* const kKnownFields[] = {
      "permissionId",
      "granted",
      "scope",
      "grantedBy",
      "grantedAt",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PermissionGrant: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "permissionId", "PermissionGrant");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.permission_id, enum_error)) {
        error = std::string("PermissionGrant.permissionId") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "granted", "PermissionGrant");
      if (!value.is_boolean()) {
        error = std::string("PermissionGrant.granted") + ": expected boolean";
        return false;
      }
      out.granted = value.get<bool>();
  }
  {
    auto field_it = j.find("scope");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PermissionGrant.scope") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.scope = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("grantedBy");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PermissionGrant.grantedBy") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.granted_by = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("grantedAt");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PermissionGrant.grantedAt") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.granted_at = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PermissionGrant& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PermissionGrant& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["permissionId"] = to_json(value.permission_id);
    j["granted"] = to_json_value(value.granted);
  if (value.scope.has_value()) {
    j["scope"] = to_json_value(*value.scope);
  }
  if (value.granted_by.has_value()) {
    j["grantedBy"] = to_json_value(*value.granted_by);
  }
  if (value.granted_at.has_value()) {
    j["grantedAt"] = to_json_value(*value.granted_at);
  }
  return j;
}

std::string dump(const PermissionGrant& value) { return to_json(value).dump(2); }

bool operator==(const PermissionGrant& lhs, const PermissionGrant& rhs) {
  return lhs.permission_id == rhs.permission_id
      && lhs.granted == rhs.granted
      && lhs.scope == rhs.scope
      && lhs.granted_by == rhs.granted_by
      && lhs.granted_at == rhs.granted_at;
}

bool parse_json(const nlohmann::ordered_json& j, TrustPolicy& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for TrustPolicy";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "defaultLevel",
      "grants",
      "overrides",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "TrustPolicy: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "TrustPolicy");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.trust-policy/v1") {
        error = std::string("TrustPolicy.schema") + ": expected constant " + "logicpilot.trust-policy/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "TrustPolicy");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("TrustPolicy.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "defaultLevel", "TrustPolicy");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.default_level, enum_error)) {
        error = std::string("TrustPolicy.defaultLevel") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "grants", "TrustPolicy");
      if (!value.is_array()) {
        error = std::string("TrustPolicy.grants") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.grants.emplace_back(), error)) {
          error = std::string("TrustPolicy.grants") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("overrides");
    if (field_it != j.end()) {
      std::map<std::string, TrustLevel> parsed{};
      if (!(*field_it).is_object()) {
        error = std::string("TrustPolicy.overrides") + ": expected object";
        return false;
      }
      for (auto entry_it = (*field_it).begin(); entry_it != (*field_it).end(); ++entry_it) {
        std::string enum_error;
        if (!parse(entry_it.value().get<std::string>(), parsed[entry_it.key()], enum_error)) {
          error = std::string("TrustPolicy.overrides") + ": " + enum_error;
          return false;
        }
      }
      out.overrides = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, TrustPolicy& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const TrustPolicy& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["defaultLevel"] = to_json(value.default_level);
    j["grants"] = to_json_value(value.grants);
  if (value.overrides.has_value()) {
    j["overrides"] = to_json_value(*value.overrides);
  }
  return j;
}

std::string dump(const TrustPolicy& value) { return to_json(value).dump(2); }

bool operator==(const TrustPolicy& lhs, const TrustPolicy& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.default_level == rhs.default_level
      && lhs.grants == rhs.grants
      && lhs.overrides == rhs.overrides;
}

bool parse_json(const nlohmann::ordered_json& j, PluginManifest& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginManifest";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "version",
      "apiVersion",
      "displayName",
      "description",
      "provides",
      "requires",
      "entrypoints",
      "permissions",
      "trust",
      "config",
      "migrations",
      "conformance",
      "integrity",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginManifest: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "PluginManifest");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.plugin-manifest/v2") {
        error = std::string("PluginManifest.schema") + ": expected constant " + "logicpilot.plugin-manifest/v2";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "PluginManifest");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("PluginManifest.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "PluginManifest");
      if (!value.is_string()) {
        error = std::string("PluginManifest.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "version", "PluginManifest");
      if (!value.is_string()) {
        error = std::string("PluginManifest.version") + ": expected string";
        return false;
      }
      out.version = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "apiVersion", "PluginManifest");
      if (!value.is_number_integer()) {
        error = std::string("PluginManifest.apiVersion") + ": expected integer";
        return false;
      }
      out.api_version = value.get<std::int64_t>();
  }
  {
    auto field_it = j.find("displayName");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginManifest.displayName") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.display_name = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("description");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginManifest.description") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.description = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "provides", "PluginManifest");
      if (!value.is_array()) {
        error = std::string("PluginManifest.provides") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!item.is_string()) {
          error = std::string("PluginManifest.provides") + ": expected string item";
          return false;
        }
        out.provides.emplace_back() = item.get<std::string>();
      }
  }
  {
    const auto& value = field_or_fail(error, j, "requires", "PluginManifest");
      if (!value.is_array()) {
        error = std::string("PluginManifest.requires") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.requires_.emplace_back(), error)) {
          error = std::string("PluginManifest.requires") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "entrypoints", "PluginManifest");
      if (!parse_json(value, out.entrypoints, error)) {
        error = std::string("PluginManifest.entrypoints") + ": " + error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "permissions", "PluginManifest");
      if (!value.is_array()) {
        error = std::string("PluginManifest.permissions") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        std::string enum_error;
        if (!parse(item.get<std::string>(), out.permissions.emplace_back(), enum_error)) {
          error = std::string("PluginManifest.permissions") + ": " + enum_error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "trust", "PluginManifest");
      if (!parse_json(value, out.trust, error)) {
        error = std::string("PluginManifest.trust") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("config");
    if (field_it != j.end()) {
      JsonSchemaFragment parsed{};
      parsed = (*field_it);
      out.config = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("migrations");
    if (field_it != j.end()) {
      std::vector<PluginMigration> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("PluginManifest.migrations") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("PluginManifest.migrations") + ": " + error;
          return false;
        }
      }
      out.migrations = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("conformance");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("PluginManifest.conformance") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("PluginManifest.conformance") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.conformance = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("integrity");
    if (field_it != j.end()) {
      PluginIntegrity parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("PluginManifest.integrity") + ": " + error;
        return false;
      }
      out.integrity = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginManifest& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginManifest& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["version"] = to_json_value(value.version);
    j["apiVersion"] = to_json_value(value.api_version);
  if (value.display_name.has_value()) {
    j["displayName"] = to_json_value(*value.display_name);
  }
  if (value.description.has_value()) {
    j["description"] = to_json_value(*value.description);
  }
    j["provides"] = to_json_value(value.provides);
    j["requires"] = to_json_value(value.requires_);
    j["entrypoints"] = to_json(value.entrypoints);
    j["permissions"] = to_json_value(value.permissions);
    j["trust"] = to_json(value.trust);
  if (value.config.has_value()) {
    j["config"] = to_json_value(*value.config);
  }
  if (value.migrations.has_value()) {
    j["migrations"] = to_json_value(*value.migrations);
  }
  if (value.conformance.has_value()) {
    j["conformance"] = to_json_value(*value.conformance);
  }
  if (value.integrity.has_value()) {
    j["integrity"] = to_json(*value.integrity);
  }
  return j;
}

std::string dump(const PluginManifest& value) { return to_json(value).dump(2); }

bool operator==(const PluginManifest& lhs, const PluginManifest& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.version == rhs.version
      && lhs.api_version == rhs.api_version
      && lhs.display_name == rhs.display_name
      && lhs.description == rhs.description
      && lhs.provides == rhs.provides
      && lhs.requires_ == rhs.requires_
      && lhs.entrypoints == rhs.entrypoints
      && lhs.permissions == rhs.permissions
      && lhs.trust == rhs.trust
      && (lhs.config.has_value() == rhs.config.has_value()
      && (!lhs.config.has_value() || lhs.config->dump() == rhs.config->dump()))
      && lhs.migrations == rhs.migrations
      && lhs.conformance == rhs.conformance
      && lhs.integrity == rhs.integrity;
}

bool parse_json(const nlohmann::ordered_json& j, PluginDependency& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginDependency";
    return false;
  }
  static const char* const kKnownFields[] = {
      "id",
      "range",
      "optional",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginDependency: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "id", "PluginDependency");
      if (!value.is_string()) {
        error = std::string("PluginDependency.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    auto field_it = j.find("range");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginDependency.range") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.range = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("optional");
    if (field_it != j.end()) {
      bool parsed{};
      if (!(*field_it).is_boolean()) {
        error = std::string("PluginDependency.optional") + ": expected boolean";
        return false;
      }
      parsed = (*field_it).get<bool>();
      out.optional = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginDependency& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginDependency& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["id"] = to_json_value(value.id);
  if (value.range.has_value()) {
    j["range"] = to_json_value(*value.range);
  }
  if (value.optional.has_value()) {
    j["optional"] = to_json_value(*value.optional);
  }
  return j;
}

std::string dump(const PluginDependency& value) { return to_json(value).dump(2); }

bool operator==(const PluginDependency& lhs, const PluginDependency& rhs) {
  return lhs.id == rhs.id
      && lhs.range == rhs.range
      && lhs.optional == rhs.optional;
}

bool parse_json(const nlohmann::ordered_json& j, PluginEntrypoints& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginEntrypoints";
    return false;
  }
  static const char* const kKnownFields[] = {
      "web",
      "node",
      "wasm",
      "native",
      "data",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginEntrypoints: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    auto field_it = j.find("web");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginEntrypoints.web") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.web = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("node");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginEntrypoints.node") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.node = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("wasm");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginEntrypoints.wasm") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.wasm = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("native");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginEntrypoints.native") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.native = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("data");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginEntrypoints.data") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.data = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginEntrypoints& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginEntrypoints& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
  if (value.web.has_value()) {
    j["web"] = to_json_value(*value.web);
  }
  if (value.node.has_value()) {
    j["node"] = to_json_value(*value.node);
  }
  if (value.wasm.has_value()) {
    j["wasm"] = to_json_value(*value.wasm);
  }
  if (value.native.has_value()) {
    j["native"] = to_json_value(*value.native);
  }
  if (value.data.has_value()) {
    j["data"] = to_json_value(*value.data);
  }
  return j;
}

std::string dump(const PluginEntrypoints& value) { return to_json(value).dump(2); }

bool operator==(const PluginEntrypoints& lhs, const PluginEntrypoints& rhs) {
  return lhs.web == rhs.web
      && lhs.node == rhs.node
      && lhs.wasm == rhs.wasm
      && lhs.native == rhs.native
      && lhs.data == rhs.data;
}

bool parse_json(const nlohmann::ordered_json& j, PluginMigration& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginMigration";
    return false;
  }
  static const char* const kKnownFields[] = {
      "fromVersion",
      "toVersion",
      "script",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginMigration: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "fromVersion", "PluginMigration");
      if (!value.is_string()) {
        error = std::string("PluginMigration.fromVersion") + ": expected string";
        return false;
      }
      out.from_version = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "toVersion", "PluginMigration");
      if (!value.is_string()) {
        error = std::string("PluginMigration.toVersion") + ": expected string";
        return false;
      }
      out.to_version = value.get<std::string>();
  }
  {
    auto field_it = j.find("script");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginMigration.script") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.script = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginMigration& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginMigration& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["fromVersion"] = to_json_value(value.from_version);
    j["toVersion"] = to_json_value(value.to_version);
  if (value.script.has_value()) {
    j["script"] = to_json_value(*value.script);
  }
  return j;
}

std::string dump(const PluginMigration& value) { return to_json(value).dump(2); }

bool operator==(const PluginMigration& lhs, const PluginMigration& rhs) {
  return lhs.from_version == rhs.from_version
      && lhs.to_version == rhs.to_version
      && lhs.script == rhs.script;
}

bool parse_json(const nlohmann::ordered_json& j, PluginIntegrity& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginIntegrity";
    return false;
  }
  static const char* const kKnownFields[] = {
      "sha256",
      "signature",
      "signedBy",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginIntegrity: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "sha256", "PluginIntegrity");
      if (!value.is_string()) {
        error = std::string("PluginIntegrity.sha256") + ": expected string";
        return false;
      }
      out.sha256 = value.get<std::string>();
  }
  {
    auto field_it = j.find("signature");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginIntegrity.signature") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.signature = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("signedBy");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginIntegrity.signedBy") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.signed_by = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginIntegrity& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginIntegrity& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["sha256"] = to_json_value(value.sha256);
  if (value.signature.has_value()) {
    j["signature"] = to_json_value(*value.signature);
  }
  if (value.signed_by.has_value()) {
    j["signedBy"] = to_json_value(*value.signed_by);
  }
  return j;
}

std::string dump(const PluginIntegrity& value) { return to_json(value).dump(2); }

bool operator==(const PluginIntegrity& lhs, const PluginIntegrity& rhs) {
  return lhs.sha256 == rhs.sha256
      && lhs.signature == rhs.signature
      && lhs.signed_by == rhs.signed_by;
}

bool parse_json(const nlohmann::ordered_json& j, PluginLockEntry& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginLockEntry";
    return false;
  }
  static const char* const kKnownFields[] = {
      "id",
      "version",
      "apiVersion",
      "sha256",
      "source",
      "trust",
      "permissions",
      "dependencies",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginLockEntry: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "id", "PluginLockEntry");
      if (!value.is_string()) {
        error = std::string("PluginLockEntry.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "version", "PluginLockEntry");
      if (!value.is_string()) {
        error = std::string("PluginLockEntry.version") + ": expected string";
        return false;
      }
      out.version = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "apiVersion", "PluginLockEntry");
      if (!value.is_number_integer()) {
        error = std::string("PluginLockEntry.apiVersion") + ": expected integer";
        return false;
      }
      out.api_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "sha256", "PluginLockEntry");
      if (!value.is_string()) {
        error = std::string("PluginLockEntry.sha256") + ": expected string";
        return false;
      }
      out.sha256 = value.get<std::string>();
  }
  {
    auto field_it = j.find("source");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("PluginLockEntry.source") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.source = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "trust", "PluginLockEntry");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.trust, enum_error)) {
        error = std::string("PluginLockEntry.trust") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "permissions", "PluginLockEntry");
      if (!value.is_array()) {
        error = std::string("PluginLockEntry.permissions") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.permissions.emplace_back(), error)) {
          error = std::string("PluginLockEntry.permissions") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("dependencies");
    if (field_it != j.end()) {
      std::vector<PluginDependency> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("PluginLockEntry.dependencies") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("PluginLockEntry.dependencies") + ": " + error;
          return false;
        }
      }
      out.dependencies = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginLockEntry& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginLockEntry& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["id"] = to_json_value(value.id);
    j["version"] = to_json_value(value.version);
    j["apiVersion"] = to_json_value(value.api_version);
    j["sha256"] = to_json_value(value.sha256);
  if (value.source.has_value()) {
    j["source"] = to_json_value(*value.source);
  }
    j["trust"] = to_json(value.trust);
    j["permissions"] = to_json_value(value.permissions);
  if (value.dependencies.has_value()) {
    j["dependencies"] = to_json_value(*value.dependencies);
  }
  return j;
}

std::string dump(const PluginLockEntry& value) { return to_json(value).dump(2); }

bool operator==(const PluginLockEntry& lhs, const PluginLockEntry& rhs) {
  return lhs.id == rhs.id
      && lhs.version == rhs.version
      && lhs.api_version == rhs.api_version
      && lhs.sha256 == rhs.sha256
      && lhs.source == rhs.source
      && lhs.trust == rhs.trust
      && lhs.permissions == rhs.permissions
      && lhs.dependencies == rhs.dependencies;
}

bool parse_json(const nlohmann::ordered_json& j, PluginLockfile& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PluginLockfile";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "plugins",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PluginLockfile: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "PluginLockfile");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.plugin-lock/v1") {
        error = std::string("PluginLockfile.schema") + ": expected constant " + "logicpilot.plugin-lock/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "PluginLockfile");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("PluginLockfile.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "plugins", "PluginLockfile");
      if (!value.is_array()) {
        error = std::string("PluginLockfile.plugins") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.plugins.emplace_back(), error)) {
          error = std::string("PluginLockfile.plugins") + ": " + error;
          return false;
        }
      }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PluginLockfile& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PluginLockfile& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["plugins"] = to_json_value(value.plugins);
  return j;
}

std::string dump(const PluginLockfile& value) { return to_json(value).dump(2); }

bool operator==(const PluginLockfile& lhs, const PluginLockfile& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.plugins == rhs.plugins;
}

bool parse_json(const nlohmann::ordered_json& j, ViewQuery& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ViewQuery";
    return false;
  }
  static const char* const kKnownFields[] = {
      "artifactKinds",
      "relationKinds",
      "filter",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ViewQuery: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "artifactKinds", "ViewQuery");
      if (!value.is_array()) {
        error = std::string("ViewQuery.artifactKinds") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        std::string enum_error;
        if (!parse(item.get<std::string>(), out.artifact_kinds.emplace_back(), enum_error)) {
          error = std::string("ViewQuery.artifactKinds") + ": " + enum_error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("relationKinds");
    if (field_it != j.end()) {
      std::vector<RelationKind> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("ViewQuery.relationKinds") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        std::string enum_error;
        if (!parse(item.get<std::string>(), parsed.emplace_back(), enum_error)) {
          error = std::string("ViewQuery.relationKinds") + ": " + enum_error;
          return false;
        }
      }
      out.relation_kinds = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("filter");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.filter = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ViewQuery& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ViewQuery& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["artifactKinds"] = to_json_value(value.artifact_kinds);
  if (value.relation_kinds.has_value()) {
    j["relationKinds"] = to_json_value(*value.relation_kinds);
  }
  if (value.filter.has_value()) {
    j["filter"] = to_json_value(*value.filter);
  }
  return j;
}

std::string dump(const ViewQuery& value) { return to_json(value).dump(2); }

bool operator==(const ViewQuery& lhs, const ViewQuery& rhs) {
  return lhs.artifact_kinds == rhs.artifact_kinds
      && lhs.relation_kinds == rhs.relation_kinds
      && (lhs.filter.has_value() == rhs.filter.has_value()
      && (!lhs.filter.has_value() || lhs.filter->dump() == rhs.filter->dump()));
}

bool parse_json(const nlohmann::ordered_json& j, ViewDefinition& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ViewDefinition";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "owner",
      "titleKey",
      "canvas",
      "query",
      "projection",
      "interactions",
      "supportsInverseEdit",
      "layoutPersistence",
      "requiredContributions",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ViewDefinition: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "ViewDefinition");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.view-definition/v1") {
        error = std::string("ViewDefinition.schema") + ": expected constant " + "logicpilot.view-definition/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "ViewDefinition");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("ViewDefinition.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "ViewDefinition");
      if (!value.is_string()) {
        error = std::string("ViewDefinition.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "owner", "ViewDefinition");
      if (!value.is_string()) {
        error = std::string("ViewDefinition.owner") + ": expected string";
        return false;
      }
      out.owner = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "titleKey", "ViewDefinition");
      if (!value.is_string()) {
        error = std::string("ViewDefinition.titleKey") + ": expected string";
        return false;
      }
      out.title_key = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "canvas", "ViewDefinition");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.canvas, enum_error)) {
        error = std::string("ViewDefinition.canvas") + ": " + enum_error;
        return false;
      }
  }
  {
    const auto& value = field_or_fail(error, j, "query", "ViewDefinition");
      if (!parse_json(value, out.query, error)) {
        error = std::string("ViewDefinition.query") + ": " + error;
        return false;
      }
  }
  {
    auto field_it = j.find("projection");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.projection = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "interactions", "ViewDefinition");
      if (!value.is_array()) {
        error = std::string("ViewDefinition.interactions") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!item.is_string()) {
          error = std::string("ViewDefinition.interactions") + ": expected string item";
          return false;
        }
        out.interactions.emplace_back() = item.get<std::string>();
      }
  }
  {
    const auto& value = field_or_fail(error, j, "supportsInverseEdit", "ViewDefinition");
      if (!value.is_boolean()) {
        error = std::string("ViewDefinition.supportsInverseEdit") + ": expected boolean";
        return false;
      }
      out.supports_inverse_edit = value.get<bool>();
  }
  {
    const auto& value = field_or_fail(error, j, "layoutPersistence", "ViewDefinition");
      std::string enum_error;
      if (!parse(value.get<std::string>(), out.layout_persistence, enum_error)) {
        error = std::string("ViewDefinition.layoutPersistence") + ": " + enum_error;
        return false;
      }
  }
  {
    auto field_it = j.find("requiredContributions");
    if (field_it != j.end()) {
      ViewContributions parsed{};
      if (!parse_json((*field_it), parsed, error)) {
        error = std::string("ViewDefinition.requiredContributions") + ": " + error;
        return false;
      }
      out.required_contributions = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ViewDefinition& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ViewDefinition& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["owner"] = to_json_value(value.owner);
    j["titleKey"] = to_json_value(value.title_key);
    j["canvas"] = to_json(value.canvas);
    j["query"] = to_json(value.query);
  if (value.projection.has_value()) {
    j["projection"] = to_json_value(*value.projection);
  }
    j["interactions"] = to_json_value(value.interactions);
    j["supportsInverseEdit"] = to_json_value(value.supports_inverse_edit);
    j["layoutPersistence"] = to_json(value.layout_persistence);
  if (value.required_contributions.has_value()) {
    j["requiredContributions"] = to_json(*value.required_contributions);
  }
  return j;
}

std::string dump(const ViewDefinition& value) { return to_json(value).dump(2); }

bool operator==(const ViewDefinition& lhs, const ViewDefinition& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.owner == rhs.owner
      && lhs.title_key == rhs.title_key
      && lhs.canvas == rhs.canvas
      && lhs.query == rhs.query
      && (lhs.projection.has_value() == rhs.projection.has_value()
      && (!lhs.projection.has_value() || lhs.projection->dump() == rhs.projection->dump()))
      && lhs.interactions == rhs.interactions
      && lhs.supports_inverse_edit == rhs.supports_inverse_edit
      && lhs.layout_persistence == rhs.layout_persistence
      && lhs.required_contributions == rhs.required_contributions;
}

bool parse_json(const nlohmann::ordered_json& j, ViewContributions& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for ViewContributions";
    return false;
  }
  static const char* const kKnownFields[] = {
      "notations",
      "domains",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "ViewContributions: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    auto field_it = j.find("notations");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("ViewContributions.notations") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("ViewContributions.notations") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.notations = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("domains");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("ViewContributions.domains") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("ViewContributions.domains") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.domains = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, ViewContributions& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const ViewContributions& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
  if (value.notations.has_value()) {
    j["notations"] = to_json_value(*value.notations);
  }
  if (value.domains.has_value()) {
    j["domains"] = to_json_value(*value.domains);
  }
  return j;
}

std::string dump(const ViewContributions& value) { return to_json(value).dump(2); }

bool operator==(const ViewContributions& lhs, const ViewContributions& rhs) {
  return lhs.notations == rhs.notations
      && lhs.domains == rhs.domains;
}

bool parse_json(const nlohmann::ordered_json& j, GlyphMapping& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for GlyphMapping";
    return false;
  }
  static const char* const kKnownFields[] = {
      "semanticKind",
      "glyph",
      "compartments",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "GlyphMapping: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "semanticKind", "GlyphMapping");
      if (!value.is_string()) {
        error = std::string("GlyphMapping.semanticKind") + ": expected string";
        return false;
      }
      out.semantic_kind = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "glyph", "GlyphMapping");
      if (!value.is_string()) {
        error = std::string("GlyphMapping.glyph") + ": expected string";
        return false;
      }
      out.glyph = value.get<std::string>();
  }
  {
    auto field_it = j.find("compartments");
    if (field_it != j.end()) {
      std::vector<std::string> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("GlyphMapping.compartments") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!item.is_string()) {
          error = std::string("GlyphMapping.compartments") + ": expected string item";
          return false;
        }
        parsed.emplace_back() = item.get<std::string>();
      }
      out.compartments = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, GlyphMapping& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const GlyphMapping& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["semanticKind"] = to_json_value(value.semantic_kind);
    j["glyph"] = to_json_value(value.glyph);
  if (value.compartments.has_value()) {
    j["compartments"] = to_json_value(*value.compartments);
  }
  return j;
}

std::string dump(const GlyphMapping& value) { return to_json(value).dump(2); }

bool operator==(const GlyphMapping& lhs, const GlyphMapping& rhs) {
  return lhs.semantic_kind == rhs.semantic_kind
      && lhs.glyph == rhs.glyph
      && lhs.compartments == rhs.compartments;
}

bool parse_json(const nlohmann::ordered_json& j, EdgeMapping& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for EdgeMapping";
    return false;
  }
  static const char* const kKnownFields[] = {
      "relationKind",
      "edgeStyle",
      "directed",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "EdgeMapping: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "relationKind", "EdgeMapping");
      if (!value.is_string()) {
        error = std::string("EdgeMapping.relationKind") + ": expected string";
        return false;
      }
      out.relation_kind = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "edgeStyle", "EdgeMapping");
      if (!value.is_string()) {
        error = std::string("EdgeMapping.edgeStyle") + ": expected string";
        return false;
      }
      out.edge_style = value.get<std::string>();
  }
  {
    auto field_it = j.find("directed");
    if (field_it != j.end()) {
      bool parsed{};
      if (!(*field_it).is_boolean()) {
        error = std::string("EdgeMapping.directed") + ": expected boolean";
        return false;
      }
      parsed = (*field_it).get<bool>();
      out.directed = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, EdgeMapping& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const EdgeMapping& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["relationKind"] = to_json_value(value.relation_kind);
    j["edgeStyle"] = to_json_value(value.edge_style);
  if (value.directed.has_value()) {
    j["directed"] = to_json_value(*value.directed);
  }
  return j;
}

std::string dump(const EdgeMapping& value) { return to_json(value).dump(2); }

bool operator==(const EdgeMapping& lhs, const EdgeMapping& rhs) {
  return lhs.relation_kind == rhs.relation_kind
      && lhs.edge_style == rhs.edge_style
      && lhs.directed == rhs.directed;
}

bool parse_json(const nlohmann::ordered_json& j, PortRule& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for PortRule";
    return false;
  }
  static const char* const kKnownFields[] = {
      "portKind",
      "connectableTo",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "PortRule: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "portKind", "PortRule");
      if (!value.is_string()) {
        error = std::string("PortRule.portKind") + ": expected string";
        return false;
      }
      out.port_kind = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "connectableTo", "PortRule");
      if (!value.is_array()) {
        error = std::string("PortRule.connectableTo") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!item.is_string()) {
          error = std::string("PortRule.connectableTo") + ": expected string item";
          return false;
        }
        out.connectable_to.emplace_back() = item.get<std::string>();
      }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, PortRule& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const PortRule& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["portKind"] = to_json_value(value.port_kind);
    j["connectableTo"] = to_json_value(value.connectable_to);
  return j;
}

std::string dump(const PortRule& value) { return to_json(value).dump(2); }

bool operator==(const PortRule& lhs, const PortRule& rhs) {
  return lhs.port_kind == rhs.port_kind
      && lhs.connectable_to == rhs.connectable_to;
}

bool parse_json(const nlohmann::ordered_json& j, NotationPack& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for NotationPack";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "owner",
      "glyphs",
      "edges",
      "ports",
      "propertyEditor",
      "layoutHints",
      "createActions",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "NotationPack: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "NotationPack");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.notation-pack/v1") {
        error = std::string("NotationPack.schema") + ": expected constant " + "logicpilot.notation-pack/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "NotationPack");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("NotationPack.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "NotationPack");
      if (!value.is_string()) {
        error = std::string("NotationPack.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "owner", "NotationPack");
      if (!value.is_string()) {
        error = std::string("NotationPack.owner") + ": expected string";
        return false;
      }
      out.owner = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "glyphs", "NotationPack");
      if (!value.is_array()) {
        error = std::string("NotationPack.glyphs") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.glyphs.emplace_back(), error)) {
          error = std::string("NotationPack.glyphs") + ": " + error;
          return false;
        }
      }
  }
  {
    const auto& value = field_or_fail(error, j, "edges", "NotationPack");
      if (!value.is_array()) {
        error = std::string("NotationPack.edges") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.edges.emplace_back(), error)) {
          error = std::string("NotationPack.edges") + ": " + error;
          return false;
        }
      }
  }
  {
    auto field_it = j.find("ports");
    if (field_it != j.end()) {
      std::vector<PortRule> parsed{};
      if (!(*field_it).is_array()) {
        error = std::string("NotationPack.ports") + ": expected array";
        return false;
      }
      for (const auto& item : (*field_it)) {
        if (!parse_json(item, parsed.emplace_back(), error)) {
          error = std::string("NotationPack.ports") + ": " + error;
          return false;
        }
      }
      out.ports = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("propertyEditor");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("NotationPack.propertyEditor") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.property_editor = std::move(parsed);
    }
  }
  {
    auto field_it = j.find("layoutHints");
    if (field_it != j.end()) {
      JsonValue parsed{};
      parsed = (*field_it);
      out.layout_hints = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "createActions", "NotationPack");
      if (!value.is_array()) {
        error = std::string("NotationPack.createActions") + ": expected array";
        return false;
      }
      for (const auto& item : value) {
        if (!parse_json(item, out.create_actions.emplace_back(), error)) {
          error = std::string("NotationPack.createActions") + ": " + error;
          return false;
        }
      }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, NotationPack& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const NotationPack& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["owner"] = to_json_value(value.owner);
    j["glyphs"] = to_json_value(value.glyphs);
    j["edges"] = to_json_value(value.edges);
  if (value.ports.has_value()) {
    j["ports"] = to_json_value(*value.ports);
  }
  if (value.property_editor.has_value()) {
    j["propertyEditor"] = to_json_value(*value.property_editor);
  }
  if (value.layout_hints.has_value()) {
    j["layoutHints"] = to_json_value(*value.layout_hints);
  }
    j["createActions"] = to_json_value(value.create_actions);
  return j;
}

std::string dump(const NotationPack& value) { return to_json(value).dump(2); }

bool operator==(const NotationPack& lhs, const NotationPack& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.owner == rhs.owner
      && lhs.glyphs == rhs.glyphs
      && lhs.edges == rhs.edges
      && lhs.ports == rhs.ports
      && lhs.property_editor == rhs.property_editor
      && (lhs.layout_hints.has_value() == rhs.layout_hints.has_value()
      && (!lhs.layout_hints.has_value() || lhs.layout_hints->dump() == rhs.layout_hints->dump()))
      && lhs.create_actions == rhs.create_actions;
}

bool parse_json(const nlohmann::ordered_json& j, CreateActionRef& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for CreateActionRef";
    return false;
  }
  static const char* const kKnownFields[] = {
      "id",
      "order",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "CreateActionRef: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "id", "CreateActionRef");
      if (!value.is_string()) {
        error = std::string("CreateActionRef.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    auto field_it = j.find("order");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("CreateActionRef.order") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.order = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, CreateActionRef& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const CreateActionRef& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["id"] = to_json_value(value.id);
  if (value.order.has_value()) {
    j["order"] = to_json_value(*value.order);
  }
  return j;
}

std::string dump(const CreateActionRef& value) { return to_json(value).dump(2); }

bool operator==(const CreateActionRef& lhs, const CreateActionRef& rhs) {
  return lhs.id == rhs.id
      && lhs.order == rhs.order;
}

bool parse_json(const nlohmann::ordered_json& j, CreateAction& out, std::string& error) {
  if (!j.is_object()) {
    error = "expected object for CreateAction";
    return false;
  }
  static const char* const kKnownFields[] = {
      "schema",
      "contractVersion",
      "id",
      "owner",
      "titleKey",
      "icon",
      "notationId",
      "targetSemanticKind",
      "order",
  };
  for (auto it = j.begin(); it != j.end(); ++it) {
    bool known = false;
    for (const char* k : kKnownFields) {
      if (it.key() == k) { known = true; break; }
    }
    if (!known) {
      error = "CreateAction: unknown field '" + it.key() + "'";
      return false;
    }
  }
  {
    const auto& value = field_or_fail(error, j, "schema", "CreateAction");
      if (!value.is_string() || value.get<std::string>() != "logicpilot.create-action/v1") {
        error = std::string("CreateAction.schema") + ": expected constant " + "logicpilot.create-action/v1";
        return false;
      }
      out.schema = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "contractVersion", "CreateAction");
      if (!value.is_number_integer() || value.get<std::int64_t>() != 1) {
        error = std::string("CreateAction.contractVersion") + ": expected constant 1";
        return false;
      }
      out.contract_version = value.get<std::int64_t>();
  }
  {
    const auto& value = field_or_fail(error, j, "id", "CreateAction");
      if (!value.is_string()) {
        error = std::string("CreateAction.id") + ": expected string";
        return false;
      }
      out.id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "owner", "CreateAction");
      if (!value.is_string()) {
        error = std::string("CreateAction.owner") + ": expected string";
        return false;
      }
      out.owner = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "titleKey", "CreateAction");
      if (!value.is_string()) {
        error = std::string("CreateAction.titleKey") + ": expected string";
        return false;
      }
      out.title_key = value.get<std::string>();
  }
  {
    auto field_it = j.find("icon");
    if (field_it != j.end()) {
      std::string parsed{};
      if (!(*field_it).is_string()) {
        error = std::string("CreateAction.icon") + ": expected string";
        return false;
      }
      parsed = (*field_it).get<std::string>();
      out.icon = std::move(parsed);
    }
  }
  {
    const auto& value = field_or_fail(error, j, "notationId", "CreateAction");
      if (!value.is_string()) {
        error = std::string("CreateAction.notationId") + ": expected string";
        return false;
      }
      out.notation_id = value.get<std::string>();
  }
  {
    const auto& value = field_or_fail(error, j, "targetSemanticKind", "CreateAction");
      if (!value.is_string()) {
        error = std::string("CreateAction.targetSemanticKind") + ": expected string";
        return false;
      }
      out.target_semantic_kind = value.get<std::string>();
  }
  {
    auto field_it = j.find("order");
    if (field_it != j.end()) {
      std::int64_t parsed{};
      if (!(*field_it).is_number_integer()) {
        error = std::string("CreateAction.order") + ": expected integer";
        return false;
      }
      parsed = (*field_it).get<std::int64_t>();
      out.order = std::move(parsed);
    }
  }
  (void)error;
  return true;
}

bool parse(std::string_view text, CreateAction& out, std::string& error) {
  try {
    const auto j = nlohmann::ordered_json::parse(text);
    return parse_json(j, out, error);
  } catch (const std::exception& ex) {
    error = ex.what();
    return false;
  }
}

nlohmann::ordered_json to_json(const CreateAction& value) {
  nlohmann::ordered_json j = nlohmann::ordered_json::object();
    j["schema"] = to_json_value(value.schema);
    j["contractVersion"] = to_json_value(value.contract_version);
    j["id"] = to_json_value(value.id);
    j["owner"] = to_json_value(value.owner);
    j["titleKey"] = to_json_value(value.title_key);
  if (value.icon.has_value()) {
    j["icon"] = to_json_value(*value.icon);
  }
    j["notationId"] = to_json_value(value.notation_id);
    j["targetSemanticKind"] = to_json_value(value.target_semantic_kind);
  if (value.order.has_value()) {
    j["order"] = to_json_value(*value.order);
  }
  return j;
}

std::string dump(const CreateAction& value) { return to_json(value).dump(2); }

bool operator==(const CreateAction& lhs, const CreateAction& rhs) {
  return lhs.schema == rhs.schema
      && lhs.contract_version == rhs.contract_version
      && lhs.id == rhs.id
      && lhs.owner == rhs.owner
      && lhs.title_key == rhs.title_key
      && lhs.icon == rhs.icon
      && lhs.notation_id == rhs.notation_id
      && lhs.target_semantic_kind == rhs.target_semantic_kind
      && lhs.order == rhs.order;
}

}  // namespace logicpilot::contracts

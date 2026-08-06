// Kernel-native method runtimes ("devs", "agent", "sd").
//
// These wrap the existing replication engines behind the SimulationMethod
// lifecycle so the whole kernel lowers through the MethodRegistry. Phase 1
// lifecycle semantics: initialize() lowers and validates, the first
// advance() runs one full replication with driver defaults, shutdown()
// releases. Incremental stepping lands with the modular block runtimes
// (Phase 3).
#include "logicpilot/runtime/method_registry.h"

#include <memory>
#include <string>
#include <string_view>

#include "ir_v2_generated.h"
#include "logicpilot/devs/continuous.h"
#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {
namespace {

// Shared batch lifecycle for kernel-native methods (see file comment).
class BatchMethodBase : public SimulationMethod {
 public:
  explicit BatchMethodBase(std::string_view name) : name_(name) {}

  [[nodiscard]] std::string_view method_name() const final { return name_; }

  bool initialize(RuntimeContext& context, const IrModelFile& model,
                  std::string* error) override {
    context_ = &context;
    replication_ = to_replication_model(model, error);
    return replication_ != nullptr;
  }

  void advance(SimTime until) override {
    (void)until;  // Phase 1 batch-only; incremental stepping in Phase 3.
    if (replication_ != nullptr && !ran_) {
      ReplicationConfig config;  // lifecycle driver defaults
      last_metrics_ = replication_->run(config, nullptr);
      ran_ = true;
    }
  }

  void shutdown() override {
    replication_.reset();
    context_ = nullptr;
    ran_ = false;
  }

  [[nodiscard]] const ReplicationMetrics& last_metrics() const {
    return last_metrics_;
  }

 private:
  std::string name_;
  RuntimeContext* context_{nullptr};
  std::unique_ptr<ReplicationModel> replication_;
  ReplicationMetrics last_metrics_;
  bool ran_{false};
};

class DevsMethod final : public BatchMethodBase {
 public:
  DevsMethod() : BatchMethodBase("devs") {}

  std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) {
        *error = "no root model";
      }
      return nullptr;
    }
    return std::make_unique<DevsReplicationModel>(model.v2_bytes,
                                                  model.v2_root->root());
  }
};

class AgentMethod final : public BatchMethodBase {
 public:
  AgentMethod() : BatchMethodBase("agent") {}

  std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) {
        *error = "no root model";
      }
      return nullptr;
    }
    return std::make_unique<AgentReplicationModel>(model.v2_bytes,
                                                   model.v2_root->root());
  }
};

class SdMethod final : public BatchMethodBase {
 public:
  SdMethod() : BatchMethodBase("sd") {}

  std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) {
        *error = "no root model";
      }
      return nullptr;
    }
    return std::make_unique<ContinuousReplicationModel>(
        model.v2_bytes, model.v2_root->root());
  }
};

}  // namespace

void register_builtin_methods() {
  MethodRegistry& registry = MethodRegistry::instance();
  registry.register_method("devs",
                           [] { return std::make_unique<DevsMethod>(); });
  registry.register_method("agent",
                           [] { return std::make_unique<AgentMethod>(); });
  registry.register_method("sd",
                           [] { return std::make_unique<SdMethod>(); });
}

}  // namespace logicpilot

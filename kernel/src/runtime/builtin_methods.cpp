// Kernel-native method runtime ("devs"); registry metadata
// defaults them to semantics contract version 1.
//
// These wrap the existing replication engines behind the SimulationMethod
// lifecycle so the whole kernel lowers through the MethodRegistry. Phase 1
// lifecycle semantics: initialize() lowers and validates, the first
// advance() runs one full replication with driver defaults, shutdown()
// releases. Process, Statechart, Continuous, and Atomic adapters also expose
// incremental lifecycles to the lp-server streaming driver.
#include <exception>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/executor.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/runtime/ir_loader.h"
#include "logicpilot/runtime/replication.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

// Shared batch lifecycle for kernel-native methods (see file comment).
class BatchMethodBase : public SimulationMethod {
public:
  explicit BatchMethodBase(std::string_view name) : name_(name) {}

  [[nodiscard]] std::string_view method_name() const final { return name_; }

  bool initialize(RuntimeContext& context, const IrModelFile& model, std::string* error) override {
    context_ = &context;
    replication_ = to_replication_model(model, error);
    return replication_ != nullptr;
  }

  void advance(SimTime until) override {
    (void)until;  // Phase 1 batch-only; incremental stepping in Phase 3.
    if (replication_ != nullptr && !ran_) {
      const ReplicationConfig config =
          context_ != nullptr ? context_->config() : ReplicationConfig{};
      last_metrics_ = replication_->run(config, nullptr);
      ran_ = true;
    }
  }

  void shutdown() override {
    replication_.reset();
    context_ = nullptr;
    ran_ = false;
  }

  [[nodiscard]] const ReplicationMetrics& last_metrics() const { return last_metrics_; }
  [[nodiscard]] ReplicationMetrics replication_metrics() const override { return last_metrics_; }

private:
  std::string name_;
  RuntimeContext* context_{nullptr};
  std::unique_ptr<ReplicationModel> replication_;
  ReplicationMetrics last_metrics_;
  bool ran_{false};
};

class DevsMethod final : public SimulationMethod,
                   public CheckpointedDevRuntime {
public:
  [[nodiscard]] std::string_view method_name() const override { return "devs"; }

  [[nodiscard]] MethodCapabilities capabilities() const override {
    return MethodCapabilities{MethodExecutionMode::kSharedEventQueue, true, true};
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model, std::string* error) override {
    context_ = &context;
    last_metrics_ = ReplicationMetrics{};
    bytes_ = model.v2_bytes;
    if (bytes_.empty()) {
      if (error != nullptr)
        *error = "empty IR buffer";
      return false;
    }
    const auto* root = ir::v2::GetModelFile(bytes_.data())->root();
    engine_ = std::make_unique<Xoshiro256PlusPlus>(context.config().seed);
    tree_ = build_atomic_tree_v2(*root, *engine_);
    if (tree_ == nullptr) {
      if (error != nullptr)
        *error = "no devs/atomic nodes in model";
      return false;
    }
    executor_ =
        std::make_unique<DevsExecutor>(context.scheduler(), context.clock(), context.handlers());
    executor_->set_evidence_recorder(context.devs_evidence_recorder());
    executor_->set_internal_budget(static_cast<std::size_t>(context.config().arrivals));
    try {
      executor_->load(*tree_);
    } catch (const std::exception& exception) {
      if (error != nullptr)
        *error = exception.what();
      return false;
    }
    return true;
  }

  void advance(SimTime) override {}

  void shutdown() override {
    if (executor_ != nullptr && context_ != nullptr) {
      last_metrics_.arrivals = executor_->internal_transitions();
      last_metrics_.horizon_seconds = static_cast<double>(context_->clock().now().as_ns()) * 1e-9;
    }
    executor_.reset();
    tree_.reset();
    engine_.reset();
    bytes_.clear();
    context_ = nullptr;
  }

  [[nodiscard]] ReplicationMetrics replication_metrics() const override { return last_metrics_; }

  [[nodiscard]] bool save_checkpoint(DevsCheckpoint& checkpoint,
                                     std::string* error) const override {
    if (executor_ == nullptr) {
      if (error != nullptr) *error = "DEVS runtime is not active";
      return false;
    }
    return executor_->save_checkpoint(checkpoint, error);
  }

  bool restore_checkpoint(const DevsCheckpoint& checkpoint,
                          std::string* error) override {
    if (executor_ == nullptr) {
      if (error != nullptr) *error = "DEVS runtime is not active";
      return false;
    }
    return executor_->restore_checkpoint(checkpoint, error);
  }

  std::unique_ptr<ReplicationModel> to_replication_model(const IrModelFile& model,
                                                         std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) {
        *error = "no root model";
      }
      return nullptr;
    }
    return std::make_unique<DevsReplicationModel>(model.v2_bytes, model.v2_root->root());
  }

private:
  RuntimeContext* context_{nullptr};
  std::vector<std::uint8_t> bytes_;
  std::unique_ptr<Xoshiro256PlusPlus> engine_;
  std::unique_ptr<CoupledModel> tree_;
  std::unique_ptr<DevsExecutor> executor_;
  ReplicationMetrics last_metrics_;
};

}  // namespace

void register_builtin_methods() {
  MethodRegistry& registry = MethodRegistry::instance();
  registry.register_method(
      "devs", [] { return std::make_unique<DevsMethod>(); },
      MethodRegistry::Descriptor{"1", {"1"}, MethodFamily::kDiscreteEvent,
                                 MethodFormalism::kDevs});
}

}  // namespace logicpilot

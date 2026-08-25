// System-dynamics method runtime plugin (Method Runtime Layer).

#include "sd_runtime.h"

#include <algorithm>
#include <cmath>
#include <memory>

#include "ir_v2_generated.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/continuous.h"
#include "logicpilot/runtime/ir_loader.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {
namespace {

class SdMethod final : public SimulationMethod {
 public:
  [[nodiscard]] std::string_view method_name() const override { return "sd"; }

  [[nodiscard]] MethodCapabilities capabilities() const override {
    return MethodCapabilities{MethodExecutionMode::kSharedEventQueue, true, true};
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model,
                  std::string* error) override {
    error_.clear();
    context_ = &context;
    step_token_ = EventToken{};
    simulation_ = std::make_unique<ContinuousReplicationModel>(
        model.v2_bytes,
        model.v2_root != nullptr ? model.v2_root->root() : nullptr);
    if (!simulation_->reset(context.config())) {
      if (error != nullptr) *error = "no valid sd equation node in model";
      return false;
    }
    publish_state();
    step_handler_ = context.handlers().add([this](const Event&) { on_step(); });
    if (!simulation_->done()) {
      schedule_next_step();
      if (!error_.empty()) {
        if (error != nullptr) *error = error_;
        return false;
      }
    }
    return true;
  }

  void advance(SimTime) override {}

  void shutdown() override {
    if (context_ != nullptr && step_token_.valid()) {
      context_->scheduler().cancel(step_token_);
      step_token_ = EventToken{};
    }
    if (simulation_ != nullptr) {
      last_metrics_ = simulation_->finish();
      error_ = simulation_->last_error();
    }
    simulation_.reset();
    context_ = nullptr;
  }

  [[nodiscard]] ReplicationMetrics replication_metrics() const override {
    return last_metrics_;
  }

  [[nodiscard]] std::string runtime_error() const override { return error_; }

  [[nodiscard]] bool save_method_checkpoint(
      MethodCheckpoint& checkpoint, std::string* error) const override {
    if (simulation_ == nullptr || context_ == nullptr) {
      if (error != nullptr) *error = "sd runtime is not active";
      return false;
    }
    checkpoint = MethodCheckpoint{};
    checkpoint.method = "sd";
    checkpoint.schema_version = 1;
    checkpoint.now = context_->clock().now();
    if (!simulation_->checkpoint_save(checkpoint.state)) {
      if (error != nullptr) *error = "sd checkpoint_save failed";
      return false;
    }
    return true;
  }

  bool restore_method_checkpoint(const MethodCheckpoint& checkpoint,
                                 std::string* error) override {
    if (simulation_ == nullptr || context_ == nullptr ||
        checkpoint.method != "sd" || checkpoint.schema_version != 1) {
      if (error != nullptr) *error = "unsupported sd checkpoint bundle";
      return false;
    }
    if (step_token_.valid()) {
      context_->scheduler().cancel(step_token_);
      step_token_ = EventToken{};
    }
    context_->clock().reset(checkpoint.now);
    if (!simulation_->checkpoint_restore(checkpoint.state)) {
      if (error != nullptr) *error = "sd checkpoint_restore failed";
      return false;
    }
    publish_state();
    if (!simulation_->done()) schedule_next_step();
    return true;
  }

  std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) *error = "no root model";
      return nullptr;
    }
    return std::make_unique<ContinuousReplicationModel>(model.v2_bytes,
                                                        model.v2_root->root());
  }

 private:
  static constexpr EventType kStepEvent = 0x5D01;
  static constexpr std::int64_t kStepNs = 10'000'000;

  void on_step() {
    step_token_ = EventToken{};
    if (simulation_ == nullptr || !simulation_->step()) return;
    publish_state();
    if (!simulation_->done()) schedule_next_step();
  }

  void publish_state() {
    if (context_ == nullptr || simulation_ == nullptr) return;
    for (const auto& [name, value] : simulation_->last_state()) {
      const std::string variable = "sd::" + name;
      context_->variables().declare(
          variable,
          VariableDeclaration{"sd", "", {"sd", "host"}, {"sd"}});
      context_->variables().set_by("sd", variable, value);
    }
  }

  void schedule_next_step() {
    if (simulation_ != nullptr && simulation_->adaptive_solver() &&
        !simulation_->prepare_next_step()) {
      error_ = simulation_->last_error();
      return;
    }
    const double seconds = simulation_ == nullptr ? 0.01 : simulation_->next_step_seconds();
    const auto delay_ns = static_cast<std::int64_t>(std::llround(seconds * 1e9));
    step_token_ = context_->scheduler().schedule(
        context_->clock().now() + SimTime::from_ns(std::max<std::int64_t>(1, delay_ns)), kStepEvent,
        step_handler_, 0);
  }

  RuntimeContext* context_{nullptr};
  HandlerId step_handler_{0};
  EventToken step_token_{};
  std::unique_ptr<ContinuousReplicationModel> simulation_;
  ReplicationMetrics last_metrics_;
  std::string error_;
};

}  // namespace

void register_sd_method() {
  MethodRegistry::instance().register_method("sd",
                                             [] { return std::make_unique<SdMethod>(); },
      MethodRegistry::Descriptor{"1", {"1"}, MethodFamily::kSystemDynamics,
                                 MethodFormalism::kSd});
}

}  // namespace logicpilot

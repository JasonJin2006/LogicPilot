// Agent method runtime plugin (Method Runtime Layer).

#include "agent_runtime.h"

#include <memory>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

class AgentMethod final : public SimulationMethod {
 public:
  [[nodiscard]] std::string_view method_name() const override { return "agent"; }

  [[nodiscard]] MethodCapabilities capabilities() const override {
    return MethodCapabilities{MethodExecutionMode::kSharedEventQueue, true, false};
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model,
                  std::string* error) override {
    context_ = &context;
    simulation_ = std::make_unique<AgentReplicationModel>(
        model.v2_bytes,
        model.v2_root != nullptr ? model.v2_root->root() : nullptr);
    if (!simulation_->reset(context.config())) {
      if (error != nullptr) *error = "no valid agent node in model";
      return false;
    }
    tick_handler_ = context.handlers().add([this](const Event&) { on_tick(); });
    if (!simulation_->done()) schedule_next_tick();
    return true;
  }

  void advance(SimTime) override {}

  void shutdown() override {
    if (simulation_ != nullptr) last_metrics_ = simulation_->finish();
    simulation_.reset();
    context_ = nullptr;
  }

  [[nodiscard]] ReplicationMetrics replication_metrics() const override {
    return last_metrics_;
  }

  std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override {
    if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
      if (error != nullptr) *error = "no root model";
      return nullptr;
    }
    return std::make_unique<AgentReplicationModel>(model.v2_bytes,
                                                   model.v2_root->root());
  }

 private:
  static constexpr EventType kTickEvent = 0xA001;
  static constexpr std::int64_t kTickNs = 1'000'000'000;

  void on_tick() {
    if (simulation_ == nullptr || !simulation_->step()) return;
    if (!simulation_->done()) schedule_next_tick();
  }

  void schedule_next_tick() {
    context_->scheduler().schedule(
        context_->clock().now() + SimTime::from_ns(kTickNs), kTickEvent,
        tick_handler_, 0);
  }

  RuntimeContext* context_{nullptr};
  HandlerId tick_handler_{0};
  std::unique_ptr<AgentReplicationModel> simulation_;
  ReplicationMetrics last_metrics_;
};

}  // namespace

void register_agent_method() {
  MethodRegistry::instance().register_method("agent",
                                             [] { return std::make_unique<AgentMethod>(); });
}

}  // namespace logicpilot

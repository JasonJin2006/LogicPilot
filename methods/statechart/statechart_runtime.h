// StatechartRuntime - the second Method Runtime (Method Runtime Layer,
// Phase 4): verifies the plugin architecture by wiring a second method
// (statechart) through the same registry/lifecycle as process, with zero
// kernel changes.
//
// Phase 4 lifecycle semantics match the kernel-native batch methods:
// initialize() lowers the model, the first advance() runs one full
// replication with driver defaults, shutdown() releases.
#pragma once

#include <memory>
#include <string>
#include <string_view>

#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {
class RuntimeContext;
struct IrModelFile;
namespace ir::v2 {
struct Node;
}

class StatechartRuntime final : public SimulationMethod {
 public:
  StatechartRuntime() = default;

  [[nodiscard]] std::string_view method_name() const override {
    return "statechart";
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model,
                  std::string* error) override;
  void advance(SimTime until) override;
  void shutdown() override;

  [[nodiscard]] std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override;

  // Metrics of the replication driven by the lifecycle API.
  [[nodiscard]] const ReplicationMetrics& last_metrics() const {
    return last_metrics_;
  }
  [[nodiscard]] ReplicationMetrics replication_metrics() const override {
    return last_metrics_;
  }

 private:
  RuntimeContext* context_{nullptr};
  std::unique_ptr<ReplicationModel> replication_;
  ReplicationMetrics last_metrics_;
  bool ran_{false};
};

// Registers the statechart method runtime under "statechart". Idempotent.
void register_statechart_method();

}  // namespace logicpilot

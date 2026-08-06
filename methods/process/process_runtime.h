// ProcessRuntime - the first Method Runtime (AnyLogic-style process library).
//
// Part of the Method Runtime Layer (docs/specs/method-runtime.md): the
// kernel drives ProcessRuntime through the SimulationMethod lifecycle and
// never sees process-specific artifacts such as source/queue/service. Phase 1
// wraps the legacy flow engines (QueueingFlowSim / ProcessFlowSim) unchanged:
// initialize() lowers the model from the IR, the first advance() runs one
// full replication, shutdown() releases. The modular block runtimes
// (SourceBlock / QueueBlock / ServiceBlock / ...) arrive in Phase 3 and make
// advance() truly incremental.
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

class ProcessRuntime final : public SimulationMethod {
 public:
  ProcessRuntime() = default;

  [[nodiscard]] std::string_view method_name() const override {
    return "process";
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model,
                  std::string* error) override;
  void advance(SimTime until) override;
  void shutdown() override;

  [[nodiscard]] std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) override;

  // Metrics of the replication driven by the lifecycle API (advance()).
  [[nodiscard]] const ReplicationMetrics& last_metrics() const {
    return last_metrics_;
  }

 private:
  // Lower the model root to a runnable flow engine (M/M/1 fast path or the
  // generic ProcessFlowSim engine). Shared by initialize() and
  // to_replication_model(); nullptr (with `error`) when the root is not a
  // runnable process flow.
  static std::unique_ptr<ReplicationModel> lower(
      const ir::v2::Node* model_root, std::string* error);

  RuntimeContext* context_{nullptr};
  std::unique_ptr<ReplicationModel> replication_;
  ReplicationMetrics last_metrics_;
  bool ran_{false};
};

// Registers the process method runtime under "process". Idempotent; called
// by drivers (lpcli, lp-server) and tests that lower process models.
void register_process_method();

// Registers every built-in method runtime (kernel-native + process).
void register_all_methods();

}  // namespace logicpilot

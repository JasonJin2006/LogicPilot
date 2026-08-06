// StatechartReplicationModel - executable interpretation of the v2 IR
// Statechart table (Method Runtime Layer, Phase 4).
//
// A standalone statechart model is a root node carrying
// SemanticsRef{library: "statechart", block: "statechart"} plus a
// `behavior` Statechart table (states / transitions / initial). This model
// lowers that table onto the kernel's table-driven StateMachineDefinition
// engine and drives it in simulation time:
//   * Timeout transitions schedule the next internal event (timeout_value
//     or a sampled timeout_distribution); firing advances the machine.
//   * Message transitions are registered under their message port (dispatch
//     targets for future cross-machine coupling); a self-contained run is
//     timeout-driven.
// ReplicationConfig.arrivals bounds the number of transition steps so
// cyclic statecharts terminate deterministically (like the DEVS internal
// budget). metrics.final_value reports the final state id.
#pragma once

#include <cstdint>
#include <memory>
#include <string>

#include "logicpilot/devs/replication.h"
#include "logicpilot/statemachine/state_machine.h"

namespace logicpilot {
class RuntimeContext;
namespace ir::v2 {
struct Node;
}

class StatechartReplicationModel final : public ReplicationModel {
 public:
  // `root` must carry a `behavior` Statechart table. Returns an invalid
  // model (run() yields zero metrics) when the table cannot be lowered;
  // `error` is filled with the reason.
  explicit StatechartReplicationModel(const ir::v2::Node* root,
                                      std::string* error);
  ~StatechartReplicationModel() override;

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;
  // Kernel-driven mode (SimulationKernel): schedule into the kernel's
  // clock/scheduler/handler registry; the kernel dispatches events.
  void attach(RuntimeContext& context);
  void reset(const ReplicationConfig& config);
  std::size_t advance(SimTime until, TraceRecorder* trace);
  [[nodiscard]] ReplicationMetrics metrics() const;

  // Final state after the last run (test inspection).
  [[nodiscard]] StateId last_state() const;
  [[nodiscard]] std::size_t last_steps() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

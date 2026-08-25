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
#include <functional>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "logicpilot/runtime/replication.h"
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
  void cancel_pending_events();
  std::size_t advance(SimTime until, TraceRecorder* trace);
  [[nodiscard]] ReplicationMetrics metrics() const;
  [[nodiscard]] std::string current_state_name() const;
  [[nodiscard]] std::uint64_t step_count() const;
  [[nodiscard]] bool done() const;
  [[nodiscard]] bool has_pending_events();
  [[nodiscard]] bool failed() const;
  [[nodiscard]] const std::string& failure_reason() const;
  bool dispatch_message(const std::string& port);
  std::vector<std::string> take_emitted_messages();
  // Composite runtimes use this callback to route an emitted message before
  // the shared scheduler advances to the next event.
  void set_emission_callback(std::function<void()> callback);

  // Final state after the last run (test inspection).
  [[nodiscard]] StateId last_state() const;
  [[nodiscard]] std::size_t last_steps() const;

  // Versioned state bundle for a paused/continued statechart replication.
  // Pending timers are canceled and rebuilt against the attached scheduler
  // during restore.
  [[nodiscard]] bool checkpoint_save(
      std::vector<std::uint8_t>& state) const;
  bool checkpoint_restore(std::span<const std::uint8_t> state);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

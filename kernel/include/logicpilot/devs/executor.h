// DevsExecutor - drives a DEVS-lite coupling tree on the kernel scheduler.
//
// load() flattens the (possibly nested) CoupledModel into atomic-level
// routing: every child output port maps to the set of target atom input
// ports, with parent-port pass-through ("." couplings) resolved through all
// nesting levels. run() then executes the classic next-event loop on an
// IEventScheduler:
//   * each atom holds at most one pending internal event at now + ta();
//   * an internal transition fires, its staged outputs are routed
//     synchronously to targets (external transitions preempt the target's
//     pending internal and reschedule it at now + ta()), and the atom is
//     rescheduled;
//   * inject() feeds the root's input ports from the outside.
// Legacy DEVS-lite models retain their historical FIFO behavior. If every
// loaded atom opts into PDEVS semantics, run() switches to a timestamp-batch
// executor: all imminent atoms at a time are collected, outputs are produced
// first, and each destination receives one simultaneous input bag. This is
// the first step toward a fully compiled PDEVS runtime without forcing the
// existing optimized process engines to migrate in one change.
#pragma once

#include <cstdint>
#include <cstddef>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/checkpoint.h"
#include "logicpilot/devs/checkpoint_codec.h"
#include "logicpilot/devs/evidence.h"
#include "logicpilot/devs/port_event.h"
#include "logicpilot/devs/partition_plan.h"
#include "logicpilot/devs/runtime_plan.h"

namespace logicpilot {

class DevsExecutor {
public:
  explicit DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock);
  DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock, EventHandlerRegistry& handlers);

  DevsExecutor(const DevsExecutor&) = delete;
  DevsExecutor& operator=(const DevsExecutor&) = delete;

  // Flatten `root` and schedule every active atom's first internal event.
  // Returns the number of atomic models loaded. Throws std::logic_error on
  // malformed coupling specs (unknown child/port).
  std::size_t load(CoupledModel& root);

  // Deliver an external input on a root-level input port at the current
  // clock time. Unknown ports are ignored (returns false).
  bool inject(const std::string& root_port, std::uint64_t payload = 0);

  // Run the next-event loop until the queue drains or `horizon` is reached.
  // Returns the number of events dispatched.
  std::size_t run(SimTime horizon);

  // Conservative PDEVS timestamp-barrier execution. Atom-local output and
  // transition work may run on fixed partitions, while bag merging, evidence,
  // and scheduler writes are committed in atom-id order. Legacy DEVS-lite
  // models and workers <= 1 fall back to run() unchanged.
  std::size_t run_parallel(SimTime horizon, std::size_t workers);

  [[nodiscard]] DevsPartitionPlan partition_plan(
      std::size_t requested_partitions) const {
    std::vector<std::uint32_t> weights;
    weights.reserve(plan_.atom_count());
    for (std::size_t atom = 0; atom < plan_.atom_count(); ++atom) {
      weights.push_back(plan_.atom(atom)->parallel_weight());
    }
    return DevsPartitionPlan::compile(plan_, requested_partitions, weights);
  }

  // Exclusive upper bound for a conservative partition window. A cross
  // partition message cannot be produced before this time according to the
  // atom lookahead contracts. With zero lookahead this collapses to the next
  // cross-partition event, preserving the timestamp-barrier behavior.
  [[nodiscard]] SimTime conservative_safe_horizon(
      SimTime requested_horizon, std::size_t requested_partitions) const;

  [[nodiscard]] std::size_t atom_count() const { return plan_.atom_count(); }
  [[nodiscard]] const DevsRuntimePlan& plan() const { return plan_; }
  void set_evidence_recorder(DevsEvidenceRecorder* recorder) {
    evidence_ = recorder;
  }
  bool save_checkpoint(DevsCheckpoint& checkpoint,
                       std::string* error = nullptr) const;
  bool restore_checkpoint(const DevsCheckpoint& checkpoint,
                          std::string* error = nullptr);
  bool save_checkpoint_bytes(std::vector<std::uint8_t>& bytes,
                             std::string* error = nullptr) const;
  bool restore_checkpoint_bytes(std::span<const std::uint8_t> bytes,
                                std::string* error = nullptr);
  [[nodiscard]] std::size_t dispatched_total() const { return dispatched_; }
  void set_recovery_epoch(std::uint64_t epoch) { recovery_epoch_ = epoch; }
  [[nodiscard]] std::uint64_t recovery_epoch() const {
    return recovery_epoch_;
  }
  void set_replay_watermarks(std::vector<std::uint64_t> watermarks) {
    replay_watermarks_ = std::move(watermarks);
  }
  [[nodiscard]] const std::vector<std::uint64_t>& replay_watermarks() const {
    return replay_watermarks_;
  }
  // Internal-transition budget for the next run(): after the complete PDEVS
  // timestamp batch that reaches `budget`, the executor stops re-arming
  // atoms, so perpetual emitters terminate deterministically. A simultaneous
  // batch is never split; it may therefore cross a non-aligned budget.
  void set_internal_budget(std::size_t budget) { internal_budget_ = budget; }
  [[nodiscard]] std::size_t internal_transitions() const { return internal_transitions_; }
  [[nodiscard]] bool has_pending_events() const { return !scheduler_.empty(); }
  [[nodiscard]] bool parallel_supported() const {
    return all_pdevs_ && all_parallel_safe_;
  }
  [[nodiscard]] SimulationClock& clock() { return clock_; }

private:
  struct PendingInput {
    PortEvent event;
    std::uint32_t source{kExternalEvidenceSource};
  };
  struct ExtInput {
    std::uint32_t atom{0};
    PortEvent event;
    std::uint32_t source{kExternalEvidenceSource};
  };

  void on_event(const Event& event);
  void deliver_internal(std::uint32_t atom);
  void deliver_external(
      std::uint32_t atom, const PortEvent& input,
      std::uint32_t source = kExternalEvidenceSource);
  void cancel_pending(std::uint32_t atom);
  void reschedule(std::uint32_t atom);
  std::size_t run_pdevs(SimTime horizon);
  std::size_t run_pdevs_parallel(SimTime horizon,
                                 const DevsPartitionPlan& partitions);
  void process_pdevs_round(
      const std::vector<std::uint32_t>& imminent,
      std::vector<std::vector<PendingInput>> initial_inputs = {});
  void process_pdevs_round_parallel(
      const std::vector<std::uint32_t>& imminent,
      std::vector<std::vector<PendingInput>> initial_inputs,
      const DevsPartitionPlan& partitions);

  IEventScheduler& scheduler_;
  SimulationClock& clock_;
  EventHandlerRegistry owned_handlers_;
  EventHandlerRegistry& handlers_;
  HandlerId dispatch_handler_{0};

  DevsRuntimePlan plan_;

  // Runtime state.
  std::vector<EventToken> pending_;
  std::vector<SimTime> pending_at_;
  std::vector<SimTime> last_transition_;
  std::vector<ExtInput> ext_inputs_;
  DevsEvidenceRecorder* evidence_{nullptr};
  bool all_pdevs_{false};
  bool all_parallel_safe_{false};
  std::size_t dispatched_{0};
  std::size_t internal_budget_{0};
  std::size_t internal_transitions_{0};
  std::uint64_t recovery_epoch_{0};
  std::vector<std::uint64_t> replay_watermarks_;
};

}  // namespace logicpilot

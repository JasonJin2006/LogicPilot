// Streaming M/M/1 replication driver for lp-server (task #7).
//
// SimRunner replays the exact event stream of QueueingFlowSim::run()
// (kernel/src/devs/mm1.cpp) but yields control at simulation-time boundaries
// instead of draining the whole replication at once, so the gateway can pace
// frames against wall time. Determinism contract: identical (seed, arrivals,
// warmup) => bit-identical event sequence and metrics. This is guaranteed by
// reusing the same kernel building blocks in the same order:
//   Xoshiro256PlusPlus(seed) -> BinaryHeapScheduler{64} -> identical
//   arrive/depart handlers with identical RNG draw order. Horizon-based
//   slicing only changes WHERE the loop pauses, never which RNG draws or
//   handler calls happen before a given event.
#pragma once

#include <cstdint>
#include <deque>
#include <memory>
#include <vector>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"
#include "wire_frames.h"

namespace logicpilot::server {

struct StreamRunConfig {
  std::uint64_t seed{42};
  std::uint64_t arrivals{4000};
  std::uint64_t warmup_arrivals{200};
  double lambda{0.8};
  double mu{1.0};
};

class SimRunner {
 public:
  // Reset for one fresh replication (clears all flow + stats state).
  void reset(const StreamRunConfig& config);

  // Process events with delivery time <= boundary_ns (same loop as
  // run_until). Returns the number of events dispatched. Safe to call with a
  // boundary before the next event (dispatches nothing).
  std::size_t process_until(std::int64_t boundary_ns);

  // The replication drains completely (all arrivals served and departed).
  [[nodiscard]] bool finished() const { return finished_; }

  [[nodiscard]] std::int64_t now_ns() const { return clock_.now().as_ns(); }

  // Same formulas as QueueingFlowSim::run() at the current clock position.
  [[nodiscard]] ReplicationMetrics metrics() const;

  // --- MM1 scene synthesis (task #7 mapping) -----------------------------

  // Customers currently present: the one in service (state_bits bit0 = 1,
  // pos 0,0) followed by the FIFO queue (waiting, pos_x = slot index).
  // `max_agents` caps the delta list for frame-size budgets.
  void snapshot_agents(std::vector<TickAgent>& out, std::size_t max_agents);

  // queue_length / busy / throughput / mean_wait (cumulative, warmup
  // excluded) / mean_sojourn / arrivals / departures / rep / reps.
  void fill_counters(std::vector<CounterValue>& out, std::uint64_t rep_index,
                     std::uint64_t reps_total) const;

 private:
  StreamRunConfig config_;
  Xoshiro256PlusPlus engine_{0};
  std::unique_ptr<BinaryHeapScheduler> scheduler_;  // rebuilt per replication
  SimulationClock clock_;
  EventHandlerRegistry handlers_;

  // Flow state (mirrors QueueingFlowSim::run locals).
  std::deque<std::uint64_t> queue_;
  std::vector<std::int64_t> arrival_ns_;
  std::uint64_t emitted_{0};
  bool busy_{false};
  std::uint64_t in_system_{0};
  std::uint64_t in_queue_{0};
  std::uint64_t departures_{0};
  bool finished_{false};
  std::uint64_t in_service_id_{0};
  bool has_in_service_{false};

  // Stats accumulators (cumulative sums instead of the kernel's wait_times_
  // vector - bounded memory for arbitrarily long runs).
  std::int64_t last_ns_{0};
  std::int64_t area_system_ns_{0};
  std::int64_t area_queue_ns_{0};
  double sojourn_sum_{0.0};
  std::uint64_t sojourn_count_{0};
  double wait_sum_{0.0};
  std::uint64_t wait_count_{0};

  HandlerId arrive_id_{0};
  HandlerId depart_id_{0};

  QueueingFlowSpec spec_;  // interarrival/service samplers from lambda/mu

  void schedule_depart(std::uint64_t customer);
};

}  // namespace logicpilot::server

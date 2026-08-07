// Built-in M/M/1 queueing model (registered directly in C++, no DSL).
//
// QueueingFlowSim is the generic flow engine
// (source -> FIFO queue -> server pool -> sink) driven by the kernel
// scheduler; Mm1Simulator specializes it with exponential(1/lambda)
// inter-arrivals and exponential(1/mu) service times. The engine supports
// `servers` parallel identical servers (M/M/c) and optional per-server
// failure/recovery (M/M/c with breakdowns, preemptive-repeat). Every
// customer's wait time is recorded (wait = arrival -> final service start).
#pragma once

#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <vector>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/devs/flow_engine.h"

namespace logicpilot {

class RuntimeContext;

// Event-type tags for the M/M/c flow engine. Declared in the header (not
// the .cpp) so the streaming driver (lp-server sim_runner) shares the same
// contract instead of re-declaring "must match" magic numbers.
inline constexpr EventType kArriveEvent = 10;
inline constexpr EventType kDepartEvent = 11;
inline constexpr EventType kFailEvent = 12;
inline constexpr EventType kRepairEvent = 13;

// Samples one duration in seconds from the replication RNG stream.
using TimeSampler = std::function<double(Xoshiro256PlusPlus&)>;

// M/M/c server-pool state (mirrored by the streaming driver's ServerState).
enum class ServerState : std::uint8_t { kIdle = 0, kBusy = 1, kDown = 2 };

struct Server {
  ServerState state{ServerState::kIdle};
  std::uint64_t customer{0};  // customer in service while busy
};

struct QueueingFlowSpec {
  TimeSampler interarrival;
  TimeSampler service;
  std::int64_t queue_capacity{-1};  // < 0: unbounded FIFO (classic M/M/1)
  // Number of parallel identical servers (resource capacity, M/M/c).
  std::int64_t servers{1};
  // Optional server failure law. When non-empty, each server samples a
  // failure time at service start; on failure the customer in service
  // returns to the queue head (preemptive-repeat) and the server repairs
  // after `repair`. Both must be non-empty together; empty = never fails.
  TimeSampler failure;
  TimeSampler repair;
};

class QueueingFlowSim : public FlowEngine {
 public:
  explicit QueueingFlowSim(QueueingFlowSpec spec);

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  // Per-customer wait times recorded by the last run() (warmup excluded).
  [[nodiscard]] const std::vector<double>& wait_times() const {
    return wait_times_;
  }
  // Customers turned away because the queue was at capacity.
  [[nodiscard]] std::uint64_t dropped_count() const { return dropped_; }

  // Method Runtime Layer (Phase 3): the engine is now incremental. reset()
  // prepares one replication (clears state, seeds the RNG, schedules the
  // first arrival); advance(until) dispatches every event with timestamp <=
  // until; metrics() reports the statistics accumulated so far. run() is
  // reset() + advance(infinity) + metrics() and stays bit-identical to the
  // legacy batch call.
  void reset(const ReplicationConfig& config);
  std::size_t advance(SimTime until, TraceRecorder* trace);
  [[nodiscard]] ReplicationMetrics metrics() const;

  // Kernel-driven mode (SimulationKernel driver): schedule into the kernel's
  // clock/scheduler/handler registry instead of per-engine owned facilities.
  void attach(RuntimeContext& context);

 private:
  QueueingFlowSpec spec_;
  std::vector<double> wait_times_;
  std::uint64_t dropped_{0};

  // Per-replication runtime state (owned across reset/advance/metrics).
  ReplicationConfig config_;
  Xoshiro256PlusPlus engine_{0};
  RuntimeContext* external_{nullptr};
  std::unique_ptr<BinaryHeapScheduler> owned_scheduler_;
  SimulationClock owned_clock_;
  EventHandlerRegistry owned_handlers_;

  [[nodiscard]] IEventScheduler& scheduler();
  [[nodiscard]] SimulationClock& clock();
  [[nodiscard]] const SimulationClock& clock() const;
  [[nodiscard]] EventHandlerRegistry& handlers();

  std::deque<std::uint64_t> queue_;              // waiting customer ids (FIFO)
  std::vector<Server> servers_;
  std::vector<std::int64_t> arrival_ns_;         // per-customer arrival stamp
  std::vector<std::int64_t> service_start_ns_;   // per-customer last service
                                                 // start (final wait baseline)
  std::uint64_t emitted_{0};
  std::uint64_t in_system_{0};
  std::uint64_t in_queue_{0};
  std::uint64_t departures_{0};
  std::int64_t busy_servers_{0};
  std::int64_t down_servers_{0};
  bool has_failure_{false};

  // Statistics accumulators.
  std::int64_t last_ns_{0};
  std::int64_t area_system_ns_{0};  // sum of in_system * dt
  std::int64_t area_queue_ns_{0};
  std::int64_t area_busy_ns_{0};    // sum of busy servers * dt
  std::int64_t area_down_ns_{0};    // sum of down servers * dt
  double sojourn_sum_{0.0};
  std::uint64_t sojourn_count_{0};

  HandlerId arrive_id_{0};
  HandlerId depart_id_{0};
  HandlerId fail_id_{0};
  HandlerId repair_id_{0};
};

struct Mm1Params {
  double lambda{0.8};  // arrival rate
  double mu{1.0};      // service rate
};

// Steady-state M/M/1 closed forms (used for acceptance comparisons).
struct Mm1Theory {
  double rho{0.0};
  double wq{0.0};        // mean wait      = rho / (mu - lambda)
  double w{0.0};         // mean sojourn   = 1 / (mu - lambda)
  double lq{0.0};        // mean queue len = rho^2 / (1 - rho)
  double l{0.0};         // mean in system = lambda / (mu - lambda)
  double throughput{0.0};  // effective rate = lambda (no losses)
};
Mm1Theory mm1_theory(double lambda, double mu);

// Steady-state M/M/c closed forms (Erlang-C): parallel identical servers.
// Requires lambda < c * mu. c = 1 degenerates to the M/M/1 formulas.
Mm1Theory mmc_theory(double lambda, double mu, std::int64_t servers);

class Mm1Simulator final : public QueueingFlowSim {
 public:
  explicit Mm1Simulator(Mm1Params params);

  [[nodiscard]] const Mm1Params& params() const { return params_; }
  [[nodiscard]] Mm1Theory theory() const {
    return mm1_theory(params_.lambda, params_.mu);
  }

 private:
  Mm1Params params_;
};

}  // namespace logicpilot

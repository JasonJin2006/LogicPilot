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
#include <functional>
#include <vector>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/replication.h"

namespace logicpilot {

// Samples one duration in seconds from the replication RNG stream.
using TimeSampler = std::function<double(Xoshiro256PlusPlus&)>;

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

class QueueingFlowSim : public ReplicationModel {
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

 private:
  QueueingFlowSpec spec_;
  std::vector<double> wait_times_;
  std::uint64_t dropped_{0};
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

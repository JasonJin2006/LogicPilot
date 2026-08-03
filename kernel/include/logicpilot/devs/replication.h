// Replication framework - metrics, tracing and summary statistics.
//
// Every executable model implements ReplicationModel::run() for one
// replication. TraceRecorder builds a deterministic FNV-1a hash over the
// dispatched event stream (plus final stat bits) - used by the determinism
// acceptance test. summarize_replications() computes per-metric mean/stddev
// and a Student-t confidence interval across replication means.
#pragma once

#include <cstddef>
#include <cstdint>
#include <span>

#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

struct ReplicationConfig {
  std::uint64_t seed{42};
  std::uint64_t arrivals{20000};      // total arrivals per replication
  std::uint64_t warmup_arrivals{2000};  // excluded from per-customer stats
};

struct ReplicationMetrics {
  std::uint64_t arrivals{0};
  std::uint64_t departures{0};
  double horizon_seconds{0.0};   // last event time (run drains completely)
  double throughput{0.0};        // departures per time unit
  double mean_in_system{0.0};    // L  - time-average number in system
  double mean_in_queue{0.0};     // Lq - time-average number waiting
  double mean_sojourn{0.0};      // W  - mean time in system (per customer)
  double mean_wait{0.0};         // Wq - mean wait before service
};

// Deterministic FNV-1a (64-bit) streaming hash over the event trace.
class TraceRecorder {
 public:
  void record(SimTime at, EventType type, std::uint64_t payload) {
    absorb(static_cast<std::uint64_t>(at.as_ns()));
    absorb(static_cast<std::uint64_t>(type));
    absorb(payload);
    ++events_;
  }

  // Fold arbitrary stat bits (e.g. bit-cast doubles) into the same hash.
  void absorb(std::uint64_t value) {
    for (int byte = 0; byte < 8; ++byte) {
      hash_ ^= (value >> (8 * byte)) & 0xFF;
      hash_ *= kFnvPrime;
    }
  }

  [[nodiscard]] std::uint64_t hash() const { return hash_; }
  [[nodiscard]] std::size_t event_count() const { return events_; }

 private:
  static constexpr std::uint64_t kFnvOffset = 0xCBF29CE484222325ULL;
  static constexpr std::uint64_t kFnvPrime = 0x100000001B3ULL;

  std::uint64_t hash_{kFnvOffset};
  std::size_t events_{0};
};

// One executable model: a single replication from seed to completion.
class ReplicationModel {
 public:
  virtual ~ReplicationModel() = default;
  virtual ReplicationMetrics run(const ReplicationConfig& config,
                                 TraceRecorder* trace) = 0;
};

struct MetricSummary {
  double mean{0.0};
  double stddev{0.0};
  double ci_low{0.0};
  double ci_high{0.0};

  [[nodiscard]] bool covers(double value) const {
    return value >= ci_low && value <= ci_high;
  }
};

struct ReplicationSummary {
  std::size_t reps{0};
  double confidence{0.95};
  MetricSummary throughput;
  MetricSummary mean_in_system;
  MetricSummary mean_in_queue;
  MetricSummary mean_sojourn;
  MetricSummary mean_wait;
};

// Two-sided Student-t critical value for `confidence` at `df` degrees of
// freedom (table + normal fallback; more than enough for replication CIs).
double student_t_critical(double confidence, std::size_t df);

ReplicationSummary summarize_replications(
    std::span<const ReplicationMetrics> reps, double confidence = 0.95);

}  // namespace logicpilot

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
#include <functional>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

struct ReplicationConfig {
  std::uint64_t seed{42};
  std::uint64_t arrivals{20000};      // total arrivals per replication
  std::uint64_t warmup_arrivals{2000};  // excluded from per-customer stats
  // Maximum shared-scheduler events dispatched by one run/advance call. A
  // finite default prevents zero-time event storms from hanging the host.
  std::uint64_t max_events{50'000'000};
};

// Per-block DES statistics shared by the CLI, IDE, and AI tools. A negative
// capacity means unbounded or not applicable.
struct BlockMetrics {
  std::string name;
  std::string kind;
  std::uint64_t arrived{0};
  std::uint64_t departed{0};
  std::uint64_t timed_out{0};
  std::uint64_t preempted{0};
  std::int64_t capacity{-1};
  double mean_occupancy{0.0};
  // Mean time from entering this block to its first active processing step,
  // excluding warm-up entities.
  double mean_wait{0.0};
  std::uint64_t wait_count{0};
  double utilization{0.0};
  double availability{1.0};
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
  // TimeMeasureStart/End pair statistic (process library): mean time between
  // the paired marker blocks, and how many agents were measured.
  double mean_measure{0.0};
  std::uint64_t measure_count{0};
  // Milestone 1d: server-pool health (0 for non-flow models).
  double utilization{0.0};       // busy servers / servers, time-averaged
  double availability{0.0};      // 1 - down servers / servers, time-averaged
  // Milestone Phase D: continuous-model final state (first equation).
  double final_value{0.0};
  // Empty for methods without block-level statistics.
  std::vector<BlockMetrics> blocks;
};

struct LogicalStepRecord {
  SimTime at{SimTime::zero()};
  EventType type{0};
  std::uint64_t payload{0};
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

  // Record a deterministic logical step that is not a scheduler event (for
  // example an Agent tick or an accepted Continuous RK4 step). Keeping this
  // channel separate preserves event_count() for legacy scheduler traces
  // while extending the hash with cross-method execution evidence.
  void record_logical_step(SimTime at, EventType type,
                           std::uint64_t payload) {
    absorb(kLogicalStepDomain);
    absorb(static_cast<std::uint64_t>(at.as_ns()));
    absorb(static_cast<std::uint64_t>(type));
    absorb(payload);
    ++logical_steps_;
    if (logical_record_limit_ != 0) {
      if (logical_records_.size() < logical_record_limit_) {
        logical_records_.push_back(LogicalStepRecord{at, type, payload});
      } else {
        logical_records_truncated_ = true;
      }
    }
  }

  // Opt-in readable capture for debuggers and offline replay tools. The hash
  // remains complete even when the bounded record list truncates.
  void enable_logical_step_records(std::size_t limit) {
    logical_record_limit_ = limit;
    logical_records_.clear();
    logical_records_truncated_ = false;
  }

  [[nodiscard]] std::uint64_t hash() const { return hash_; }
  [[nodiscard]] std::size_t event_count() const { return events_; }
  [[nodiscard]] std::size_t logical_step_count() const { return logical_steps_; }
  [[nodiscard]] const std::vector<LogicalStepRecord>& logical_steps() const {
    return logical_records_;
  }
  [[nodiscard]] bool logical_steps_truncated() const {
    return logical_records_truncated_;
  }

 private:
  static constexpr std::uint64_t kLogicalStepDomain =
      0x4C504C4F47494331ULL;  // LPLOGIC1
  static constexpr std::uint64_t kFnvOffset = 0xCBF29CE484222325ULL;
  static constexpr std::uint64_t kFnvPrime = 0x100000001B3ULL;

  std::uint64_t hash_{kFnvOffset};
  std::size_t events_{0};
  std::size_t logical_steps_{0};
  std::size_t logical_record_limit_{0};
  bool logical_records_truncated_{false};
  std::vector<LogicalStepRecord> logical_records_;
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
  MetricSummary mean_measure;
  MetricSummary utilization;
  MetricSummary availability;
  MetricSummary final_value;
};

enum class ReplicationMetric {
  kThroughput,
  kL,
  kLq,
  kW,
  kWq,
  kMeasure,
  kUtilization,
  kAvailability,
  kFinalValue,
};

bool parse_replication_metric(std::string_view name, ReplicationMetric& out);
const MetricSummary& replication_metric_summary(
    const ReplicationSummary& summary, ReplicationMetric metric);
double relative_ci_error_percent(const MetricSummary& summary);
bool replication_precision_reached(const ReplicationSummary& summary,
                                   ReplicationMetric metric,
                                   std::size_t min_reps,
                                   double error_percent);
std::uint64_t random_run_seed();

// Two-sided Student-t critical value for `confidence` at `df` degrees of
// freedom (table + normal fallback; more than enough for replication CIs).
double student_t_critical(double confidence, std::size_t df);

ReplicationSummary summarize_replications(
    std::span<const ReplicationMetrics> reps, double confidence = 0.95);

// Run `reps` replications across up to `threads` worker threads (ADR-0009
// Phase A: replication-level parallelism).
//
// `build` must return a fresh, independent ReplicationModel per call:
// models are NOT safe for concurrent run() on one instance, so every worker
// owns its own instance and reuses it for its assigned replications (the
// same reuse semantics as the sequential loop). Per-replication seeds are
// derived exactly like replication_seed(run_seed, rep) (SeedStreams), so
// the returned metrics are bit-identical to a sequential run, in rep order.
// `threads` 0/1 and `reps` <= 1 fall back to a sequential loop.
std::vector<ReplicationMetrics> run_replications_parallel(
    const std::function<std::unique_ptr<ReplicationModel>()>& build,
    const ReplicationConfig& base_config, std::uint64_t reps,
    std::size_t threads);

}  // namespace logicpilot

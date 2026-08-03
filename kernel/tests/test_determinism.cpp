// Determinism acceptance: same seed => bit-identical event trace + stats.
//
// The trace hash folds every dispatched event (timestamp, type, payload) and
// the final stat bits (FNV-1a). Any hidden nondeterminism (map iteration
// order, address hashing, RNG misuse) flips the hash.
#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;

namespace {

struct RunOutcome {
  std::uint64_t trace_hash{0};
  std::size_t event_count{0};
  ReplicationMetrics metrics;
};

RunOutcome run_mm1_with_trace(std::uint64_t seed) {
  Mm1Simulator simulator{Mm1Params{0.8, 1.0}};
  ReplicationConfig config;
  config.seed = seed;
  config.arrivals = 5000;
  config.warmup_arrivals = 500;
  TraceRecorder trace;
  RunOutcome outcome;
  outcome.metrics = simulator.run(config, &trace);
  outcome.trace_hash = trace.hash();
  outcome.event_count = trace.event_count();
  return outcome;
}

}  // namespace

TEST_CASE("Same seed reproduces the exact event trace and statistics",
          "[determinism][mm1]") {
  const RunOutcome first = run_mm1_with_trace(1234);
  const RunOutcome second = run_mm1_with_trace(1234);

  REQUIRE(first.event_count > 0);
  REQUIRE(first.event_count == second.event_count);
  REQUIRE(first.trace_hash == second.trace_hash);

  // Bit-exact statistics as well.
  REQUIRE(first.metrics.mean_wait == second.metrics.mean_wait);
  REQUIRE(first.metrics.mean_sojourn == second.metrics.mean_sojourn);
  REQUIRE(first.metrics.mean_in_system == second.metrics.mean_in_system);
  REQUIRE(first.metrics.throughput == second.metrics.throughput);
  REQUIRE(first.metrics.departures == second.metrics.departures);
}

TEST_CASE("Different seeds produce different traces", "[determinism][mm1]") {
  const RunOutcome a = run_mm1_with_trace(1);
  const RunOutcome b = run_mm1_with_trace(2);
  REQUIRE(a.trace_hash != b.trace_hash);
}

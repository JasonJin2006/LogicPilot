// Replication-level parallelism tests (ADR-0009 Phase A): parallel workers
// must produce results bit-identical to a sequential run, and per-rep seeds
// must match the canonical replication_seed(run_seed, rep) derivation.
#include <cstdint>
#include <memory>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;

namespace {

std::unique_ptr<ReplicationModel> make_mm1() {
  return std::make_unique<Mm1Simulator>(Mm1Params{0.8, 1.0});
}

ReplicationConfig per_rep_config(const ReplicationConfig& base,
                                 std::uint64_t rep) {
  ReplicationConfig config = base;
  const SeedStreams streams{base.seed};
  config.seed = streams.derive_state(rep)[0];
  return config;
}

bool metrics_equal(const ReplicationMetrics& a, const ReplicationMetrics& b) {
  return a.departures == b.departures &&
         a.horizon_seconds == b.horizon_seconds &&
         a.throughput == b.throughput &&
         a.mean_in_system == b.mean_in_system &&
         a.mean_in_queue == b.mean_in_queue &&
         a.mean_sojourn == b.mean_sojourn &&
         a.mean_wait == b.mean_wait &&
         a.utilization == b.utilization;
}

}  // namespace

TEST_CASE("parallel replications are bit-identical to sequential",
          "[replication][parallel][determinism]") {
  ReplicationConfig base;
  base.seed = 42;
  base.arrivals = 2000;
  base.warmup_arrivals = 200;

  const auto sequential = run_replications_parallel(make_mm1, base, 12, 1);
  const auto parallel = run_replications_parallel(make_mm1, base, 12, 4);
  REQUIRE(sequential.size() == 12);
  REQUIRE(sequential.size() == parallel.size());
  for (std::size_t i = 0; i < sequential.size(); ++i) {
    REQUIRE(metrics_equal(parallel[i], sequential[i]));
  }

  // The aggregated summary is identical across thread counts too.
  const ReplicationSummary s = summarize_replications(sequential, 0.95);
  const ReplicationSummary p = summarize_replications(parallel, 0.95);
  REQUIRE(p.mean_wait.mean == s.mean_wait.mean);
  REQUIRE(p.throughput.mean == s.throughput.mean);
  REQUIRE(p.mean_sojourn.mean == s.mean_sojourn.mean);
}

TEST_CASE("parallel runner derives the canonical per-rep seeds",
          "[replication][parallel]") {
  ReplicationConfig base;
  base.seed = 7;
  base.arrivals = 500;
  base.warmup_arrivals = 50;

  const auto parallel = run_replications_parallel(make_mm1, base, 5, 3);
  std::vector<ReplicationMetrics> manual;
  for (std::uint64_t rep = 0; rep < 5; ++rep) {
    Mm1Simulator simulator{Mm1Params{0.8, 1.0}};
    manual.push_back(simulator.run(per_rep_config(base, rep), nullptr));
  }
  for (std::size_t i = 0; i < manual.size(); ++i) {
    REQUIRE(metrics_equal(parallel[i], manual[i]));
  }
}

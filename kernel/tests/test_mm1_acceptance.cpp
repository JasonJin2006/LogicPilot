// MM1 statistical acceptance test.
//
// Contract source: examples/mm1.expect.json (single source of tolerances).
// Rule: with the fixed seed, run N replications; PASS iff the cross-
// replication 95% CI of mean Wq covers theory.wq (=4.0), or the point
// estimate lies within point_estimate_abs_tol. Fixed seed => deterministic;
// a failure here is a defect (no retries, ever).
#include <cmath>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "expect_json.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;
using logicpilot::testing::json_number;
using logicpilot::testing::json_section;
using logicpilot::testing::read_text_file;

namespace {

constexpr const char* kExpectPath =
    LOGICPILOT_EXAMPLES_DIR "/mm1.expect.json";

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  const SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

}  // namespace

TEST_CASE("MM1 acceptance: Wq CI covers theory (expect.json contract)",
          "[acceptance][mm1]") {
  const std::string text = read_text_file(kExpectPath);
  REQUIRE(!text.empty());

  const std::string params = json_section(text, "params");
  const std::string theory = json_section(text, "theory");
  const std::string acceptance = json_section(text, "acceptance");

  const double lambda = json_number(params, "lambda").value();
  const double mu = json_number(params, "mu").value();
  const auto seed =
      static_cast<std::uint64_t>(json_number(params, "seed").value());
  const auto reps =
      static_cast<std::uint64_t>(json_number(params, "replications").value());
  const auto arrivals = static_cast<std::uint64_t>(
      json_number(params, "arrivals_per_replication").value());
  const auto warmup = static_cast<std::uint64_t>(
      json_number(params, "warmup_arrivals").value());
  const double theory_wq = json_number(theory, "wq").value();
  const double theory_throughput = json_number(theory, "throughput").value();
  const double confidence =
      json_number(acceptance, "confidence_level").value();
  const double point_tol =
      json_number(acceptance, "point_estimate_abs_tol").value();
  const double throughput_rel_tol =
      json_number(acceptance, "throughput_rel_tol").value();

  // Sanity: the closed forms in the contract agree with each other.
  const Mm1Theory closed_form = mm1_theory(lambda, mu);
  REQUIRE(std::abs(closed_form.wq - theory_wq) <= 1e-12);

  Mm1Simulator simulator{Mm1Params{lambda, mu}};
  std::vector<ReplicationMetrics> results;
  results.reserve(reps);
  for (std::uint64_t rep = 0; rep < reps; ++rep) {
    ReplicationConfig config;
    config.seed = replication_seed(seed, rep);
    config.arrivals = arrivals;
    config.warmup_arrivals = warmup;
    ReplicationMetrics metrics = simulator.run(config, nullptr);
    // Every replication drains completely.
    REQUIRE(metrics.departures + simulator.dropped_count() == arrivals);
    REQUIRE(!simulator.wait_times().empty());
    results.push_back(metrics);
  }

  const ReplicationSummary summary = summarize_replications(results,
                                                            confidence);
  INFO("Wq mean=" << summary.mean_wait.mean
                  << " CI=[" << summary.mean_wait.ci_low << ", "
                  << summary.mean_wait.ci_high << "] theory=" << theory_wq);

  const bool ci_covers = summary.mean_wait.covers(theory_wq);
  const bool point_ok =
      std::abs(summary.mean_wait.mean - theory_wq) <= point_tol;
  REQUIRE((ci_covers || point_ok));

  // Throughput tracks lambda within the contract's relative tolerance.
  REQUIRE(std::abs(summary.throughput.mean - theory_throughput) <=
          throughput_rel_tol * theory_throughput);

  // Secondary steady-state sanity (not the acceptance gate; wide bands).
  REQUIRE(summary.mean_sojourn.mean > theory_wq);         // W > Wq
  REQUIRE(summary.mean_in_system.mean > 1.0);             // L > 1 at rho=0.8
}

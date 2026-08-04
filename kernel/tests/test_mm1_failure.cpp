// Milestone-1 flow-engine tests: M/M/c (multi-server) + M/M/1 with server
// breakdowns (preemptive-repeat). Contract source:
//   docs/specs/milestone1-failure-model.md
//   examples/mm1_failure.expect.json
// Acceptance rule (fixed seed, no retries): PASS iff the cross-replication
// 95% CI covers theory.wq, or the point estimate is within the contract
// tolerance. A failure here is a defect.
#include <cmath>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "expect_json.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;
using logicpilot::testing::json_number;
using logicpilot::testing::json_section;
using logicpilot::testing::read_text_file;

namespace {

constexpr const char* kExpectPath =
    LOGICPILOT_EXAMPLES_DIR "/mm1_failure.expect.json";

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  const SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

QueueingFlowSpec make_flow_spec(double lambda, double mu,
                                std::int64_t servers, double failure_rate,
                                double repair_rate) {
  QueueingFlowSpec spec;
  spec.interarrival = [lambda](Xoshiro256PlusPlus& engine) {
    Exponential<Xoshiro256PlusPlus> dist{lambda};
    return dist(engine);
  };
  spec.service = [mu](Xoshiro256PlusPlus& engine) {
    Exponential<Xoshiro256PlusPlus> dist{mu};
    return dist(engine);
  };
  spec.servers = servers;
  if (failure_rate > 0.0) {
    spec.failure = [failure_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{failure_rate};
      return dist(engine);
    };
    spec.repair = [repair_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{repair_rate};
      return dist(engine);
    };
  }
  return spec;
}

ReplicationMetrics run_once(const QueueingFlowSpec& spec, std::uint64_t seed,
                            std::uint64_t arrivals,
                            std::uint64_t warmup) {
  QueueingFlowSim sim{spec};
  ReplicationConfig config;
  config.seed = seed;
  config.arrivals = arrivals;
  config.warmup_arrivals = warmup;
  return sim.run(config, nullptr);
}

}  // namespace

TEST_CASE("mm1_failure acceptance: Wq CI covers breakdown theory "
          "(expect.json contract)",
          "[acceptance][flow][failure]") {
  const std::string text = read_text_file(kExpectPath);
  REQUIRE(!text.empty());

  const std::string params = json_section(text, "params");
  const std::string theory = json_section(text, "theory");
  const std::string acceptance = json_section(text, "acceptance");

  const double lambda = json_number(params, "lambda").value();
  const double mu = json_number(params, "mu").value();
  const double failure_rate = json_number(params, "failure_rate").value();
  const double repair_rate = json_number(params, "repair_rate").value();
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

  // Sanity: the effective service law moments in the contract are
  // consistent with the M/G/1 (Pollaczek-Khinchine) wait formula.
  const double availability = repair_rate / (failure_rate + repair_rate);
  const double mu_eff = availability * mu;
  const double service_mean = 1.0 / mu_eff;
  // Second moment of the effective service time (exponential failure +
  // repair mixture, preemptive-repeat-different). Derived in
  // examples/mm1_failure.expect.json; pinned here as a consistency check.
  const double p = mu / (mu + failure_rate);          // success per attempt
  const double shared = 2.0 / ((mu + failure_rate) * (mu + failure_rate));
  const double failed_branch =
      shared + 2.0 / (repair_rate * repair_rate) +
      2.0 / ((mu + failure_rate) * repair_rate) +
      2.0 * service_mean * (1.0 / (mu + failure_rate) + 1.0 / repair_rate);
  const double service_second_moment =
      (p * shared + (1.0 - p) * failed_branch) / p;
  const double rho_eff = lambda * service_mean;
  const double wq_mg1 =
      lambda * service_second_moment / (2.0 * (1.0 - rho_eff));
  REQUIRE(std::abs(wq_mg1 - theory_wq) <= 1e-6);

  const QueueingFlowSpec spec =
      make_flow_spec(lambda, mu, 1, failure_rate, repair_rate);
  std::vector<ReplicationMetrics> results;
  results.reserve(reps);
  for (std::uint64_t rep = 0; rep < reps; ++rep) {
    const ReplicationMetrics metrics =
        run_once(spec, replication_seed(seed, rep), arrivals, warmup);
    REQUIRE(metrics.departures == arrivals);  // preemption never loses a job
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
  REQUIRE(std::abs(summary.throughput.mean - theory_throughput) <=
          throughput_rel_tol * theory_throughput);
  REQUIRE(summary.mean_sojourn.mean > summary.mean_wait.mean);  // W > Wq
}

TEST_CASE("M/M/c: capacity > 1 beats the single-server queue (Erlang-C)",
          "[acceptance][flow][multiserver]") {
  constexpr double kLambda = 0.8;
  constexpr double kMu = 1.0;
  constexpr std::int64_t kServers = 2;

  // M/M/c degenerates to M/M/1 at c = 1.
  const Mm1Theory c1 = mmc_theory(kLambda, kMu, 1);
  const Mm1Theory mm1 = mm1_theory(kLambda, kMu);
  REQUIRE(std::abs(c1.wq - mm1.wq) <= 1e-12);

  const Mm1Theory theory = mmc_theory(kLambda, kMu, kServers);
  REQUIRE(theory.wq < mm1.wq);  // two servers cut the wait dramatically

  const QueueingFlowSpec spec = make_flow_spec(kLambda, kMu, kServers, 0.0,
                                               1.0);
  std::vector<ReplicationMetrics> results;
  for (std::uint64_t rep = 0; rep < 20; ++rep) {
    results.push_back(run_once(spec, replication_seed(42, rep), 20000, 2000));
  }
  const ReplicationSummary summary = summarize_replications(results, 0.95);
  INFO("M/M/c Wq mean=" << summary.mean_wait.mean
                        << " CI=[" << summary.mean_wait.ci_low << ", "
                        << summary.mean_wait.ci_high << "] theory="
                        << theory.wq);
  const bool ci_covers = summary.mean_wait.covers(theory.wq);
  const bool point_ok =
      std::abs(summary.mean_wait.mean - theory.wq) <= 0.08;
  REQUIRE((ci_covers || point_ok));
  REQUIRE(summary.mean_in_system.mean > summary.mean_in_queue.mean);
}

TEST_CASE("flow engine is deterministic under failures (same seed, "
          "bit-identical metrics)",
          "[flow][failure][determinism]") {
  const QueueingFlowSpec spec = make_flow_spec(0.8, 1.0, 2, 0.2, 1.5);
  const ReplicationMetrics first = run_once(spec, 7, 8000, 800);
  const ReplicationMetrics second = run_once(spec, 7, 8000, 800);
  REQUIRE(first.arrivals == second.arrivals);
  REQUIRE(first.departures == second.departures);
  REQUIRE(first.horizon_seconds == second.horizon_seconds);
  REQUIRE(first.throughput == second.throughput);
  REQUIRE(first.mean_in_system == second.mean_in_system);
  REQUIRE(first.mean_in_queue == second.mean_in_queue);
  REQUIRE(first.mean_sojourn == second.mean_sojourn);
  REQUIRE(first.mean_wait == second.mean_wait);
}

TEST_CASE("no-failure spec is byte-identical to the built-in M/M/1",
          "[flow][regression]") {
  constexpr double kLambda = 0.8;
  constexpr double kMu = 1.0;

  // Spec without failure: must not consume extra RNG draws or schedule extra
  // events, so the metrics match the dedicated Mm1Simulator exactly.
  const QueueingFlowSpec spec = make_flow_spec(kLambda, kMu, 1, 0.0, 1.0);
  const ReplicationMetrics from_spec =
      run_once(spec, replication_seed(42, 0), 20000, 2000);

  Mm1Simulator simulator{Mm1Params{kLambda, kMu}};
  ReplicationConfig config;
  config.seed = replication_seed(42, 0);
  config.arrivals = 20000;
  config.warmup_arrivals = 2000;
  const ReplicationMetrics from_builtin = simulator.run(config, nullptr);

  REQUIRE(from_spec.departures == from_builtin.departures);
  REQUIRE(from_spec.horizon_seconds == from_builtin.horizon_seconds);
  REQUIRE(from_spec.throughput == from_builtin.throughput);
  REQUIRE(from_spec.mean_in_system == from_builtin.mean_in_system);
  REQUIRE(from_spec.mean_in_queue == from_builtin.mean_in_queue);
  REQUIRE(from_spec.mean_sojourn == from_builtin.mean_sojourn);
  REQUIRE(from_spec.mean_wait == from_builtin.mean_wait);
}

// End-to-end acceptance: examples/mm1.lp -> compile -> IR -> kernel
// replication run -> statistics vs examples/mm1.expect.json.
//
// This is the full-chain integration test for the Phase 2b deliverable:
// the DSL-compiled model must satisfy the same tolerance contract as the
// built-in mm1 (test_mm1_acceptance.cpp). Fixed seed => deterministic;
// failures are defects, retries are forbidden (expect.json flaky_policy).
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "expect_json.h"
#include "ir_v2_generated.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/dsl/compile.h"

using namespace logicpilot;
using logicpilot::testing::json_number;
using logicpilot::testing::json_section;
using logicpilot::testing::read_text_file;

namespace {

constexpr const char* kExamplesDir = LOGICPILOT_EXAMPLES_DIR;

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  const SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

}  // namespace

TEST_CASE("E2E: DSL compile -> IR load -> replication stats match "
          "mm1.expect.json",
          "[dsl][e2e][acceptance]") {
  // 1. Compile the DSL source to IR (in-memory, same bytes lpcli writes).
  const std::string source =
      read_text_file(std::string(kExamplesDir) + "/mm1.lp");
  REQUIRE(!source.empty());
  const dsl::CompileResult compiled =
      dsl::compile_source(source, "examples/mm1.lp");
  INFO(logicpilot::dsl::format_diagnostics("examples/mm1.lp",
                                           compiled.diagnostics));
  REQUIRE(compiled.ok);
  REQUIRE(compiled.model_name == "MM1");

  // 2. The IR must load through the kernel's verifier.
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.v2_root != nullptr);
  REQUIRE(loaded.file.v2_root->schema_version() == 2);

  // 3. The IR must lower to an executable replication model.
  std::string build_error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &build_error);
  INFO(build_error);
  REQUIRE(model != nullptr);

  // 4. Run the contract replication set from examples/mm1.expect.json.
  const std::string expect =
      read_text_file(std::string(kExamplesDir) + "/mm1.expect.json");
  REQUIRE(!expect.empty());
  const std::string params = json_section(expect, "params");
  const std::string theory = json_section(expect, "theory");
  const std::string acceptance = json_section(expect, "acceptance");

  const auto seed =
      static_cast<std::uint64_t>(json_number(params, "seed").value());
  const auto reps =
      static_cast<std::uint64_t>(json_number(params, "replications").value());
  const auto arrivals = static_cast<std::uint64_t>(
      json_number(params, "arrivals_per_replication").value());
  const auto warmup = static_cast<std::uint64_t>(
      json_number(params, "warmup_arrivals").value());
  const double theory_wq = json_number(theory, "wq").value();
  const double theory_throughput =
      json_number(theory, "throughput").value();
  const double confidence =
      json_number(acceptance, "confidence_level").value();
  const double point_tol =
      json_number(acceptance, "point_estimate_abs_tol").value();
  const double throughput_rel_tol =
      json_number(acceptance, "throughput_rel_tol").value();

  std::vector<ReplicationMetrics> results;
  results.reserve(reps);
  for (std::uint64_t rep = 0; rep < reps; ++rep) {
    ReplicationConfig config;
    config.seed = replication_seed(seed, rep);
    config.arrivals = arrivals;
    config.warmup_arrivals = warmup;
    results.push_back(model->run(config, nullptr));
  }

  // 5. Acceptance rule (mm1.expect.json): Wq CI covers theory, or the
  //    point estimate is within the absolute tolerance.
  const ReplicationSummary summary =
      summarize_replications(results, confidence);
  INFO("DSL-compiled mm1: Wq mean=" << summary.mean_wait.mean << " CI=["
                                    << summary.mean_wait.ci_low << ", "
                                    << summary.mean_wait.ci_high
                                    << "] theory=" << theory_wq);
  const bool ci_covers = summary.mean_wait.covers(theory_wq);
  const bool point_ok =
      std::abs(summary.mean_wait.mean - theory_wq) <= point_tol;
  REQUIRE((ci_covers || point_ok));

  // Throughput tracks lambda within the contract's relative tolerance.
  REQUIRE(std::abs(summary.throughput.mean - theory_throughput) <=
          throughput_rel_tol * theory_throughput);

  // Secondary steady-state sanity (wide bands, not the acceptance gate).
  REQUIRE(summary.mean_sojourn.mean > summary.mean_wait.mean);  // W > Wq
  REQUIRE(summary.mean_in_system.mean > 1.0);
}

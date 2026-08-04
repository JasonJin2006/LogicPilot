// IR v2 migration tests (Phase B): the v1 -> v2 -> v1 round trip preserves
// the executable model bit-exactly, and v2 files load + run through the
// existing engines via the automatic converter in load_model_buffer.
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/ir_v2_convert.h"
#include "logicpilot/dsl/compile.h"

using namespace logicpilot;

namespace {

IrLoadResult load_v1(const dsl::CompileResult& compiled) {
  IrLoadResult loaded =
      load_model_buffer(compiled.ir_bytes.data(), compiled.ir_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

ReplicationMetrics run_model(const IrLoadResult& loaded, std::uint64_t seed,
                             std::uint64_t arrivals,
                             std::uint64_t warmup) {
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = seed;
  config.arrivals = arrivals;
  config.warmup_arrivals = warmup;
  return model->run(config, nullptr);
}

void check_round_trip(const char* example, std::uint64_t arrivals,
                      std::uint64_t warmup) {
  const dsl::CompileResult compiled = dsl::compile_file(example);
  REQUIRE(compiled.ok);

  // Baseline: the frozen v1 buffer through the existing engine.
  const IrLoadResult baseline = load_v1(compiled);
  const ReplicationMetrics v1_metrics =
      run_model(baseline, 42, arrivals, warmup);

  // v1 -> v2, then load the v2 buffer (auto-converts back to v1 views).
  std::string error;
  const std::vector<std::uint8_t> v2 = convert_v1_to_v2(
      compiled.ir_bytes.data(), compiled.ir_bytes.size(), &error);
  REQUIRE_FALSE(v2.empty());
  const IrLoadResult migrated = load_model_buffer(v2.data(), v2.size());
  REQUIRE(migrated.ok());
  const ReplicationMetrics v2_metrics =
      run_model(migrated, 42, arrivals, warmup);

  // Bit-exact: the v2 round trip must not change simulation outcomes.
  REQUIRE(v2_metrics.departures == v1_metrics.departures);
  REQUIRE(v2_metrics.horizon_seconds == v1_metrics.horizon_seconds);
  REQUIRE(v2_metrics.throughput == v1_metrics.throughput);
  REQUIRE(v2_metrics.mean_in_system == v1_metrics.mean_in_system);
  REQUIRE(v2_metrics.mean_in_queue == v1_metrics.mean_in_queue);
  REQUIRE(v2_metrics.mean_sojourn == v1_metrics.mean_sojourn);
  REQUIRE(v2_metrics.mean_wait == v1_metrics.mean_wait);
  REQUIRE(v2_metrics.utilization == v1_metrics.utilization);
  REQUIRE(v2_metrics.availability == v1_metrics.availability);

  // The reverse direction also round-trips through the loader.
  const std::vector<std::uint8_t> back =
      convert_v2_to_v1(v2.data(), v2.size(), &error);
  REQUIRE_FALSE(back.empty());
  const IrLoadResult again = load_model_buffer(back.data(), back.size());
  REQUIRE(again.ok());
}

}  // namespace

TEST_CASE("v2 round trip preserves mm1_failure bit-exactly",
          "[ir-v2][migration]") {
  check_round_trip(LOGICPILOT_EXAMPLES_DIR "/mm1_failure.lp", 4000, 400);
}

TEST_CASE("v2 round trip preserves the two-server flow bit-exactly",
          "[ir-v2][migration]") {
  check_round_trip(LOGICPILOT_EXAMPLES_DIR "/two_servers.lp", 4000, 400);
}

TEST_CASE("v2 round trip preserves the DEVS atomic model bit-exactly",
          "[ir-v2][migration]") {
  check_round_trip(LOGICPILOT_EXAMPLES_DIR "/pulse_chain.lp", 5, 0);
}

TEST_CASE("v2 round trip preserves the agent model bit-exactly",
          "[ir-v2][migration]") {
  check_round_trip(LOGICPILOT_EXAMPLES_DIR "/agents.lp", 5, 0);
}

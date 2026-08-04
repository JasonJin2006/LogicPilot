// IR v2 migration tests (Phase B): the v1 -> v2 -> v1 round trip preserves
// the executable model bit-exactly, and v2 files load + run through the
// existing engines via the automatic converter in load_model_buffer.
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/ir_agent.h"
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

TEST_CASE("v2 DEVS trees execute natively from the v2 Statechart",
          "[ir-v2][migration][devs]") {
  const dsl::CompileResult compiled =
      dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/pulse_chain.lp");
  REQUIRE(compiled.ok);
  std::string error;
  const std::vector<std::uint8_t> v2 = convert_v1_to_v2(
      compiled.ir_bytes.data(), compiled.ir_bytes.size(), &error);
  REQUIRE_FALSE(v2.empty());

  IrLoadResult loaded = load_model_buffer(v2.data(), v2.size());
  REQUIRE(loaded.ok());
  // The loader keeps the v2 contract so the DEVS path runs without a round
  // trip through the v1 views.
  REQUIRE(loaded.file.v2_root != nullptr);

  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 5;
  config.warmup_arrivals = 0;
  const ReplicationMetrics native = model->run(config, nullptr);
  const ReplicationMetrics baseline =
      run_model(load_v1(compiled), 7, 5, 0);

  REQUIRE(native.arrivals == baseline.arrivals);
  REQUIRE(native.horizon_seconds == baseline.horizon_seconds);

  // The v2-native interpreter applies the Statechart: Sink.seen flipped.
  const auto* devs = dynamic_cast<const DevsReplicationModel*>(model.get());
  REQUIRE(devs != nullptr);
  const CoupledModel* tree = devs->last_tree();
  REQUIRE(tree != nullptr);
  const CoupledModel::Child* sink = tree->find_child("Sink");
  REQUIRE(sink != nullptr);
  const auto* atom =
      dynamic_cast<const IrAtomicModelV2*>(sink->atomic.get());
  REQUIRE(atom != nullptr);
  const auto seen = atom->state("seen");
  REQUIRE(seen.has_value());
  REQUIRE(std::get<bool>(*seen));
}

TEST_CASE("v2 agent trees execute natively from behavior bindings",
          "[ir-v2][migration][agent]") {
  const dsl::CompileResult compiled =
      dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/agents.lp");
  REQUIRE(compiled.ok);
  std::string error;
  const std::vector<std::uint8_t> v2 = convert_v1_to_v2(
      compiled.ir_bytes.data(), compiled.ir_bytes.size(), &error);
  REQUIRE_FALSE(v2.empty());

  IrLoadResult loaded = load_model_buffer(v2.data(), v2.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.v2_root != nullptr);

  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 5;
  config.warmup_arrivals = 0;
  const ReplicationMetrics native = model->run(config, nullptr);
  const ReplicationMetrics baseline =
      run_model(load_v1(compiled), 7, 5, 0);
  REQUIRE(native.arrivals == baseline.arrivals);
  REQUIRE(native.horizon_seconds == baseline.horizon_seconds);

  // The v2-native agent runtime applies the behavior bindings: active toggled.
  const auto* agents = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agents != nullptr);
  REQUIRE(agents->agent_count() == 3);
  REQUIRE(std::get<bool>(agents->agent_state(0).values.at("active")) == false);
  for (const Position& position : agents->last_positions()) {
    REQUIRE(position.x >= 0.0F);
    REQUIRE(position.x <= 1.0F);
  }
}

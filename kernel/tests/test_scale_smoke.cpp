// Scale smoke gate (performance-budget.md #3): a 1M-agent population must
// build and tick within interactive bounds. This is a completion + wall-clock
// smoke, not a precise RSS measurement (the 8 GB budget is enforced on CI
// machines); a regression that balloons memory or stalls the tick loop fails
// here instead of silently landing.
#include <chrono>
#include <memory>
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"

using namespace logicpilot;

TEST_CASE("1M-agent population builds and ticks within the smoke budget",
          "[agent][scale][smoke]") {
  const std::string source =
      "model MegaSwarm {\n"
      "  agent Drone {\n"
      "    count = 1000000\n"
      "    state active = true\n"
      "    on_tick { flip active }\n"
      "  }\n"
      "}\n";
  const dsl::CompileResult compiled =
      dsl::compile_source(source, "mega_swarm.lp");
  REQUIRE(compiled.ok);

  // Load the default v2 contract (the primary lowering output).
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(),
                                          compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  std::string build_error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &build_error);
  REQUIRE(model != nullptr);

  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 2;  // two ticks across the full population
  const auto start = std::chrono::steady_clock::now();
  const ReplicationMetrics metrics = model->run(config, nullptr);
  const double seconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start)
          .count();

  REQUIRE(metrics.arrivals == 2);
  REQUIRE(agent->agent_count() == 1'000'000);
  INFO("1M-agent x 2 ticks took " << seconds << " s");
  REQUIRE(seconds < 30.0);
}

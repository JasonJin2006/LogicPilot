// IR AgentModel execution tests (milestone 1c): DSL agent blocks -> v2 IR ->
// AgentReplicationModel tick loop (built-in behaviors) + determinism.
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <memory>
#include <string>

#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/runtime/simulation_kernel.h"

#include "ir_v2_generated.h"
#include "register.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

constexpr const char* kAgents = LOGICPILOT_EXAMPLES_DIR "/agents.lp";

IrLoadResult load_agents() {
  const dsl::CompileResult compiled = dsl::compile_file(kAgents);
  REQUIRE(compiled.ok);
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("agent DSL lowers to a v2 agent node with count/state/behaviors", "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  REQUIRE(loaded.file.v2_root != nullptr);
  const v2::Node* root = loaded.file.v2_root->root();
  REQUIRE(root != nullptr);
  REQUIRE(root->semantics() != nullptr);
  REQUIRE(root->semantics()->block()->str() == "model");
  REQUIRE(root->children() != nullptr);
  REQUIRE(root->children()->size() == 1);
  const v2::Node* agent = root->children()->Get(0);
  REQUIRE(agent->semantics() != nullptr);
  REQUIRE(agent->semantics()->block()->str() == "agent");
  REQUIRE(agent->behaviors() != nullptr);
  REQUIRE(agent->behaviors()->size() == 2);
  REQUIRE(agent->behaviors()->Get(0)->handler_ref()->str() == "flip");
  REQUIRE(agent->behaviors()->Get(0)->params()->Get(0)->name()->str() == "active");
  REQUIRE(agent->behaviors()->Get(1)->handler_ref()->str() == "bounce");
}

TEST_CASE("AgentReplicationModel runs the tick loop with built-in behaviors", "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 5;  // tick budget
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.arrivals == 5);
  REQUIRE(metrics.horizon_seconds == 5.0);

  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);
  REQUIRE(agent->agent_count() == 3);
  // Initial active=true; five flips -> false.
  REQUIRE(std::get<bool>(agent->agent_state(0).values.at("active")) == false);
  REQUIRE(std::get<bool>(agent->agent_state(2).values.at("active")) == false);
  // The bounce behavior keeps positions inside [0,1]^2.
  for (const Position& position : agent->last_positions()) {
    REQUIRE(position.x >= 0.0F);
    REQUIRE(position.x <= 1.0F);
    REQUIRE(position.y >= 0.0F);
    REQUIRE(position.y <= 1.0F);
  }
}

TEST_CASE(
    "SimulationKernel executes one shared-queue agent runtime with the "
    "requested replication config",
    "[agent][runtime][kernel]") {
  register_all_methods();
  const IrLoadResult loaded = load_agents();
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));

  ReplicationConfig config;
  config.seed = 9;
  config.arrivals = 7;
  const std::vector<ReplicationMetrics> metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(metrics.front().arrivals == 7);
  REQUIRE(metrics.front().horizon_seconds == 7.0);
}

TEST_CASE("SimulationKernel composes agent and system dynamics on one queue",
          "[agent][continuous][runtime][kernel]") {
  register_all_methods();
  const dsl::CompileResult compiled = dsl::compile_source(
      "model Hybrid {\n"
      "  agent People { count = 2 on_tick { noop } }\n"
      "  continuous Field {\n"
      "    param k = 0.5\n"
      "    state y = 1.0\n"
      "    d y/dt = -k*y\n"
      "  }\n"
      "}\n",
      "hybrid.lp");
  REQUIRE(compiled.ok);
  const IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));
  ReplicationConfig config;
  config.arrivals = 5;
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);
  REQUIRE(metrics[0].arrivals == 5);
  REQUIRE(metrics[0].horizon_seconds == 5.0);
  REQUIRE(metrics[1].arrivals == 5);
  REQUIRE(metrics[1].horizon_seconds == Catch::Approx(0.05));
  REQUIRE(kernel.variables().has("sd::y"));
  REQUIRE(std::get<double>(*kernel.variables().get("sd::y")) < 1.0);
}

TEST_CASE("AgentReplicationModel is deterministic (positions + metrics)", "[agent][determinism]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 20;
  const ReplicationMetrics first = model->run(config, nullptr);
  const std::vector<Position> first_positions = agent->last_positions();
  const ReplicationMetrics second = model->run(config, nullptr);
  const std::vector<Position> second_positions = agent->last_positions();

  REQUIRE(first.arrivals == second.arrivals);
  REQUIRE(first.horizon_seconds == second.horizon_seconds);
  REQUIRE(first_positions.size() == second_positions.size());
  for (std::size_t i = 0; i < first_positions.size(); ++i) {
    REQUIRE(first_positions[i].x == second_positions[i].x);
    REQUIRE(first_positions[i].y == second_positions[i].y);
  }
}

TEST_CASE(
    "AgentReplicationModel parallel tick is bit-exact deterministic "
    "(100k agents)",
    "[agent][determinism][parallel]") {
  // Population >= 65536 with multiple cores routes flip/bounce through the
  // parallel_for_entities partition; the same run must reproduce identical
  // positions and state regardless of thread interleaving.
  constexpr const char* kLargeSwarm = R"lp(
model Swarm {
  agent Drone {
    count = 100000
    state active = true
    on_tick { flip active }
    on_tick { bounce }
  }
}
)lp";
  const dsl::CompileResult compiled = dsl::compile_source(kLargeSwarm, "large_swarm.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 5;  // tick budget (flip x5 + bounce each tick)
  const ReplicationMetrics first = model->run(config, nullptr);
  const std::vector<Position> first_positions = agent->last_positions();
  REQUIRE(first.arrivals == 5);
  REQUIRE(agent->agent_count() == 100000);

  const ReplicationMetrics second = model->run(config, nullptr);
  const std::vector<Position> second_positions = agent->last_positions();
  REQUIRE(second.arrivals == 5);
  REQUIRE(first_positions.size() == second_positions.size());
  REQUIRE(first_positions.size() == 100000);

  for (std::size_t i = 0; i < first_positions.size(); ++i) {
    REQUIRE(first_positions[i].x == second_positions[i].x);
    REQUIRE(first_positions[i].y == second_positions[i].y);
    REQUIRE(first_positions[i].x >= 0.0F);
    REQUIRE(first_positions[i].x <= 1.0F);
    REQUIRE(first_positions[i].y >= 0.0F);
    REQUIRE(first_positions[i].y <= 1.0F);
  }
  // Five flips from active=true -> false, checked on the parallel path.
  REQUIRE(std::get<bool>(agent->agent_state(0).values.at("active")) == false);
  REQUIRE(std::get<bool>(agent->agent_state(99999).values.at("active")) == false);
}

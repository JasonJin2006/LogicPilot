// IR AgentModel execution tests (milestone 1c): DSL agent blocks -> F1 IR ->
// AgentReplicationModel tick loop (built-in behaviors) + determinism.
#include <cmath>
#include <memory>
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"

#include "ir_generated.h"

using namespace logicpilot;

namespace {

constexpr const char* kAgents = LOGICPILOT_EXAMPLES_DIR "/agents.lp";

IrLoadResult load_agents() {
  const dsl::CompileResult compiled = dsl::compile_file(kAgents);
  REQUIRE(compiled.ok);
  IrLoadResult loaded =
      load_model_buffer(compiled.ir_bytes.data(), compiled.ir_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("agent DSL lowers to an AgentModel with count/state/behaviors",
          "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  REQUIRE(loaded.file.root != nullptr);
  REQUIRE(loaded.file.root->root()->kind_type() == ir::ModelKind_CoupledModel);
  const ir::CoupledModel* coupled =
      loaded.file.root->root()->kind_as_CoupledModel();
  REQUIRE(coupled->children() != nullptr);
  REQUIRE(coupled->children()->size() == 1);
  REQUIRE(coupled->children()->Get(0)->kind_type() ==
          ir::ModelKind_AgentModel);
  const ir::AgentModel* agent =
      coupled->children()->Get(0)->kind_as_AgentModel();
  REQUIRE(agent->behaviors() != nullptr);
  REQUIRE(agent->behaviors()->size() == 2);
  REQUIRE(agent->behaviors()->Get(0)->handler_ref()->str() == "flip");
  REQUIRE(agent->behaviors()->Get(0)->params()->Get(0)->name()->str() ==
          "active");
  REQUIRE(agent->behaviors()->Get(1)->handler_ref()->str() == "bounce");
}

TEST_CASE("AgentReplicationModel runs the tick loop with built-in behaviors",
          "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
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

TEST_CASE("AgentReplicationModel is deterministic (positions + metrics)",
          "[agent][determinism]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
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

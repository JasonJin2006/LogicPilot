// Statechart end-to-end: DSL source -> compile -> IR -> kernel statechart
// runtime. Proves the AnyLogic-style statechart palette lowers through the
// same chain as process/agent models and executes in simulation time.
#include <cstdint>
#include <memory>
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/dsl/compile.h"
#include "register.h"
#include "statechart_replication.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

constexpr const char* kStatechartSource = R"LP(
model TrafficLight {
  statechart Light {
    initial = Red
    state Red { }
    state Green { }
    state Yellow { }
    transition r_g { from = Red; to = Green; triggeredBy = timeout; timeout = 3.0 }
    transition g_y { from = Green; to = Yellow; triggeredBy = timeout; timeout = 3.0 }
    transition y_r { from = Yellow; to = Red; triggeredBy = timeout; timeout = 1.0 }
  }
}
)LP";

}  // namespace

TEST_CASE("statechart: DSL compiles, lowers and runs in simulation time",
          "[dsl][statechart][e2e]") {
  const dsl::CompileResult compiled =
      dsl::compile_source(kStatechartSource, "traffic_light.lp");
  INFO(logicpilot::dsl::format_diagnostics("traffic_light.lp",
                                           compiled.diagnostics));
  REQUIRE(compiled.ok);
  REQUIRE(compiled.model_name == "TrafficLight");

  // The IR must carry the statechart node with a behavior Statechart table.
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.v2_root != nullptr);
  REQUIRE(loaded.file.v2_root->root() != nullptr);
  REQUIRE(loaded.file.v2_root->root()->children() != nullptr);
  REQUIRE(loaded.file.v2_root->root()->children()->size() == 1);
  const v2::Node* chart_node = loaded.file.v2_root->root()->children()->Get(0);
  REQUIRE(chart_node->semantics() != nullptr);
  REQUIRE(chart_node->semantics()->library() != nullptr);
  REQUIRE(std::string(chart_node->semantics()->library()->str()) ==
          "statechart");
  REQUIRE(chart_node->behavior() != nullptr);
  REQUIRE(chart_node->behavior()->states()->size() == 3);
  REQUIRE(chart_node->behavior()->transitions()->size() == 3);

  // The kernel runtime executes the cycle deterministically.
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(chart_node, &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 6;  // Red->Green->Yellow->Red->Green->Yellow
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  REQUIRE(metrics.departures == 6);
  // 3 + 3 + 1 + 3 + 3 + 1 = 14 time units.
  REQUIRE(metrics.horizon_seconds == 14.0);
  REQUIRE(metrics.final_value == 0.0);  // back in Red (declaration order)
}

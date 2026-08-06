// Statechart method runtime tests (Method Runtime Layer, Phase 4): the
// second method plugin lowers an IR `behavior` Statechart table and runs it
// through the same registry/lifecycle as process, with zero kernel changes.
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_manager.h"
#include "logicpilot/state/variable_store.h"
#include "register.h"
#include "statechart_replication.h"
#include "statechart_runtime.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

// A three-state machine: idle --timeout(1.0)--> active --timeout(2.0)--> done.
std::vector<std::uint8_t> build_statechart_ir() {
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto active =
      v2::CreateState(builder, builder.CreateString("active"));
  const auto done = v2::CreateState(builder, builder.CreateString("done"));

  const auto idle_active = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("active"),
      v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0);
  const auto active_done = v2::CreateTransition(
      builder, builder.CreateString("active"), builder.CreateString("done"),
      v2::TriggerKind_Timeout, 2.0, 0, 0.0, 0, 0, 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::State>>{idle, active, done}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          idle_active, active_done}),
      builder.CreateString("idle"));

  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("TrafficLight"), 0, 0,
                         0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

IrLoadResult load_statechart() {
  const std::vector<std::uint8_t> bytes = build_statechart_ir();
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());
  return result;
}

}  // namespace

TEST_CASE("statechart method: registry resolves and runs the IR table",
          "[runtime][statechart]") {
  register_all_methods();
  register_all_methods();  // idempotent
  REQUIRE(MethodRegistry::instance().contains("statechart"));

  const IrLoadResult model = load_statechart();

  // The loader resolves the root semantics {library: statechart, block:
  // statechart} and delegates to the registered method runtime.
  std::string error;
  auto replication = build_replication_model(model.file, &error);
  REQUIRE(replication != nullptr);
  auto* statechart =
      dynamic_cast<StatechartReplicationModel*>(replication.get());
  REQUIRE(statechart != nullptr);

  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 10;  // generous step budget; the machine ends at "done"
  TraceRecorder trace;
  const ReplicationMetrics metrics =
      statechart->run(config, &trace);

  // idle -> active -> done: exactly two timeout transitions.
  REQUIRE(metrics.departures == 2);
  REQUIRE(metrics.arrivals == 2);
  REQUIRE(metrics.horizon_seconds == 3.0);  // 1.0 + 2.0
  REQUIRE(metrics.final_value == 2.0);      // "done" (declaration order)
  REQUIRE(statechart->last_state() == 2);
  REQUIRE(statechart->last_steps() == 2);
}

TEST_CASE("statechart method: lifecycle API matches the batch path",
          "[runtime][statechart]") {
  register_all_methods();
  const IrLoadResult model = load_statechart();

  auto runtime = MethodRegistry::instance().create("statechart");
  REQUIRE(runtime != nullptr);
  REQUIRE(runtime->method_name() == "statechart");
  std::string error;
  auto batch = runtime->to_replication_model(model.file, &error);
  REQUIRE(batch != nullptr);
  ReplicationConfig config;
  const ReplicationMetrics baseline = batch->run(config, nullptr);

  SimulationClock clock;
  BinaryHeapScheduler scheduler{64};
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, variables};
  REQUIRE(manager.add(std::make_unique<StatechartRuntime>()));
  REQUIRE(manager.initialize(model.file, &error));
  manager.advance(SimTime::infinity());
  manager.shutdown();

  StatechartRuntime direct;
  REQUIRE(direct.initialize(manager.context(), model.file, &error));
  direct.advance(SimTime::infinity());
  const ReplicationMetrics lifecycle = direct.last_metrics();
  REQUIRE(lifecycle.departures == baseline.departures);
  REQUIRE(lifecycle.final_value == baseline.final_value);
  REQUIRE(lifecycle.horizon_seconds == baseline.horizon_seconds);
}

TEST_CASE("statechart method: invalid tables fail lowering with an error",
          "[runtime][statechart]") {
  register_all_methods();
  flatbuffers::FlatBufferBuilder builder;
  // A statechart whose transition references an undeclared state.
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::State>>{
          v2::CreateState(builder, builder.CreateString("idle"))}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          v2::CreateTransition(builder, builder.CreateString("idle"),
                               builder.CreateString("missing"),
                               v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0,
                               0)}),
      builder.CreateString("idle"));
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Bad"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  std::vector<std::uint8_t> bytes(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());
  IrLoadResult loaded = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  auto replication = build_replication_model(loaded.file, &error);
  REQUIRE(replication == nullptr);
  REQUIRE(error.find("unknown state") != std::string::npos);
}

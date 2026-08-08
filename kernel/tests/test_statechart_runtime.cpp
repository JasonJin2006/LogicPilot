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
  EventHandlerRegistry handlers;
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, handlers, variables};
  REQUIRE(manager.add(std::make_unique<StatechartRuntime>()));
  REQUIRE(manager.initialize(model.file, &error));
  manager.advance(SimTime::infinity());
  manager.shutdown();

  // (The world is driver-owned: reset it for the second replication.)
  clock.reset();
  handlers.clear();
  StatechartRuntime direct;
  REQUIRE(direct.initialize(manager.context(), model.file, &error));
  direct.advance(SimTime::infinity());
  const ReplicationMetrics lifecycle = direct.last_metrics();
  REQUIRE(lifecycle.departures == baseline.departures);
  REQUIRE(lifecycle.final_value == baseline.final_value);
  REQUIRE(lifecycle.horizon_seconds == baseline.horizon_seconds);
}

TEST_CASE("statechart method: rate-triggered transitions fire",
          "[runtime][statechart]") {
  register_all_methods();
  // idle --rate(2.0)--> done. The exponential timeout is finite, so the
  // machine must leave idle and land in done.
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto done = v2::CreateState(builder, builder.CreateString("done"));
  const auto idle_done = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("done"),
      v2::TriggerKind_Rate, 0.0, 0, 2.0, 0, 0, 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::State>>{idle, done}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          idle_done}),
      builder.CreateString("idle"));
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("RateChart"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");

  IrLoadResult result = load_model_buffer(builder.GetBufferPointer(),
                                          builder.GetSize());
  REQUIRE(result.ok());
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(result.file.v2_root->root(),
                                                   &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.arrivals = 10;
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.final_value == 1.0);  // "done"
  REQUIRE(metrics.horizon_seconds > 0.0);
}

TEST_CASE("statechart method: final state terminates the machine",
          "[runtime][statechart]") {
  register_all_methods();
  // idle --timeout(1.0)--> finished; `finished` is marked final, so no
  // further transitions are scheduled.
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto finished =
      v2::CreateState(builder, builder.CreateString("finished"));
  const auto idle_finished = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("finished"),
      v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::State>>{idle, finished}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          idle_finished}),
      builder.CreateString("idle"));
  const auto final_param = v2::CreateVar(
      builder, builder.CreateString("final"), v2::VarType_String, false, 0,
      0.0, builder.CreateString("finished"), 0);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("FinalChart"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Var>>{final_param}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");

  IrLoadResult result = load_model_buffer(builder.GetBufferPointer(),
                                          builder.GetSize());
  REQUIRE(result.ok());
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(result.file.v2_root->root(),
                                                   &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.arrivals = 10;
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.final_value == 1.0);  // "finished"
  REQUIRE(metrics.horizon_seconds == 1.0);
  REQUIRE(replication->last_state() == 1);
}

TEST_CASE("statechart method: branch resolves its first enabled exit",
          "[runtime][statechart]") {
  register_all_methods();
  // idle --timeout(1.0)--> branch; branch exits to low (condition true) or
  // high (default). The machine must land in low.
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto branch = v2::CreateState(builder, builder.CreateString("branch"));
  const auto low = v2::CreateState(builder, builder.CreateString("low"));
  const auto high = v2::CreateState(builder, builder.CreateString("high"));
  const auto to_branch = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("branch"),
      v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0);
  const auto to_low = v2::CreateTransition(
      builder, builder.CreateString("branch"), builder.CreateString("low"),
      v2::TriggerKind_Condition, 0.0, 0, 0.0, 0,
      builder.CreateString("true"), 0);
  const auto to_high = v2::CreateTransition(
      builder, builder.CreateString("branch"), builder.CreateString("high"),
      v2::TriggerKind_Condition, 0.0, 0, 0.0, 0,
      builder.CreateString("else"), 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::State>>{
          idle, branch, low, high}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          to_branch, to_low, to_high}),
      builder.CreateString("idle"));
  const auto branch_param = v2::CreateVar(
      builder, builder.CreateString("branch"), v2::VarType_String, false, 0,
      0.0, builder.CreateString("branch"), 0);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("BranchChart"), 0, 0,
                         0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Var>>{branch_param}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");

  IrLoadResult result = load_model_buffer(builder.GetBufferPointer(),
                                          builder.GetSize());
  REQUIRE(result.ok());
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(result.file.v2_root->root(),
                                                   &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.arrivals = 10;
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  // idle -> branch (1) -> low (2): branch forwarding counts as a step.
  REQUIRE(metrics.departures == 2);
  REQUIRE(metrics.final_value == 2.0);  // "low"
  REQUIRE(replication->last_state() == 2);
}

TEST_CASE("statechart method: history state returns to last visited",
          "[runtime][statechart]") {
  register_all_methods();
  // idle --timeout(1.0)--> hist --(history)--> idle: the history state
  // forwards control back to the most recently visited state.
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto hist = v2::CreateState(builder, builder.CreateString("hist"));
  const auto to_hist = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("hist"),
      v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::State>>{idle, hist}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          to_hist}),
      builder.CreateString("idle"));
  const auto history_param = v2::CreateVar(
      builder, builder.CreateString("history"), v2::VarType_String, false, 0,
      0.0, builder.CreateString("hist"), 0);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("HistoryChart"), 0, 0,
                         0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Var>>{history_param}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");

  IrLoadResult result = load_model_buffer(builder.GetBufferPointer(),
                                          builder.GetSize());
  REQUIRE(result.ok());
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(result.file.v2_root->root(),
                                                   &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.arrivals = 2;  // idle -> hist, then history forwards to idle
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  // idle -> hist (1), then history forwards to idle (2).
  REQUIRE(metrics.departures == 2);
  REQUIRE(metrics.final_value == 0.0);  // back in "idle"
  REQUIRE(replication->last_state() == 0);
}

TEST_CASE("statechart method: condition-triggered transition fires on time",
          "[runtime][statechart]") {
  register_all_methods();
  // idle --condition(t >= 3)--> done: the condition is polled and must
  // become true at t = 3.0 (within the poll cadence).
  flatbuffers::FlatBufferBuilder builder;
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto done = v2::CreateState(builder, builder.CreateString("done"));
  const auto idle_done = v2::CreateTransition(
      builder, builder.CreateString("idle"), builder.CreateString("done"),
      v2::TriggerKind_Condition, 0.0, 0, 0.0, 0,
      builder.CreateString("t >= 3"), 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::State>>{idle, done}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Transition>>{
          idle_done}),
      builder.CreateString("idle"));
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("ConditionChart"), 0,
                         0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");

  IrLoadResult result = load_model_buffer(builder.GetBufferPointer(),
                                          builder.GetSize());
  REQUIRE(result.ok());
  std::string error;
  auto replication =
      std::make_unique<StatechartReplicationModel>(result.file.v2_root->root(),
                                                   &error);
  REQUIRE(replication != nullptr);
  ReplicationConfig config;
  config.arrivals = 10;
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.final_value == 1.0);  // "done"
  // The condition becomes true at t = 3.0; the poll cadence (50 ms) adds at
  // most one step, so the horizon is in [3.0, 3.05].
  REQUIRE(metrics.horizon_seconds >= 3.0);
  REQUIRE(metrics.horizon_seconds < 3.1);
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

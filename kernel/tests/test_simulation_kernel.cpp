// SimulationKernel driver tests (Method Runtime spec, section 8): one shared
// event queue drives every attached method runtime.
//
//   * single-method process via the kernel == batch (bit-exact metrics)
//   * single-method statechart via the kernel == batch
//   * multi-method model (process flow + statechart child) composes in one
//     kernel run with a shared scheduler and variable store
//   * same seed reproduces the identical event trace
#include <bit>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "register.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

flatbuffers::Offset<v2::Distribution> distribution(
    flatbuffers::FlatBufferBuilder& builder, std::uint8_t kind,
    std::vector<double> params) {
  return v2::CreateDistribution(builder, kind, builder.CreateVector(params));
}

flatbuffers::Offset<v2::Var> var_int(flatbuffers::FlatBufferBuilder& builder,
                                     const char* name, std::int64_t value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Int,
                       false, value, 0.0, 0, 0);
}

flatbuffers::Offset<v2::Var> var_string(flatbuffers::FlatBufferBuilder& builder,
                                        const char* name, const char* value) {
  return v2::CreateVar(builder, builder.CreateString(name),
                       v2::VarType_String, false, 0, 0.0,
                       builder.CreateString(value), 0);
}

flatbuffers::Offset<v2::Var> var_distribution(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    flatbuffers::Offset<v2::Distribution> dist) {
  return v2::CreateVar(builder, builder.CreateString(name),
                       v2::VarType_Distribution, false, 0, 0.0, 0, dist);
}

flatbuffers::Offset<v2::Node> stage(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const char* kind, std::vector<flatbuffers::Offset<v2::Var>> params) {
  return v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString(name), 0, 0,
                                  0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString(kind), 0, 0),
      0, 0, 0, 0, 0);
}

// M/M/1 process flow (resource + source/queue/service/sink + couplings).
std::vector<flatbuffers::Offset<v2::Node>> process_children(
    flatbuffers::FlatBufferBuilder& builder,
    std::vector<flatbuffers::Offset<v2::Coupling>>& couplings) {
  const auto resource = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Server"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{
          var_int(builder, "capacity", 1)}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString("resource"), 0, 0),
      0, 0, 0, 0, 0);
  const auto arrival = distribution(builder, 4, {0.8});
  const auto service_time = distribution(builder, 3, {1.0});
  const auto source = stage(
      builder, "In", "source",
      {var_distribution(builder, "arrival", arrival)});
  const auto queue = stage(builder, "Q", "queue",
                           {var_int(builder, "capacity", 1000000)});
  const auto service = stage(
      builder, "S", "service",
      {var_distribution(builder, "time", service_time),
       var_string(builder, "resource", "Server")});
  const auto sink = stage(builder, "K", "sink", {});

  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](const char* from, const char* to) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(from), port_out,
        builder.CreateString(to), port_in));
  };
  couple("In", "Q");
  couple("Q", "S");
  couple("S", "K");
  return {resource, source, queue, service, sink};
}

// Three-state machine: idle --timeout(1.0)--> active --timeout(2.0)--> done.
flatbuffers::Offset<v2::Node> statechart_node(
    flatbuffers::FlatBufferBuilder& builder) {
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
  return v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Light"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
}

std::vector<std::uint8_t> build_flat_mm1_ir() {
  flatbuffers::FlatBufferBuilder builder;
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto children = process_children(builder, couplings);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Flat"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(children), builder.CreateVector(couplings), 0, 0,
      0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

std::vector<std::uint8_t> build_statechart_ir() {
  flatbuffers::FlatBufferBuilder builder;
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("TrafficLight"), 0, 0,
                         0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Node>>{statechart_node(builder)}),
      0, 0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

std::vector<std::uint8_t> build_multi_method_ir() {
  flatbuffers::FlatBufferBuilder builder;
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto process = process_children(builder, couplings);
  std::vector<flatbuffers::Offset<v2::Node>> children = process;
  children.push_back(statechart_node(builder));
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Hybrid"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(children), builder.CreateVector(couplings), 0, 0,
      0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

IrLoadResult load(const std::vector<std::uint8_t>& bytes) {
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());
  return result;
}

ReplicationConfig test_config() {
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;
  return config;
}

}  // namespace

TEST_CASE("simulation kernel: single-method process matches the batch path",
          "[runtime][kernel]") {
  register_all_methods();
  const IrLoadResult model = load(build_flat_mm1_ir());

  std::string error;
  auto batch = build_replication_model(model.file, &error);
  REQUIRE(batch != nullptr);
  ReplicationConfig config = test_config();
  TraceRecorder batch_trace;
  const ReplicationMetrics baseline = batch->run(config, &batch_trace);

  SimulationKernel kernel;
  REQUIRE(kernel.load(model.file, &error));
  TraceRecorder kernel_trace;
  const auto metrics = kernel.run(config, &kernel_trace, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);

  const ReplicationMetrics& m = metrics[0];
  REQUIRE(m.departures == baseline.departures);
  REQUIRE(m.horizon_seconds == baseline.horizon_seconds);
  REQUIRE(m.throughput == baseline.throughput);
  REQUIRE(m.mean_in_system == baseline.mean_in_system);
  REQUIRE(m.mean_in_queue == baseline.mean_in_queue);
  REQUIRE(m.mean_sojourn == baseline.mean_sojourn);
  REQUIRE(m.mean_wait == baseline.mean_wait);
  REQUIRE(m.utilization == baseline.utilization);
  REQUIRE(kernel_trace.event_count() == batch_trace.event_count());
  // Fold the same final stat bits the batch engine absorbs (QueueingFlowSim
  // folds mean_wait, mean_sojourn and departures).
  kernel_trace.absorb(std::bit_cast<std::uint64_t>(m.mean_wait));
  kernel_trace.absorb(std::bit_cast<std::uint64_t>(m.mean_sojourn));
  kernel_trace.absorb(m.departures);
  REQUIRE(kernel_trace.hash() == batch_trace.hash());
}

TEST_CASE("simulation kernel: single-method statechart matches the batch path",
          "[runtime][kernel]") {
  register_all_methods();
  const IrLoadResult model = load(build_statechart_ir());

  std::string error;
  auto batch = build_replication_model(model.file, &error);
  REQUIRE(batch != nullptr);
  ReplicationConfig config = test_config();
  const ReplicationMetrics baseline = batch->run(config, nullptr);

  SimulationKernel kernel;
  REQUIRE(kernel.load(model.file, &error));
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(metrics[0].departures == baseline.departures);
  REQUIRE(metrics[0].final_value == baseline.final_value);
  REQUIRE(metrics[0].horizon_seconds == baseline.horizon_seconds);
}

TEST_CASE("simulation kernel: process + statechart compose in one run",
          "[runtime][kernel][multi-method]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());

  const std::vector<std::string> methods = resolve_method_names(model.file);
  REQUIRE(methods.size() == 2);
  REQUIRE(methods[0] == "process");
  REQUIRE(methods[1] == "statechart");

  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  ReplicationConfig config = test_config();
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);

  // Process flow: all arrivals served through the shared scheduler.
  REQUIRE(metrics[0].departures == config.arrivals);
  REQUIRE(metrics[0].mean_sojourn > 3.0);
  REQUIRE(metrics[0].mean_sojourn < 8.0);

  // Statechart child: idle -> active -> done (two timeout transitions).
  REQUIRE(metrics[1].departures == 2);
  REQUIRE(metrics[1].final_value == 2.0);

  // Both ran against ONE kernel clock: both report the same global horizon
  // (the process flow dominates the run time).
  REQUIRE(metrics[0].horizon_seconds == metrics[1].horizon_seconds);
  REQUIRE(metrics[0].horizon_seconds >= 3.0);
}

TEST_CASE("simulation kernel: same seed reproduces the identical trace",
          "[runtime][kernel][determinism]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());

  auto run_once = [&]() {
    SimulationKernel kernel;
    std::string error;
    REQUIRE(kernel.load(model.file, &error));
    ReplicationConfig config = test_config();
    TraceRecorder trace;
    const auto metrics = kernel.run(config, &trace, &error);
    REQUIRE(error.empty());
    REQUIRE(metrics.size() == 2);
    return std::make_pair(trace, metrics);
  };

  const auto [trace1, metrics1] = run_once();
  const auto [trace2, metrics2] = run_once();
  REQUIRE(trace1.event_count() == trace2.event_count());
  REQUIRE(trace1.hash() == trace2.hash());
  REQUIRE(metrics1[0].departures == metrics2[0].departures);
  REQUIRE(metrics1[1].final_value == metrics2[1].final_value);
}

TEST_CASE("simulation kernel: profiler and debug recorder capture the run",
          "[runtime][kernel][profiler]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));

  ReplicationConfig config = test_config();
  TraceRecorder trace;
  DebugRecorder debug;
  SimulationProfile profile;
  const auto metrics = kernel.run(config, &trace, &error, nullptr, &debug,
                                 &profile);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);

  // The debug event stream matches the trace hash input exactly.
  REQUIRE(debug.event_count() == trace.event_count());
  REQUIRE(profile.events_dispatched == debug.event_count());
  REQUIRE(profile.events_dispatched > 0);
  REQUIRE(!profile.events_by_type.empty());
  REQUIRE(profile.wall_seconds >= 0.0);
  std::uint64_t histogram_total = 0;
  for (const auto& [type, count] : profile.events_by_type) {
    (void)type;
    histogram_total += count;
  }
  REQUIRE(histogram_total == profile.events_dispatched);
}

TEST_CASE("simulation kernel: structured diagnostics on failures",
          "[runtime][kernel][diagnostics]") {
  register_all_methods();

  // KR1001: no model loaded.
  {
    SimulationKernel kernel;
    std::vector<RuntimeDiagnostic> diagnostics;
    const auto metrics = kernel.run(test_config(), nullptr, nullptr,
                                    &diagnostics);
    REQUIRE(metrics.empty());
    REQUIRE(diagnostics.size() == 1);
    REQUIRE(diagnostics.front().code == "KR1001");
    REQUIRE(std::string(to_string(diagnostics.front().severity)) == "error");
    REQUIRE(format_runtime_diagnostic(diagnostics.front()).find("KR1001") !=
            std::string::npos);
  }

  // KR1003: model root has no executable method (only a resource child).
  {
    flatbuffers::FlatBufferBuilder builder;
    const auto resource = v2::CreateNode(
        builder,
        v2::CreateMetadata(builder, builder.CreateString("Server"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{
            var_int(builder, "capacity", 1)}),
        0,
        v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                               builder.CreateString("resource"), 0, 0),
        0, 0, 0, 0, 0);
    const auto root = v2::CreateNode(
        builder,
        v2::CreateMetadata(builder, builder.CreateString("Empty"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
        v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                               builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{
            resource}),
        0, 0, 0, 0);
    builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
    const std::vector<std::uint8_t> bytes(
        builder.GetBufferPointer(),
        builder.GetBufferPointer() + builder.GetSize());
    const IrLoadResult loaded = load(bytes);

    SimulationKernel kernel;
    std::string error;
    REQUIRE(kernel.load(loaded.file, &error));
    std::vector<RuntimeDiagnostic> diagnostics;
    const auto metrics = kernel.run(test_config(), nullptr, &error,
                                    &diagnostics);
    REQUIRE(metrics.empty());
    REQUIRE(diagnostics.size() == 1);
    REQUIRE(diagnostics.front().code == "KR1003");
    REQUIRE(error.find("no executable") != std::string::npos);
  }
}

TEST_CASE("simulation kernel: conservation invariant across engines",
          "[runtime][kernel][invariant]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));

  // Process flow: every arrival is eventually served and departs
  // (no losses), even with the statechart child sharing the scheduler.
  ReplicationConfig config = test_config();
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);
  REQUIRE(metrics[0].departures == config.arrivals);
  REQUIRE(metrics[0].mean_in_queue >= 0.0);
  REQUIRE(metrics[1].departures >= 0);
}

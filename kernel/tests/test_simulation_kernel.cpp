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
#include <filesystem>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/runtime/ir_loader.h"
#include "logicpilot/devs/session_checkpoint.h"
#include "logicpilot/runtime/replication.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "logicpilot/runtime/simulation_session.h"
#include "logicpilot/runtime/migration_audit_codec.h"
#include "logicpilot/runtime/migration_audit_store.h"
#include "register.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

IrLoadResult load_pulse_chain_model() {
  const dsl::CompileResult compiled =
      dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/pulse_chain.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded =
      load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

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

// Sender emits `go` at t=1. Receiver has a competing timeout at t=5; when
// the message is routed at the sender's event time it reaches `active`, then
// finishes at t=2. A delayed post-advance route would let the receiver reach
// `expired` at t=5 instead, so this pins event-level composite ordering.
flatbuffers::Offset<v2::Node> coupled_statechart_node(
    flatbuffers::FlatBufferBuilder& builder, const char* name, bool sender) {
  const auto idle = v2::CreateState(builder, builder.CreateString("idle"));
  const auto done = v2::CreateState(builder, builder.CreateString("done"));
  std::vector<flatbuffers::Offset<v2::State>> states{idle, done};
  std::vector<flatbuffers::Offset<v2::Transition>> transitions;
  if (sender) {
    const auto action = v2::CreateAction(
        builder, 0, 0, builder.CreateString("go"));
    const auto actions = builder.CreateVector(
        std::vector<flatbuffers::Offset<v2::Action>>{action});
    transitions.push_back(v2::CreateTransition(
        builder, builder.CreateString("idle"), builder.CreateString("done"),
        v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, actions));
  } else {
    const auto waiting = v2::CreateState(builder, builder.CreateString("waiting"));
    const auto active = v2::CreateState(builder, builder.CreateString("active"));
    const auto expired = v2::CreateState(builder, builder.CreateString("expired"));
    states = {waiting, active, expired, done};
    transitions.push_back(v2::CreateTransition(
        builder, builder.CreateString("waiting"), builder.CreateString("active"),
        v2::TriggerKind_Message, 0.0, 0, 0.0, builder.CreateString("go"), 0, 0));
    transitions.push_back(v2::CreateTransition(
        builder, builder.CreateString("active"), builder.CreateString("done"),
        v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0));
    transitions.push_back(v2::CreateTransition(
        builder, builder.CreateString("waiting"), builder.CreateString("expired"),
        v2::TriggerKind_Timeout, 5.0, 0, 0.0, 0, 0, 0));
  }
  const auto chart = v2::CreateStatechart(
      builder, builder.CreateVector(states), builder.CreateVector(transitions),
      builder.CreateString(sender ? "idle" : "waiting"));
  const auto final_param = v2::CreateVar(
      builder, builder.CreateString("final"), v2::VarType_String, false, 0,
      0.0, builder.CreateString("done"), 0);
  return v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{final_param}),
      0,
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

std::vector<std::uint8_t> build_competing_timeout_statechart_ir() {
  flatbuffers::FlatBufferBuilder builder;
  const auto waiting = v2::CreateState(builder, builder.CreateString("waiting"));
  const auto slow = v2::CreateState(builder, builder.CreateString("slow"));
  const auto fast = v2::CreateState(builder, builder.CreateString("fast"));
  const auto to_slow = v2::CreateTransition(
      builder, builder.CreateString("waiting"), builder.CreateString("slow"),
      v2::TriggerKind_Timeout, 5.0, 0, 0.0, 0, 0, 0);
  const auto to_fast = v2::CreateTransition(
      builder, builder.CreateString("waiting"), builder.CreateString("fast"),
      v2::TriggerKind_Timeout, 1.0, 0, 0.0, 0, 0, 0);
  const auto chart = v2::CreateStatechart(
      builder,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::State>>{
          waiting, slow, fast}),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Transition>>{to_slow, to_fast}),
      builder.CreateString("waiting"));
  const auto child = v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString("Race"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("statechart"),
                             builder.CreateString("statechart"), 0, 0),
      0, 0, chart, 0, 0);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("RaceModel"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{
          var_string(builder, "guard:0", "false"),
          var_string(builder, "guard:1", "true")}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{child}),
      0, 0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() + builder.GetSize());
}

std::vector<std::uint8_t> build_multi_statechart_ir() {
  flatbuffers::FlatBufferBuilder builder;
  const auto sender = coupled_statechart_node(builder, "Sender", true);
  const auto receiver = coupled_statechart_node(builder, "Receiver", false);
  const auto coupling = v2::CreateCoupling(
      builder, builder.CreateString("Sender"), builder.CreateString("go"),
      builder.CreateString("Receiver"), builder.CreateString("go"));
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("CoupledCharts"), 0, 0,
                         0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{sender,
                                                                       receiver}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Coupling>>{coupling}),
      0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() + builder.GetSize());
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

TEST_CASE("statechart competing timeouts keep per-transition identity",
          "[runtime][statechart][timeout]") {
  register_all_methods();
  const IrLoadResult model = load(build_competing_timeout_statechart_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  ReplicationConfig config = test_config();
  config.arrivals = 1;
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  // The one-second transition is declared second. It must win by time, not
  // inherit the first transition's shared timeout event id.
  REQUIRE(metrics[0].final_value == 2.0);
  REQUIRE(metrics[0].horizon_seconds == 1.0);
}

TEST_CASE("simulation kernel: statechart coupling routes at event time",
          "[runtime][kernel][statechart][coupling]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_statechart_ir());
  ReplicationConfig config = test_config();
  config.arrivals = 10;

  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);  // the composite network is one method
  REQUIRE(metrics[0].departures == 3);  // sender + receiver message + timeout
  REQUIRE(metrics[0].horizon_seconds == 2.0);

  SimulationKernel again;
  REQUIRE(again.load(model.file, &error));
  const auto repeated = again.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(repeated.size() == 1);
  REQUIRE(repeated[0].departures == metrics[0].departures);
  REQUIRE(repeated[0].horizon_seconds == metrics[0].horizon_seconds);
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

TEST_CASE("debug recorder can bound long-run event capture",
          "[runtime][kernel][profiler][safety]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));

  DebugRecorder debug{1};
  SimulationProfile profile;
  const auto metrics = kernel.run(test_config(), nullptr, &error, nullptr,
                                  &debug, &profile);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);
  REQUIRE(debug.event_count() == 1);
  REQUIRE(debug.truncated());
  REQUIRE(debug.max_events() == 1);
  REQUIRE(profile.events_dispatched > debug.event_count());
}

TEST_CASE("simulation kernel forwards optional DEVS evidence recorder",
          "[runtime][kernel][devs][evidence]") {
  register_all_methods();
  const IrLoadResult model = load_pulse_chain_model();
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));

  ReplicationConfig config = test_config();
  config.arrivals = 3;
  DevsEvidenceRecorder evidence;
  const auto metrics = kernel.run(config, nullptr, &error, nullptr, nullptr,
                                  nullptr, &evidence);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(evidence.event_count() > 0);
  REQUIRE(evidence.hash() != 0);
  REQUIRE(evidence.records().front().atom_path == "Pulser");
  REQUIRE(evidence.records().back().atom_path == "Sink");
}

TEST_CASE("simulation session advances a shared multi-method world in slices",
          "[runtime][kernel][session]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));

  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);
  ReplicationConfig config = test_config();
  DevsEvidenceRecorder evidence;
  SimulationProfile profile;
  REQUIRE(session->start(config, &error, nullptr, &evidence, &profile));
  REQUIRE(session->active());
  REQUIRE(session->method_count() == 2);

  std::size_t dispatched = 0;
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error, &dispatched));
  REQUIRE(error.empty());
  REQUIRE(session->now() <= 1_s);
  REQUIRE(session->active());
  REQUIRE(dispatched > 0);

  DevsCheckpoint unsupported;
  REQUIRE_FALSE(devs::save_session_checkpoint(*session, unsupported, &error));
  REQUIRE(error.find("requires one checkpointable DEVS runtime") !=
          std::string::npos);
  error.clear();

  const auto metrics = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);
  REQUIRE(!session->active());
  REQUIRE(profile.events_dispatched > 0);
  REQUIRE(metrics[1].final_value == 2.0);
}

TEST_CASE("simulation session restores a DEVS checkpoint through the method API",
          "[runtime][kernel][session][checkpoint]") {
  register_all_methods();
  const IrLoadResult model = load_pulse_chain_model();
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);

  ReplicationConfig config = test_config();
  config.arrivals = 3;
  DevsEvidenceRecorder evidence;
  REQUIRE(session->start(config, &error, nullptr, &evidence));
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error));

  DevsCheckpoint checkpoint;
  REQUIRE(devs::save_session_checkpoint(*session, checkpoint, &error));
  REQUIRE(error.empty());
  evidence.clear();
  REQUIRE(session->advance(3_s, nullptr, nullptr, &error));
  const std::uint64_t first_hash = evidence.hash();

  REQUIRE(devs::restore_session_checkpoint(*session, checkpoint, &error));
  REQUIRE(error.empty());
  REQUIRE(evidence.event_count() == 0);
  REQUIRE(session->advance(3_s, nullptr, nullptr, &error));
  REQUIRE(evidence.hash() == first_hash);
  REQUIRE(session->finish(nullptr, nullptr, &error).size() == 1);
}

TEST_CASE("simulation session restores a versioned Statechart bundle",
          "[runtime][kernel][session][statechart][checkpoint]") {
  register_all_methods();
  const IrLoadResult model = load(build_statechart_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);

  ReplicationConfig config = test_config();
  config.arrivals = 10;
  REQUIRE(session->start(config, &error));
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error));

  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.methods.size() == 1);
  REQUIRE(checkpoint.methods[0].method == "statechart");

  REQUIRE(session->advance(3_s, nullptr, nullptr, &error));
  REQUIRE(session->restore_method_checkpoint(checkpoint, &error));
  REQUIRE(session->now() == 1_s);
  REQUIRE(session->advance(3_s, nullptr, nullptr, &error));
  const auto metrics = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(metrics[0].final_value == 2.0);
}

TEST_CASE("simulation session restores a coupled Statechart network bundle",
          "[runtime][kernel][session][statechart][network][checkpoint]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_statechart_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);
  ReplicationConfig config = test_config();
  config.arrivals = 10;
  REQUIRE(session->start(config, &error));
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error));
  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.methods.size() == 1);
  REQUIRE(checkpoint.methods[0].schema_version == 2);
  REQUIRE(session->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto first = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());

  auto replay = kernel.create_session(&error);
  REQUIRE(replay != nullptr);
  REQUIRE(replay->start(config, &error));
  REQUIRE(replay->advance(1_s, nullptr, nullptr, &error));
  REQUIRE(replay->restore_method_checkpoint(checkpoint, &error));
  REQUIRE(replay->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto second = replay->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(second.size() == first.size());
  REQUIRE(second[0].departures == first[0].departures);
  REQUIRE(second[0].horizon_seconds == first[0].horizon_seconds);
}

TEST_CASE("simulation session restores mixed process and statechart bundles",
          "[runtime][kernel][session][multi-method][checkpoint]") {
  register_all_methods();
  const IrLoadResult model = load(build_multi_method_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  ReplicationConfig config = test_config();
  config.arrivals = 30;

  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);
  REQUIRE(session->start(config, &error));
  session->variables().set("shared_inventory", std::int64_t{17});
  const MessageId message_id = session->messages().publish(
      MessageEnvelope{"urn:test:shared", 1, "application/octet-stream",
                      "process", {1, 2, 3}});
  REQUIRE(message_id != kInvalidMessageId);
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error));
  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.methods.size() == 2);
  REQUIRE(checkpoint.model_fingerprint != 0);
  std::vector<std::uint8_t> checkpoint_archive;
  REQUIRE(session->save_method_checkpoint_bytes(checkpoint_archive, &error));
  REQUIRE(session->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto first = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());

  auto replay = kernel.create_session(&error);
  REQUIRE(replay != nullptr);
  REQUIRE(replay->start(config, &error));
  REQUIRE(replay->variables().get("shared_inventory") == nullptr);
  REQUIRE(replay->advance(1_s, nullptr, nullptr, &error));
  std::vector<std::uint8_t> corrupted_archive = checkpoint_archive;
  corrupted_archive.back() ^= 0x01U;
  REQUIRE_FALSE(replay->restore_method_checkpoint_bytes(corrupted_archive, &error));
  SimulationSessionCheckpoint wrong_model = checkpoint;
  wrong_model.model_fingerprint += 1;
  const auto wrong_model_archive =
      SimulationSessionCheckpointCodec::encode(wrong_model);
  REQUIRE_FALSE(replay->restore_method_checkpoint_bytes(wrong_model_archive,
                                                        &error));
  SessionCheckpointMigrationRegistry session_migrations;
  REQUIRE(session_migrations.register_migration(
      wrong_model.model_fingerprint, checkpoint.model_fingerprint,
      [](const SimulationSessionCheckpoint& source, std::uint64_t target_fp,
         SimulationSessionCheckpoint& target, std::string* migration_error) {
        if (migration_error != nullptr) migration_error->clear();
        target = source;
        target.model_fingerprint = target_fp;
        return true;
      }));
  REQUIRE(replay->restore_method_checkpoint(wrong_model, session_migrations,
                                            &error));
  REQUIRE(session_migrations.audit_log().size() == 1);
  REQUIRE(session_migrations.audit_log()[0].success);
  REQUIRE(session_migrations.audit_log()[0].source_fingerprint ==
          wrong_model.model_fingerprint);
  REQUIRE(session_migrations.audit_log()[0].target_fingerprint ==
          checkpoint.model_fingerprint);

  // Corrupt the second method after the first method's bundle remains valid.
  // Restore must be transactional: the process method and shared world must
  // return to the pre-attempt state when the Statechart method rejects.
  replay->variables().set("shared_inventory", std::int64_t{99});
  const SimTime before_failed_restore = replay->now();
  SimulationSessionCheckpoint partially_invalid = checkpoint;
  REQUIRE(partially_invalid.methods.size() == 2);
  REQUIRE_FALSE(partially_invalid.methods[1].state.empty());
  partially_invalid.methods[1].state[0] ^= 0xFFU;
  REQUIRE_FALSE(replay->restore_method_checkpoint(partially_invalid, &error));
  REQUIRE(error.find("rolled back") != std::string::npos);
  REQUIRE(replay->now() == before_failed_restore);
  const auto* rolled_back_inventory = replay->variables().get("shared_inventory");
  REQUIRE(rolled_back_inventory != nullptr);
  REQUIRE(std::get<std::int64_t>(*rolled_back_inventory) == 99);

  const auto audit_archive = MigrationAuditCodec::encode(
      session_migrations.audit_log());
  std::vector<SessionMigrationAuditEntry> decoded_audit;
  REQUIRE(MigrationAuditCodec::decode(audit_archive, decoded_audit, &error));
  REQUIRE(decoded_audit.size() == 1);
  REQUIRE(decoded_audit[0].success);
  const auto audit_path = std::filesystem::temp_directory_path() /
                          "logicpilot_migration_audit_test.bin";
  std::error_code audit_filesystem_error;
  std::filesystem::remove(audit_path, audit_filesystem_error);
  FileMigrationAuditStore audit_store{audit_path};
  REQUIRE(audit_store.save(session_migrations.audit_log(), &error));
  std::vector<SessionMigrationAuditEntry> loaded_audit;
  REQUIRE(audit_store.load(loaded_audit, &error));
  REQUIRE(loaded_audit.size() == 1);
  REQUIRE(loaded_audit[0].target_fingerprint == checkpoint.model_fingerprint);
  std::filesystem::remove(audit_path, audit_filesystem_error);
  SessionCheckpointMigrationRegistry missing_migration;
  SimulationSessionCheckpoint ignored;
  REQUIRE_FALSE(missing_migration.migrate(
      wrong_model, checkpoint.model_fingerprint + 1, ignored, &error));
  REQUIRE(missing_migration.audit_log().size() == 1);
  REQUIRE_FALSE(missing_migration.audit_log()[0].success);
  SimulationSessionCheckpoint wrong_schema = checkpoint;
  wrong_schema.methods[0].schema_version += 1;
  const auto wrong_schema_archive =
      SimulationSessionCheckpointCodec::encode(wrong_schema);
  REQUIRE_FALSE(replay->restore_method_checkpoint_bytes(wrong_schema_archive,
                                                         &error));
  MethodCheckpointMigrationRegistry migrations;
  REQUIRE(migrations.register_migration(
      "process", 2, 1,
      [](const MethodCheckpoint& source, MethodCheckpoint& target,
         std::string* migration_error) {
        if (migration_error != nullptr) migration_error->clear();
        target = source;
        target.schema_version = 1;
        return true;
      }));
  MethodCheckpointMigrationRegistry chain_migrations;
  REQUIRE(chain_migrations.register_migration(
      "process", 3, 2,
      [](const MethodCheckpoint& source, MethodCheckpoint& target,
         std::string*) {
        target = source;
        target.schema_version = 2;
        return true;
      }));
  REQUIRE(chain_migrations.register_migration(
      "process", 2, 1,
      [](const MethodCheckpoint& source, MethodCheckpoint& target,
         std::string*) {
        target = source;
        target.schema_version = 1;
        return true;
      }));
  MethodCheckpoint chain_source = wrong_schema.methods[0];
  chain_source.schema_version = 3;
  MethodCheckpoint chain_target;
  REQUIRE(chain_migrations.migrate(chain_source, 1, chain_target, &error));
  REQUIRE(chain_target.schema_version == 1);
  REQUIRE(replay->restore_method_checkpoint(wrong_schema, migrations, &error));
  REQUIRE(replay->restore_method_checkpoint_bytes(checkpoint_archive, &error));
  const auto* restored_inventory =
      replay->variables().get("shared_inventory");
  REQUIRE(restored_inventory != nullptr);
  REQUIRE(std::get<std::int64_t>(*restored_inventory) == 17);
  REQUIRE(replay->messages().size() == 1);
  REQUIRE(replay->messages().get(message_id)->type_uri == "urn:test:shared");
  REQUIRE(replay->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto second = replay->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(second.size() == first.size());
  for (std::size_t index = 0; index < first.size(); ++index) {
    REQUIRE(second[index].departures == first[index].departures);
    REQUIRE(second[index].horizon_seconds == first[index].horizon_seconds);
  }
}

TEST_CASE("variable snapshot migration plan renames and converts values",
          "[runtime][checkpoint][migration][variables]") {
  VariableSnapshot source;
  source.name = "old_inventory";
  source.value = std::int64_t{17};
  VariableSnapshotMigrationPlan plan;
  REQUIRE(plan.rename("old_inventory", "inventory"));
  REQUIRE(plan.convert(
      "inventory",
      [](const VariableValue& value, VariableValue& target,
         std::string* error) {
        if (!std::holds_alternative<std::int64_t>(value)) {
          if (error != nullptr) *error = "expected integer inventory";
          return false;
        }
        target = static_cast<double>(std::get<std::int64_t>(value));
        return true;
      }));
  std::vector<VariableSnapshot> migrated;
  const std::vector<VariableSnapshot> sources{source};
  REQUIRE(plan.apply(sources, migrated));
  REQUIRE(migrated.size() == 1);
  REQUIRE(migrated[0].name == "inventory");
  REQUIRE(std::holds_alternative<double>(*migrated[0].value));
  REQUIRE(std::get<double>(*migrated[0].value) == 17.0);

  VariableSnapshot collision = source;
  collision.name = "inventory";
  std::vector<VariableSnapshot> collided;
  const std::vector<VariableSnapshot> collision_sources{source, collision};
  REQUIRE_FALSE(plan.apply(collision_sources, collided));
}

TEST_CASE("message snapshot migration plan renames and converts envelopes",
          "[runtime][checkpoint][migration][messages]") {
  MessageEnvelope source{"urn:legacy:item", 1, "application/octet-stream",
                         "process", {1, 2}};
  MessageSnapshotMigrationPlan plan;
  REQUIRE(plan.rename_type("urn:legacy:item", "urn:v2:item"));
  REQUIRE(plan.convert_type(
      "urn:v2:item",
      [](MessageEnvelope& message, std::string* error) {
        if (message.schema_version != 1) {
          if (error != nullptr) *error = "unexpected message schema";
          return false;
        }
        message.schema_version = 2;
        message.data.push_back(3);
        return true;
      }));
  const std::vector<MessageEnvelope> sources{source};
  std::vector<MessageEnvelope> migrated;
  REQUIRE(plan.apply(sources, migrated));
  REQUIRE(migrated.size() == 1);
  REQUIRE(migrated[0].type_uri == "urn:v2:item");
  REQUIRE(migrated[0].schema_version == 2);
  REQUIRE(migrated[0].data == std::vector<std::uint8_t>{1, 2, 3});
}

TEST_CASE("simulation session restores the Process queueing fast path",
          "[runtime][kernel][session][process][checkpoint]") {
  register_all_methods();
  const IrLoadResult model = load(build_flat_mm1_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);

  ReplicationConfig config = test_config();
  config.arrivals = 100;
  REQUIRE(session->start(config, &error));
  REQUIRE(session->advance(1_s, nullptr, nullptr, &error));

  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.methods.size() == 1);
  REQUIRE(checkpoint.methods[0].method == "process");

  REQUIRE(session->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto first = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(first.size() == 1);

  auto replay = kernel.create_session(&error);
  REQUIRE(replay != nullptr);
  REQUIRE(replay->start(config, &error));
  REQUIRE(replay->advance(1_s, nullptr, nullptr, &error));
  REQUIRE(replay->restore_method_checkpoint(checkpoint, &error));
  REQUIRE(replay->advance(SimTime::infinity(), nullptr, nullptr, &error));
  const auto second = replay->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(second.size() == 1);
  REQUIRE(second[0].departures == first[0].departures);
  REQUIRE(second[0].horizon_seconds == first[0].horizon_seconds);
  REQUIRE(second[0].mean_wait == first[0].mean_wait);
}

TEST_CASE("simulation session keeps the event budget cumulative across advances",
          "[runtime][kernel][session][safety]") {
  register_all_methods();
  const IrLoadResult model = load(build_flat_mm1_ir());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(model.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);

  ReplicationConfig config = test_config();
  config.arrivals = 20;
  config.max_events = 1;
  REQUIRE(session->start(config, &error));
  REQUIRE_FALSE(session->advance(SimTime::infinity(), nullptr, nullptr,
                                 &error));
  REQUIRE(error.find("KR1017") != std::string::npos);

  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.dispatched_events == 1);
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

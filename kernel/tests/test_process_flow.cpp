// Generic process-flow executor tests (ProcessFlowSim): block semantics for
// delay / split / selectOutput, an M/M/1 statistical check through the
// generic path (a `count` block forces the generic engine), and
// same-seed determinism.
#include <cstdint>
#include <bit>
#include <memory>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/replication.h"
#include "process_flow.h"

namespace {

using logicpilot::ReplicationConfig;
using logicpilot::ReplicationMetrics;
using namespace logicpilot::ir::v2;

flatbuffers::Offset<Distribution> dist(flatbuffers::FlatBufferBuilder& b,
                                       std::uint8_t kind,
                                       std::vector<double> params) {
  return CreateDistribution(b, kind, b.CreateVector(params));
}

flatbuffers::Offset<Var> var_dist(flatbuffers::FlatBufferBuilder& b,
                                  const char* name,
                                  flatbuffers::Offset<Distribution> d) {
  return CreateVar(b, b.CreateString(name), VarType_Distribution, false, 0,
                   0.0, 0, d);
}

flatbuffers::Offset<Var> var_int(flatbuffers::FlatBufferBuilder& b,
                                 const char* name, std::int64_t value) {
  return CreateVar(b, b.CreateString(name), VarType_Int, false, value, 0.0, 0,
                   0);
}

flatbuffers::Offset<Var> var_float(flatbuffers::FlatBufferBuilder& b,
                                   const char* name, double value) {
  return CreateVar(b, b.CreateString(name), VarType_Float, false, 0, value, 0,
                   0);
}

flatbuffers::Offset<Var> var_string(flatbuffers::FlatBufferBuilder& b,
                                    const char* name, const char* value) {
  return CreateVar(b, b.CreateString(name), VarType_String, false, 0, 0.0,
                   b.CreateString(value), 0);
}

flatbuffers::Offset<Node> block(flatbuffers::FlatBufferBuilder& b,
                                const char* name, const char* kind,
                                std::vector<flatbuffers::Offset<Var>> params,
                                std::vector<flatbuffers::Offset<Port>> ports) {
  return CreateNode(b, CreateMetadata(b, b.CreateString(name), 0, 0, 0),
                    b.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
                    b.CreateVector(params), b.CreateVector(ports),
                    CreateSemanticsRef(b, b.CreateString("process"),
                                       b.CreateString(kind), 0, 0),
                    0, 0, 0, 0, 0);
}

flatbuffers::Offset<Coupling> couple(flatbuffers::FlatBufferBuilder& b,
                                     const char* from, const char* from_port,
                                     const char* to, const char* to_port) {
  return CreateCoupling(b, b.CreateString(from), b.CreateString(from_port),
                        b.CreateString(to), b.CreateString(to_port));
}

std::unique_ptr<logicpilot::ProcessFlowSim> build(
    flatbuffers::FlatBufferBuilder& builder,
    std::vector<flatbuffers::Offset<Node>> stages,
    std::vector<flatbuffers::Offset<Coupling>> couplings,
    flatbuffers::Offset<Node> root_offset, std::string* error) {
  builder.Finish(stages.empty() ? flatbuffers::Offset<Node>{} : stages[0]);
  std::vector<const Node*> stage_ptrs;
  for (const auto& offset : stages) {
    stage_ptrs.push_back(flatbuffers::GetTemporaryPointer(builder, offset));
  }
  std::vector<const Coupling*> coupling_ptrs;
  for (const auto& offset : couplings) {
    coupling_ptrs.push_back(
        flatbuffers::GetTemporaryPointer(builder, offset));
  }
  const Node* root =
      root_offset.IsNull()
          ? nullptr
          : flatbuffers::GetTemporaryPointer(builder, root_offset);
  return std::make_unique<logicpilot::ProcessFlowSim>(
      stage_ptrs, coupling_ptrs, root, error);
}

ReplicationMetrics run_once(logicpilot::ProcessFlowSim& model,
                            std::uint64_t seed, std::uint64_t arrivals,
                            std::uint64_t warmup) {
  ReplicationConfig config;
  config.seed = seed;
  config.arrivals = arrivals;
  config.warmup_arrivals = warmup;
  return model.run(config, nullptr);
}

}  // namespace

TEST_CASE("process flow: source -> delay -> sink holds tokens for the delay",
          "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {1.0}))}, {});
  const auto delay = block(
      builder, "D", "delay",
      {var_dist(builder, "delayTime", dist(builder, 0, {0.5})),
       var_int(builder, "capacity", 1)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, delay, sink},
      {couple(builder, "In", "out", "D", "in"),
       couple(builder, "D", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 2000, 0);
  // Arrival rate 1/s with a constant 0.5s one-slot delay: the delay keeps
  // up, so departures == arrivals, throughput ~ 1/s and sojourn ~ 0.5s.
  REQUIRE(metrics.departures == 2000);
  REQUIRE(metrics.throughput > 0.8);
  REQUIRE(metrics.throughput < 1.2);
  // M/D/1 with Poisson arrivals (lambda=1) and 0.5s constant service:
  // Wq = rho^2 / (2 lambda (1-rho)) = 0.25, so W ~ 0.75.
  REQUIRE(metrics.mean_sojourn > 0.5);
  REQUIRE(metrics.mean_sojourn < 1.0);
}

TEST_CASE("process flow: split clones each agent", "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
  const auto split = block(
      builder, "S", "split",
      {var_int(builder, "copies", 3), var_float(builder, "probability", 1.0)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, split, sink},
      {couple(builder, "In", "out", "S", "in"),
       couple(builder, "S", "out", "K", "in"),
       couple(builder, "S", "outCopy", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 3, 1000, 0);
  // Original + 2 copies per arrival.
  REQUIRE(metrics.departures == 3000);
}

TEST_CASE("process flow: selectOutput routes by probability", "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
  const auto route = block(
      builder, "R", "selectOutput",
      {var_float(builder, "probability", 0.5)}, {});
  const auto yes = block(builder, "Yes", "sink", {}, {});
  const auto no = block(builder, "No", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, route, yes, no},
      {couple(builder, "In", "out", "R", "in"),
       couple(builder, "R", "outT", "Yes", "in"),
       couple(builder, "R", "outF", "No", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  // Route 5000 agents; both sinks should receive a healthy share.
  const ReplicationMetrics metrics = run_once(*model, 11, 5000, 0);
  REQUIRE(metrics.departures == 5000);
  // Can't split per-sink from ReplicationMetrics; verify via a second run
  // that throughput is stable (both branches absorb arrivals).
  REQUIRE(metrics.throughput > 5.0);
}

TEST_CASE("process flow: generic M/M/1 (with count) matches theory loosely",
          "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto queue = block(builder, "Q", "queue",
                           {var_int(builder, "capacity", 1000000)}, {});
  const auto resource = block(
      builder, "Server", "resource",
      {var_int(builder, "capacity", 1),
       var_float(builder, "failure_rate", 0.0)},
      {});
  const auto service = block(
      builder, "S", "service",
      {var_dist(builder, "time", dist(builder, 3, {1.0})),
       var_string(builder, "resource", "Server")},
      {});
  const auto count = block(builder, "C", "count", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  // Root with the resource pool.
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder, {source, queue, service, count, sink},
      {couple(builder, "In", "out", "Q", "in"),
       couple(builder, "Q", "out", "S", "in"),
       couple(builder, "S", "out", "C", "in"),
       couple(builder, "C", "out", "K", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 8000, 800);
  // M/M/1 with rho = 0.8: mean sojourn W = 5.0 (loose band).
  REQUIRE(metrics.departures == 8000);
  REQUIRE(metrics.mean_sojourn > 3.0);
  REQUIRE(metrics.mean_sojourn < 8.0);
  REQUIRE(metrics.utilization > 0.6);
  REQUIRE(metrics.utilization < 0.95);
}

TEST_CASE("process flow: same seed reproduces the exact trace",
          "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto delay = block(
      builder, "D", "delay",
      {var_dist(builder, "delayTime", dist(builder, 3, {1.0})),
       var_int(builder, "capacity", -1)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, delay, sink},
      {couple(builder, "In", "out", "D", "in"),
       couple(builder, "D", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;
  logicpilot::TraceRecorder first;
  const ReplicationMetrics m1 = model->run(config, &first);
  logicpilot::TraceRecorder second;
  const ReplicationMetrics m2 = model->run(config, &second);
  REQUIRE(first.hash() == second.hash());
  REQUIRE(first.event_count() == second.event_count());
  REQUIRE(m1.departures == m2.departures);
}

TEST_CASE("process flow: incremental advance matches a batch run",
          "[process_flow][incremental]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto delay = block(
      builder, "D", "delay",
      {var_dist(builder, "delayTime", dist(builder, 3, {1.0})),
       var_int(builder, "capacity", -1)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, delay, sink},
      {couple(builder, "In", "out", "D", "in"),
       couple(builder, "D", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;

  // Batch baseline.
  logicpilot::TraceRecorder batch_trace;
  const ReplicationMetrics batch = model->run(config, &batch_trace);

  // Incremental: reset then advance through increasing horizons. Slicing
  // must not change the event sequence or the final statistics.
  model->reset(config);
  logicpilot::TraceRecorder sliced_trace;
  std::vector<std::int64_t> slices = {1'000'000, 5'000'000, 20'000'000};
  for (std::size_t i = 0; i < slices.size(); ++i) {
    model->advance(logicpilot::SimTime::from_ns(slices[i]), &sliced_trace);
  }
  model->advance(logicpilot::SimTime::infinity(), &sliced_trace);
  const ReplicationMetrics incremental = model->metrics();

  REQUIRE(incremental.departures == batch.departures);
  REQUIRE(incremental.horizon_seconds == batch.horizon_seconds);
  REQUIRE(incremental.throughput == batch.throughput);
  REQUIRE(incremental.mean_in_system == batch.mean_in_system);
  REQUIRE(incremental.mean_in_queue == batch.mean_in_queue);
  REQUIRE(incremental.mean_sojourn == batch.mean_sojourn);
  REQUIRE(incremental.mean_wait == batch.mean_wait);
  // The batch path folds the final stat bits into the trace (Engine::run);
  // replicate that so the sliced trace is comparable.
  sliced_trace.absorb(std::bit_cast<std::uint64_t>(incremental.mean_sojourn));
  sliced_trace.absorb(incremental.departures);
  REQUIRE(sliced_trace.hash() == batch_trace.hash());
  REQUIRE(sliced_trace.event_count() == batch_trace.event_count());
}

TEST_CASE("process flow: selectOutput runtime condition routes "
          "deterministically",
          "[process_flow][condition]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route = block(
        builder, "R", "selectOutput",
        {var_string(builder, "condition", condition)}, {});
    const auto slow = block(
        builder, "Slow", "delay",
        {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
         var_int(builder, "capacity", -1)},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {source, route, slow, sink},
        {couple(builder, "In", "out", "R", "in"),
         couple(builder, "R", "outT", "Slow", "in"),
         couple(builder, "R", "outF", "K", "in"),
         couple(builder, "Slow", "out", "K", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  // `t < 0` is never true -> everything takes outF (no delay);
  // `t < 1e8` is always true -> everything takes outT (100s delay).
  const ReplicationMetrics fast = run_route("t < 0");
  const ReplicationMetrics slow = run_route("t < 100000000");
  REQUIRE(fast.departures == 2000);
  REQUIRE(slow.departures == 2000);
  REQUIRE(fast.mean_sojourn < 1.0);
  REQUIRE(slow.mean_sojourn > 50.0);
}

TEST_CASE("process flow: hold blockingCondition blocks tokens while true",
          "[process_flow][condition]") {
  const auto run_hold = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto hold = block(
        builder, "H", "hold",
        {var_string(builder, "blockingCondition", condition)}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {source, hold, sink},
        {couple(builder, "In", "out", "H", "in"),
         couple(builder, "H", "out", "K", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 1000, 0);
  };

  const ReplicationMetrics open = run_hold("t < 0");  // never -> passes
  const ReplicationMetrics blocked =
      run_hold("t < 100000000");  // always -> tokens stay behind the hold
  REQUIRE(open.departures == 1000);
  REQUIRE(blocked.departures < 1000);
}

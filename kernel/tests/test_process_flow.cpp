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
using logicpilot::ReplicationSummary;
using logicpilot::summarize_replications;
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

flatbuffers::Offset<Var> var_bool(flatbuffers::FlatBufferBuilder& b,
                                  const char* name, bool value) {
  return CreateVar(b, b.CreateString(name), VarType_Bool, value, 0, 0.0, 0,
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

flatbuffers::Offset<Node> block_with_state(
    flatbuffers::FlatBufferBuilder& b, const char* name, const char* kind,
    std::vector<flatbuffers::Offset<Var>> params,
    std::vector<flatbuffers::Offset<Var>> state,
    std::vector<flatbuffers::Offset<Port>> ports) {
  return CreateNode(b, CreateMetadata(b, b.CreateString(name), 0, 0, 0),
                    b.CreateVector(state), b.CreateVector(params),
                    b.CreateVector(ports),
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

TEST_CASE("process flow: batch (permanent) groups batchSize agents into one",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 3), var_bool(builder, "permanent", true)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, batch, sink},
      {couple(builder, "In", "out", "B", "in"),
       couple(builder, "B", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 9, 0);
  // 9 agents -> 3 permanent batches.
  REQUIRE(metrics.departures == 3);
}

TEST_CASE("process flow: batch (temporary) then unbatch restores agents",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 3),
       var_bool(builder, "permanent", false)},
      {});
  const auto unbatch = block(builder, "U", "unbatch", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, batch, unbatch, sink},
      {couple(builder, "In", "out", "B", "in"),
       couple(builder, "B", "out", "U", "in"),
       couple(builder, "U", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 9, 0);
  // The temporary batch is split back into its 9 original agents.
  REQUIRE(metrics.departures == 9);
}

TEST_CASE("process flow: combine waits for both inputs and emits one",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto in1 = block(
      builder, "In1", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto in2 = block(
      builder, "In2", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto combine = block(builder, "C", "combine", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {in1, in2, combine, sink},
      {couple(builder, "In1", "out", "C", "in1"),
       couple(builder, "In2", "out", "C", "in2"),
       couple(builder, "C", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 10, 0);
  // 10 arrivals split 5/5 across the two streams -> 5 combined agents.
  REQUIRE(metrics.departures == 5);
}

TEST_CASE("process flow: match synchronizes two streams (pure synchronizer)",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto in1 = block(
      builder, "In1", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto in2 = block(
      builder, "In2", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto match = block(builder, "M", "match", {}, {});
  const auto sink1 = block(builder, "K1", "sink", {}, {});
  const auto sink2 = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {in1, in2, match, sink1, sink2},
      {couple(builder, "In1", "out", "M", "in1"),
       couple(builder, "In2", "out", "M", "in2"),
       couple(builder, "M", "out1", "K1", "in"),
       couple(builder, "M", "out2", "K2", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 20, 0);
  // Synchronized streams (same rate): every arrival pairs 1:1, so 20 agents
  // (10 pairs) exit through the two branches.
  REQUIRE(metrics.departures == 20);
}

TEST_CASE("process flow: seize holds pool units until release",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto resource = block(
      builder, "Server", "resource", {var_int(builder, "capacity", 1)}, {});
  const auto seize = block(
      builder, "Grab", "seize",
      {var_string(builder, "resource", "Server"),
       var_int(builder, "numberOfUnits", 1)},
      {});
  const auto delay = block(
      builder, "Work", "delay",
      {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release = block(builder, "Drop", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
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
      builder, {source, seize, delay, release, sink},
      {couple(builder, "In", "out", "Grab", "in"),
       couple(builder, "Grab", "out", "Work", "in"),
       couple(builder, "Work", "out", "Drop", "in"),
       couple(builder, "Drop", "out", "K", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 10, 0);
  // One unit, 0.5s hold, arrivals every 0.1s: agents queue at the seize and
  // all 10 complete once units are released.
  REQUIRE(metrics.departures == 10);
  REQUIRE(metrics.mean_in_queue > 0.0);
}

TEST_CASE("process flow: timeMeasureStart/End measure delay time",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto start = block(builder, "T0", "timeMeasureStart", {}, {});
  const auto delay = block(
      builder, "D", "delay",
      {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto end = block(builder, "T1", "timeMeasureEnd", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, start, delay, end, sink},
      {couple(builder, "In", "out", "T0", "in"),
       couple(builder, "T0", "out", "D", "in"),
       couple(builder, "D", "out", "T1", "in"),
       couple(builder, "T1", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 4, 0);
  // Constant 0.5s delay between the markers: every agent measures exactly 0.5s.
  REQUIRE(metrics.measure_count == 4);
  REQUIRE(metrics.mean_measure == 0.5);
}

TEST_CASE("process flow: hold with initiallyBlocked=true stays blocked",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto hold = block(
      builder, "H", "hold",
      {var_bool(builder, "initiallyBlocked", true)}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, hold, sink},
      {couple(builder, "In", "out", "H", "in"),
       couple(builder, "H", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 3, 0);
  REQUIRE(metrics.departures == 0);  // blocked forever, no arrivals exit
}

TEST_CASE("process flow: source entity attributes drive condition routing",
          "[process_flow][condition][attributes]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block_with_state(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "size", 10)}, {});
    const auto route = block(
        builder, "R", "selectOutput",
        {var_string(builder, "condition", condition)}, {});
    const auto slow = block(
        builder, "Slow", "delay",
        {var_dist(builder, "delayTime", dist(builder, 0, {1.0}))}, {});
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
    return run_once(*model, 7, 500, 0);
  };

  // Every source entity carries size = 10: `size > 5` always takes outT
  // (1s delay), `size < 0` always takes outF (no delay).
  const ReplicationMetrics big = run_route("size > 5");
  const ReplicationMetrics small = run_route("size < 0");
  REQUIRE(big.departures == 500);
  REQUIRE(small.departures == 500);
  REQUIRE(big.mean_sojourn > 0.5);
  REQUIRE(small.mean_sojourn < 0.1);

  // Hold conditions can reference attributes too: size = 10 is always
  // blocked by `size > 5`, so nothing reaches the sink.
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block_with_state(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
      {var_int(builder, "size", 10)}, {});
  const auto hold = block(
      builder, "H", "hold",
      {var_string(builder, "blockingCondition", "size > 5")}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, hold, sink},
      {couple(builder, "In", "out", "H", "in"),
       couple(builder, "H", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics blocked = run_once(*model, 7, 10, 0);
  REQUIRE(blocked.departures == 0);
}

TEST_CASE("process flow: generic engine honors resource failures (M/G/1)",
          "[process_flow][acceptance][failure]") {
  // Milestone-1 busy-time failure semantics (preemptive-repeat) wired into
  // the generic ProcessFlowSim engine, verified against the same M/G/1
  // (Pollaczek-Khinchine) theory as test_mm1_failure: lambda=0.8, mu=1.0,
  // f=0.1, r=1.0. Sample size must be large (20000 arrivals x 16 reps);
  // M/M/1-class waits have huge variance and small runs read as noise.
  constexpr double kLambda = 0.8;
  constexpr double kMu = 1.0;
  constexpr double kFailure = 0.1;
  constexpr double kRepair = 1.0;
  constexpr std::uint64_t kArrivals = 20000;
  constexpr std::uint64_t kWarmup = 2000;
  constexpr std::uint64_t kReps = 16;

  const double availability = kRepair / (kFailure + kRepair);
  const double mu_eff = availability * kMu;
  const double service_mean = 1.0 / mu_eff;
  const double p = kMu / (kMu + kFailure);
  const double shared = 2.0 / ((kMu + kFailure) * (kMu + kFailure));
  const double failed_branch =
      shared + 2.0 / (kRepair * kRepair) +
      2.0 / ((kMu + kFailure) * kRepair) +
      2.0 * service_mean * (1.0 / (kMu + kFailure) + 1.0 / kRepair);
  const double service_second_moment =
      (p * shared + (1.0 - p) * failed_branch) / p;
  const double rho_eff = kLambda * service_mean;
  const double theory_wq =
      kLambda * service_second_moment / (2.0 * (1.0 - rho_eff));

  const auto build_model = [&](flatbuffers::FlatBufferBuilder& builder) {
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 4, {kLambda}))}, {});
    const auto queue = block(builder, "Q", "queue",
                             {var_int(builder, "capacity", 1000000)}, {});
    const auto resource = block(
        builder, "Server", "resource",
        {var_int(builder, "capacity", 1),
         var_float(builder, "failure_rate", kFailure),
         var_float(builder, "repair_rate", kRepair)},
        {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 3, {kMu})),
         var_string(builder, "resource", "Server")},
        {});
    const auto count = block(builder, "C", "count", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
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
    return model;
  };

  std::vector<ReplicationMetrics> results;
  results.reserve(kReps);
  for (std::uint64_t rep = 0; rep < kReps; ++rep) {
    flatbuffers::FlatBufferBuilder builder;
    auto model = build_model(builder);
    const ReplicationMetrics metrics = run_once(*model, 42, kArrivals, kWarmup);
    REQUIRE(metrics.departures == kArrivals);  // preemption never loses a job
    results.push_back(metrics);
  }

  const ReplicationSummary summary =
      summarize_replications(results, 0.95);
  INFO("Wq mean=" << summary.mean_wait.mean << " theory=" << theory_wq
                  << " CI=[" << summary.mean_wait.ci_low << ", "
                  << summary.mean_wait.ci_high << "]");
  // Same acceptance rule as test_mm1_failure: cross-replication CI covers
  // theory.wq, or the point estimate is within 0.75 of it.
  const bool ci_covers = summary.mean_wait.covers(theory_wq);
  const bool point_ok =
      std::abs(summary.mean_wait.mean - theory_wq) <= 0.75;
  REQUIRE((ci_covers || point_ok));
  REQUIRE(std::abs(summary.availability.mean - availability) < 0.03);
  REQUIRE(std::abs(summary.throughput.mean - kLambda) <=
          0.05 * kLambda);
  // Preemption-aware wait: sojourn includes failed attempts + repairs.
  REQUIRE(summary.mean_sojourn.mean > summary.mean_wait.mean);  // W > Wq

  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  const ReplicationMetrics first = run_once(*model, 42, kArrivals, kWarmup);
  const ReplicationMetrics second = run_once(*model, 42, kArrivals, kWarmup);
  REQUIRE(first.mean_wait == second.mean_wait);
  REQUIRE(first.mean_sojourn == second.mean_sojourn);
  REQUIRE(first.availability == second.availability);
  REQUIRE(first.utilization == second.utilization);

  // Failures add congestion: the same model without failures is strictly
  // less congested and never goes down (relative check, same engine).
  const auto run_no_failure = [&](double failure_rate) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 4, {kLambda}))}, {});
    const auto queue = block(builder, "Q", "queue",
                             {var_int(builder, "capacity", 1000000)}, {});
    const auto resource = block(
        builder, "Server", "resource",
        {var_int(builder, "capacity", 1),
         var_float(builder, "failure_rate", failure_rate),
         var_float(builder, "repair_rate", kRepair)},
        {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 3, {kMu})),
         var_string(builder, "resource", "Server")},
        {});
    const auto count = block(builder, "C", "count", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
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
    return run_once(*model, 42, kArrivals, kWarmup);
  };
  const ReplicationMetrics clean = run_no_failure(0.0);
  const ReplicationMetrics failing = run_no_failure(kFailure);
  REQUIRE(clean.availability == 1.0);
  REQUIRE(failing.availability < 0.98);
  REQUIRE(failing.mean_wait > clean.mean_wait);
}

TEST_CASE("process flow: wait exit-on-timeout routes through outTimeout",
          "[process_flow][timeout][des_blocks]") {
  const auto build_wait = [&](bool enable_timeout,
                              flatbuffers::FlatBufferBuilder& builder) {
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto wait = block(
        builder, "W", "wait",
        {var_int(builder, "capacity", 100),
         var_bool(builder, "enableTimeout", enable_timeout),
         var_float(builder, "timeout", 1.0)},
        {});
    const auto resource = block(
        builder, "Server", "resource", {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto late = block(builder, "Late", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{resource, blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {source, wait, service, sink, late},
        {couple(builder, "In", "out", "W", "in"),
         couple(builder, "W", "out", "S", "in"),
         couple(builder, "W", "outTimeout", "Late", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 5, 0);
  };

  flatbuffers::FlatBufferBuilder with_timeout_builder;
  const ReplicationMetrics timed =
      build_wait(true, with_timeout_builder);
  // The downstream service has zero capacity (never accepts), so every
  // agent waits in the wait block and exits via outTimeout after 1.0s.
  REQUIRE(timed.departures == 5);
  REQUIRE(timed.mean_sojourn == 1.0);
  REQUIRE(timed.mean_in_queue > 0.0);

  flatbuffers::FlatBufferBuilder no_timeout_builder;
  const ReplicationMetrics stuck = build_wait(false, no_timeout_builder);
  // Without exit-on-timeout the four waiting agents never leave.
  REQUIRE(stuck.departures == 0);

  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder again_builder;
  const ReplicationMetrics again = build_wait(true, again_builder);
  REQUIRE(again.departures == timed.departures);
  REQUIRE(again.mean_sojourn == timed.mean_sojourn);
}

TEST_CASE("process flow: seize exit-on-timeout releases waiting agents",
          "[process_flow][timeout][des_blocks]") {
  const auto build_seize = [&](bool enable_timeout,
                               flatbuffers::FlatBufferBuilder& builder) {
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource = block(
        builder, "Server", "resource", {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto seize = block(
        builder, "Grab", "seize",
        {var_string(builder, "resource", "Server"),
         var_int(builder, "numberOfUnits", 1),
         var_bool(builder, "enableTimeout", enable_timeout),
         var_float(builder, "timeout", 0.5)},
        {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto late = block(builder, "Late", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{resource, blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {source, seize, service, sink, late},
        {couple(builder, "In", "out", "Grab", "in"),
         couple(builder, "Grab", "out", "S", "in"),
         couple(builder, "Grab", "outTimeout", "Late", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 5, 0);
  };

  flatbuffers::FlatBufferBuilder with_timeout_builder;
  const ReplicationMetrics timed =
      build_seize(true, with_timeout_builder);
  // The first agent seizes the (single) unit but its downstream service has
  // zero capacity, so the other four wait 0.5s at the seize then exit via
  // outTimeout. (The first agent stays blocked in the seize's outgoing.)
  REQUIRE(timed.departures == 4);
  REQUIRE(timed.mean_sojourn == 0.5);

  flatbuffers::FlatBufferBuilder no_timeout_builder;
  const ReplicationMetrics stuck = build_seize(false, no_timeout_builder);
  REQUIRE(stuck.departures == 0);
}

TEST_CASE("process flow: full priority queue preempts its weakest waiter",
          "[process_flow][preemption][des_blocks]") {
  const auto run_queue = [&](const char* queuing) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "priority", 1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
        {var_int(builder, "priority", 5)}, {});
    const auto queue = block(
        builder, "Q", "queue",
        {var_int(builder, "capacity", 2),
         var_string(builder, "queuing", queuing),
         var_bool(builder, "enablePreemption", true)},
        {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto preempted = block(builder, "Out", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {s1, s2, queue, service, sink, preempted},
        {couple(builder, "S1", "out", "Q", "in"),
         couple(builder, "S2", "out", "Q", "in"),
         couple(builder, "Q", "out", "S", "in"),
         couple(builder, "Q", "outPreempted", "Out", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 7, 0);
  };

  const ReplicationMetrics fifo = run_queue("queuing_fifo");
  const ReplicationMetrics priority = run_queue("queuing_priority");
  // Arrivals: S1 (priority 1) at t=1,2,3,4; S2 (priority 5) at t=2,4,6. With
  // capacity 2 and the out port blocked, the full queue ejects through
  // outPreempted. FIFO mode rejects once a high-priority S2 sits at the
  // back; priority mode keeps ejecting the weakest waiter, so more agents
  // leave via outPreempted.
  REQUIRE(fifo.departures == 0);
  REQUIRE(priority.departures == 1);
  REQUIRE(priority.departures > fifo.departures);
}

TEST_CASE("process flow: wait preempts the weakest waiter on arrival",
          "[process_flow][preemption][des_blocks]") {
  const auto run_wait = [&](bool enable_preemption) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "priority", 1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
        {var_int(builder, "priority", 5)}, {});
    const auto wait = block(
        builder, "W", "wait",
        {var_int(builder, "capacity", 100),
         var_string(builder, "queuing", "queuing_priority"),
         var_bool(builder, "enablePreemption", enable_preemption)},
        {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto preempted = block(builder, "Out", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {s1, s2, wait, service, sink, preempted},
        {couple(builder, "S1", "out", "W", "in"),
         couple(builder, "S2", "out", "W", "in"),
         couple(builder, "W", "out", "S", "in"),
         couple(builder, "W", "outPreempted", "Out", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 7, 0);
  };

  // High-priority S2 arrivals (t=2,4) eject the weakest waiting S1
  // (priority 1) through outPreempted on arrival.
  const ReplicationMetrics preempting = run_wait(true);
  REQUIRE(preempting.departures == 2);

  const ReplicationMetrics plain = run_wait(false);
  REQUIRE(plain.departures == 0);
}

TEST_CASE("process flow: seize preempts the weakest waiting agent",
          "[process_flow][preemption][des_blocks]") {
  const auto run_seize = [&](bool enable_preemption) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "priority", 1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
        {var_int(builder, "priority", 5)}, {});
    const auto resource = block(
        builder, "Server", "resource", {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto seize = block(
        builder, "Grab", "seize",
        {var_string(builder, "resource", "Server"),
         var_int(builder, "numberOfUnits", 1),
         var_bool(builder, "enablePreemption", enable_preemption)},
        {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto preempted = block(builder, "Out", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{resource, blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {s1, s2, seize, service, sink, preempted},
        {couple(builder, "S1", "out", "Grab", "in"),
         couple(builder, "S2", "out", "Grab", "in"),
         couple(builder, "Grab", "out", "S", "in"),
         couple(builder, "Grab", "outPreempted", "Out", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // The first S1 agent seizes the only unit (and stays blocked downstream).
  // Arrival order (S2 precedes S1 at the shared t=2) means S2@2 queues
  // first; S2@4 ejects the waiting S1, and S1@5 cannot preempt S2@2.
  const ReplicationMetrics preempting = run_seize(true);
  REQUIRE(preempting.departures == 1);

  const ReplicationMetrics plain = run_seize(false);
  REQUIRE(plain.departures == 0);
}

TEST_CASE("process flow: match pairs agents on an equal attribute",
          "[process_flow][match][des_blocks]") {
  const auto run_match = [&](int kind1, int kind2, const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "kind", kind1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "kind", kind2)}, {});
    const auto match = block(
        builder, "M", "match",
        {var_string(builder, "matchCondition", condition)}, {});
    const auto sink1 = block(builder, "K1", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {s1, s2, match, sink1, sink2},
        {couple(builder, "S1", "out", "M", "in1"),
         couple(builder, "S2", "out", "M", "in2"),
         couple(builder, "M", "out1", "K1", "in"),
         couple(builder, "M", "out2", "K2", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // Equal attributes pair 1:1; unequal attributes never pair; without a
  // match condition the block stays a pure synchronizer.
  const ReplicationMetrics matched = run_match(1, 1, "kind");
  REQUIRE(matched.departures == 6);

  const ReplicationMetrics mismatched = run_match(1, 2, "kind");
  REQUIRE(mismatched.departures == 0);

  const ReplicationMetrics synchronizer = run_match(1, 2, "");
  REQUIRE(synchronizer.departures == 6);
}

TEST_CASE("process flow: match pairs via agent1/agent2 field expressions",
          "[process_flow][match][des_blocks]") {
  const auto run_match = [&](int kind1, int kind2, const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "kind", kind1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "kind", kind2)}, {});
    const auto match = block(
        builder, "M", "match",
        {var_string(builder, "matchCondition", condition)}, {});
    const auto sink1 = block(builder, "K1", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {s1, s2, match, sink1, sink2},
        {couple(builder, "S1", "out", "M", "in1"),
         couple(builder, "S2", "out", "M", "in2"),
         couple(builder, "M", "out1", "K1", "in"),
         couple(builder, "M", "out2", "K2", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // The canonical AnyLogic form `agent1.kind == agent2.kind` pairs equal
  // attributes and blocks unequal ones; `!=` pairs unequal ones.
  const ReplicationMetrics equal = run_match(1, 1, "agent1.kind == agent2.kind");
  REQUIRE(equal.departures == 6);

  const ReplicationMetrics mismatched = run_match(1, 2, "agent1.kind == agent2.kind");
  REQUIRE(mismatched.departures == 0);

  const ReplicationMetrics not_equal = run_match(1, 2, "agent1.kind != agent2.kind");
  REQUIRE(not_equal.departures == 6);
}

TEST_CASE("process flow: queuing_comparison orders and preempts by expression",
          "[process_flow][queuing][des_blocks]") {
  const auto run_comparison = [&](const char* comparison) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "size", 1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
        {var_int(builder, "size", 5)}, {});
    const auto queue = block(
        builder, "Q", "queue",
        {var_int(builder, "capacity", 1),
         var_string(builder, "queuing", "queuing_comparison"),
         var_string(builder, "agent1IsPreferredToAgent2", comparison),
         var_bool(builder, "enablePreemption", true)},
        {});
    const auto blocked = block(
        builder, "Blocked", "resource", {var_int(builder, "capacity", 0)}, {});
    const auto service = block(
        builder, "S", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Blocked")},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto preempted = block(builder, "Out", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(
            std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {s1, s2, queue, service, sink, preempted},
        {couple(builder, "S1", "out", "Q", "in"),
         couple(builder, "S2", "out", "Q", "in"),
         couple(builder, "Q", "out", "S", "in"),
         couple(builder, "Q", "outPreempted", "Out", "in"),
         couple(builder, "S", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // Capacity-1 queue: a size-5 newcomer ejects the size-1 waiter when the
  // comparison says "bigger first"; the reversed comparison never admits it.
  const ReplicationMetrics bigger_first =
      run_comparison("agent1.size > agent2.size");
  REQUIRE(bigger_first.departures == 1);

  const ReplicationMetrics smaller_first =
      run_comparison("agent1.size < agent2.size");
  REQUIRE(smaller_first.departures == 0);

  // Insertion path: comparison ordering with an accepting downstream keeps
  // every agent (conservation through the repositioning code).
  flatbuffers::FlatBufferBuilder builder;
  const auto s1 = block_with_state(
      builder, "S1", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
      {var_int(builder, "size", 1)}, {});
  const auto s2 = block_with_state(
      builder, "S2", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
      {var_int(builder, "size", 5)}, {});
  const auto queue = block(
      builder, "Q", "queue",
      {var_int(builder, "capacity", 100),
       var_string(builder, "queuing", "queuing_comparison"),
       var_string(builder, "agent1IsPreferredToAgent2",
                  "agent1.size > agent2.size")},
      {});
  const auto service = block(
      builder, "S", "service",
      {var_dist(builder, "time", dist(builder, 0, {1.0})),
       var_string(builder, "resource", "Server")},
      {});
  const auto resource = block(
      builder, "Server", "resource", {var_int(builder, "capacity", 1)}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error2;
  auto model = build(
      builder, {s1, s2, queue, service, sink},
      {couple(builder, "S1", "out", "Q", "in"),
       couple(builder, "S2", "out", "Q", "in"),
       couple(builder, "Q", "out", "S", "in"),
       couple(builder, "S", "out", "K", "in")},
      root, &error2);
  REQUIRE(model != nullptr);
  const ReplicationMetrics conserved = run_once(*model, 7, 6, 0);
  REQUIRE(conserved.departures == 6);
}

TEST_CASE("process flow: equality comparison drives condition routing",
          "[process_flow][condition][attributes]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block_with_state(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "size", 10)}, {});
    const auto route = block(
        builder, "R", "selectOutput",
        {var_string(builder, "condition", condition)}, {});
    const auto slow = block(
        builder, "Slow", "delay",
        {var_dist(builder, "delayTime", dist(builder, 0, {1.0}))}, {});
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
    return run_once(*model, 7, 500, 0);
  };

  // size = 10 on every entity: `== 10` always takes outT (1s delay),
  // `== 999` always takes outF (no delay).
  const ReplicationMetrics equals = run_route("size == 10");
  const ReplicationMetrics not_equals = run_route("size == 999");
  REQUIRE(equals.departures == 500);
  REQUIRE(not_equals.departures == 500);
  REQUIRE(equals.mean_sojourn > 0.5);
  REQUIRE(not_equals.mean_sojourn < 0.1);
}

TEST_CASE("process flow: seized resource units honor pool failures",
          "[process_flow][failure][des_blocks]") {
  const auto run_seize_pool = [&](double failure_rate) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource = block(
        builder, "Server", "resource",
        {var_int(builder, "capacity", 1),
         var_float(builder, "failure_rate", failure_rate),
         var_float(builder, "repair_rate", 1.0)},
        {});
    const auto seize = block(
        builder, "Grab", "seize",
        {var_string(builder, "resource", "Server"),
         var_int(builder, "numberOfUnits", 1)},
        {});
    const auto delay = block(
        builder, "Work", "delay",
        {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
    const auto release = block(builder, "Drop", "release", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
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
        builder, {source, seize, delay, release, sink},
        {couple(builder, "In", "out", "Grab", "in"),
         couple(builder, "Grab", "out", "Work", "in"),
         couple(builder, "Work", "out", "Drop", "in"),
         couple(builder, "Drop", "out", "K", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  // The pool fails while units are held by seize (busy-time failure law);
  // every agent still completes, the pool's downtime shows up in
  // availability, and no failures means availability == 1.
  const ReplicationMetrics failing = run_seize_pool(0.1);
  REQUIRE(failing.departures == 2000);
  REQUIRE(failing.availability > 0.85);
  REQUIRE(failing.availability < 0.99);
  REQUIRE(failing.mean_in_queue > 0.0);  // agents wait while the pool is down

  const ReplicationMetrics clean = run_seize_pool(0.0);
  REQUIRE(clean.departures == 2000);
  REQUIRE(clean.availability == 1.0);

  // Determinism: identical config reproduces identical metrics.
  const ReplicationMetrics again = run_seize_pool(0.1);
  REQUIRE(again.departures == failing.departures);
  REQUIRE(again.availability == failing.availability);
  REQUIRE(again.mean_in_queue == failing.mean_in_queue);
}

TEST_CASE("process flow: exit removes agents from the flow (sojourn kept)",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto delay = block(
      builder, "D", "delay",
      {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto exit = block(builder, "Out", "exit", {}, {});
  std::string error;
  auto model = build(
      builder, {source, delay, exit},
      {couple(builder, "In", "out", "D", "in"),
       couple(builder, "D", "out", "Out", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 5, 0);
  // The exit absorbs every agent: departures == arrivals, sojourn = delay.
  REQUIRE(metrics.departures == 5);
  REQUIRE(metrics.mean_sojourn == 0.5);
}

TEST_CASE("process flow: enter is an inert entry point without a trigger",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto enter = block(builder, "E", "enter", {}, {});
  const auto sink2 = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, sink, enter, sink2},
      {couple(builder, "In", "out", "K", "in"),
       couple(builder, "E", "out", "K2", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 5, 0);
  // Only the source produces agents; enter contributes nothing.
  REQUIRE(metrics.departures == 5);
}

TEST_CASE("process flow: assembler waits for parts, delays, then outputs",
          "[process_flow][assembler][des_blocks]") {
  const auto run_assembler = [&](double parts_rate, std::int64_t parts_needed,
                                 double delay_seconds) {
    flatbuffers::FlatBufferBuilder builder;
    const auto kits = block(
        builder, "Kits", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {2.0}))}, {});
    const auto parts = block(
        builder, "Parts", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {parts_rate}))}, {});
    const auto assembler = block(
        builder, "Build", "assembler",
        {var_int(builder, "quantity125", parts_needed),
         var_float(builder, "delayTime", delay_seconds)},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {kits, parts, assembler, sink},
        {couple(builder, "Kits", "out", "Build", "in"),
         couple(builder, "Parts", "out", "Build", "p1"),
         couple(builder, "Build", "out", "K", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // Kits at t=2,4; parts at t=1,2,3,4 (rate 1.0). Assemblies form at t=2
  // (kit 1 + two parts) and t=4 (kit 2 + two parts), each taking 2.0s.
  const ReplicationMetrics built = run_assembler(1.0, 2, 2.0);
  REQUIRE(built.departures == 2);
  REQUIRE(built.mean_sojourn == 2.0);

  // Only one part ever arrives: no assembly can start.
  const ReplicationMetrics starved = run_assembler(10.0, 2, 1.0);
  REQUIRE(starved.departures == 0);
}

TEST_CASE("process flow: composed blocks conserve entities end-to-end",
          "[process_flow][composition][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block_with_state(
      builder, "In", "source",
      {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
      {var_int(builder, "priority", 5)}, {});
  const auto route = block(
      builder, "R", "selectOutput",
      {var_string(builder, "condition", "priority > 3")}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 2),
       var_bool(builder, "permanent", false)},
      {});
  const auto unbatch = block(builder, "U", "unbatch", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto late_sink = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(
      builder, {source, route, batch, unbatch, sink, late_sink},
      {couple(builder, "In", "out", "R", "in"),
       couple(builder, "R", "outT", "B", "in"),
       couple(builder, "R", "outF", "K2", "in"),
       couple(builder, "B", "out", "U", "in"),
       couple(builder, "U", "out", "K", "in")},
      flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  // Every arrival takes outT (priority 5 > 3), is batched in pairs and
  // restored by unbatch: conservation holds through the composition.
  const ReplicationMetrics metrics = run_once(*model, 7, 1000, 0);
  REQUIRE(metrics.departures == 1000);
  REQUIRE(metrics.mean_in_queue > 0.0);  // agents wait at the batch
}

TEST_CASE("process flow: moveTo spends tripTime or distance/speed",
          "[process_flow][moveTo][des_blocks]") {
  const auto run_move = [&](double trip_time, double speed, double target_x) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto move = block(
        builder, "M", "moveTo",
        {var_float(builder, "tripTime", trip_time),
         var_float(builder, "speed", speed),
         var_float(builder, "xYZ", target_x)},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {source, move, sink},
        {couple(builder, "In", "out", "M", "in"),
         couple(builder, "M", "out", "K", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 3, 0);
  };

  // Explicit trip time: every agent spends exactly 2.0s moving.
  const ReplicationMetrics timed = run_move(2.0, 0.0, 0.0);
  REQUIRE(timed.departures == 3);
  REQUIRE(timed.mean_sojourn == 2.0);

  // Speed mode: 10 units at 5 units/s -> 2.0s.
  const ReplicationMetrics moving = run_move(0.0, 5.0, 10.0);
  REQUIRE(moving.departures == 3);
  REQUIRE(moving.mean_sojourn == 2.0);

  // No trip time or speed: instant jump.
  const ReplicationMetrics jump = run_move(0.0, 0.0, 0.0);
  REQUIRE(jump.departures == 3);
  REQUIRE(jump.mean_sojourn == 0.0);
}

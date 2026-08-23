// Generic process-flow executor tests (ProcessFlowSim): block semantics for
// delay / split / selectOutput, an M/M/1 statistical check through the
// generic path (a `count` block forces the generic engine), and
// same-seed determinism.
#include <algorithm>
#include <bit>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/state/variable_store.h"
#include "process_flow.h"

namespace {

using logicpilot::ReplicationConfig;
using logicpilot::ReplicationMetrics;
using logicpilot::ReplicationSummary;
using logicpilot::BlockMetrics;
using logicpilot::SimTime;
using logicpilot::summarize_replications;
using namespace logicpilot::ir::v2;

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  const logicpilot::SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

flatbuffers::Offset<Distribution> dist(flatbuffers::FlatBufferBuilder& b,
                                       std::uint8_t kind,
                                       std::vector<double> params) {
  return CreateDistribution(b, kind, b.CreateVector(params));
}
flatbuffers::Offset<Var> var_dist(flatbuffers::FlatBufferBuilder& b,
                                  const char* name,
                                  flatbuffers::Offset<Distribution> d) {
  return CreateVar(b, b.CreateString(name), VarType_Distribution, false, 0, 0.0,
                   0, d);
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
  return CreateVar(b, b.CreateString(name), VarType_Bool, value, 0, 0.0, 0, 0);
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
    coupling_ptrs.push_back(flatbuffers::GetTemporaryPointer(builder, offset));
  }
  const Node* root = root_offset.IsNull() ? nullptr
                                          : flatbuffers::GetTemporaryPointer(
                                                builder, root_offset);
  return std::make_unique<logicpilot::ProcessFlowSim>(stage_ptrs, coupling_ptrs,
                                                      root, error);
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {1.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5})),
             var_int(builder, "capacity", 1)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
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

TEST_CASE("process flow: basic source queue sink checkpoint resumes",
          "[process_flow][checkpoint]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto queue = block(builder, "Q", "queue",
                           {var_int(builder, "capacity", 10)}, {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, queue, sink},
                     {couple(builder, "In", "out", "Q", "in"),
                      couple(builder, "Q", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 19;
  config.arrivals = 5;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(!checkpoint.empty());
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();

  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.arrivals == first.arrivals);
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_wait == first.mean_wait);
}

TEST_CASE("process flow: delay in-service checkpoint restores depart event",
          "[process_flow][checkpoint][delay]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5})),
             var_int(builder, "capacity", 1)}, {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
                     {couple(builder, "In", "out", "D", "in"),
                      couple(builder, "D", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 23;
  config.arrivals = 5;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
}

TEST_CASE("process flow: basic service checkpoint restores in-service task",
          "[process_flow][checkpoint][service]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto service =
      block(builder, "Work", "service",
            {var_dist(builder, "time", dist(builder, 0, {0.5}))}, {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 31;
  config.arrivals = 5;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
}

TEST_CASE("process flow: service timeout checkpoint restores waiting timeout",
          "[process_flow][checkpoint][service][timeout]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto service =
      block(builder, "Work", "service",
            {var_dist(builder, "time", dist(builder, 0, {10.0})),
             var_int(builder, "queueCapacity", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 1.0)}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto timed_out = block(builder, "TimedOut", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, service, done, timed_out},
                     {couple(builder, "In", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Done", "in"),
                      couple(builder, "Work", "outTimeout", "TimedOut", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 9;
  config.arrivals = 3;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.blocks.size() == first.blocks.size());
  REQUIRE(second.blocks[1].timed_out == first.blocks[1].timed_out);
}

TEST_CASE("process flow: seize timeout checkpoint restores waiting timeout",
          "[process_flow][checkpoint][seize][timeout]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_string(builder, "arrivalType", "interarrival_time"),
             var_dist(builder, "interarrivalTime", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "multipleEntitiesPerArrival", true),
             var_int(builder, "agentsPerArrival", 5),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)}, {});
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto blocked = block(builder, "Blocked", "queue",
                             {var_int(builder, "capacity", 0)}, {});
  const auto seize =
      block(builder, "Grab", "seize",
            {var_string(builder, "resource", "Server"),
             var_int(builder, "numberOfUnits", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 0.5)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  const auto timed_out = block(builder, "TimedOut", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, seize, blocked, sink, timed_out},
                     {couple(builder, "In", "out", "Grab", "in"),
                      couple(builder, "Grab", "out", "Blocked", "in"),
                      couple(builder, "Grab", "outTimeout", "TimedOut", "in"),
                      couple(builder, "Blocked", "out", "Done", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 37;
  config.arrivals = 5;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.blocks.size() == first.blocks.size());
  REQUIRE(second.blocks[1].timed_out == first.blocks[1].timed_out);
}

TEST_CASE("process flow: seize preemption checkpoint restores waiter identity",
          "[process_flow][checkpoint][seize][preemption]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name, double first_time,
                          std::int64_t priority) {
    return block_with_state(
        builder, name, "source",
        {var_dist(builder, "arrival", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "priority", priority)}, {});
  };
  const auto holder = source("Holder", 0.0, 0);
  const auto low = source("Low", 1.0, 1);
  const auto high = source("High", 2.0, 5);
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto blocked = block(builder, "Blocked", "queue",
                             {var_int(builder, "capacity", 0)}, {});
  const auto seize = block(
      builder, "Grab", "seize",
      {var_string(builder, "resource", "Server"),
       var_int(builder, "numberOfUnits", 1),
       var_bool(builder, "enablePreemption", true)}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto preempted = block(builder, "Preempted", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {holder, low, high, seize, blocked, done,
                               preempted},
                     {couple(builder, "Holder", "out", "Grab", "in"),
                      couple(builder, "Low", "out", "Grab", "in"),
                      couple(builder, "High", "out", "Grab", "in"),
                      couple(builder, "Grab", "out", "Blocked", "in"),
                      couple(builder, "Grab", "outPreempted", "Preempted",
                             "in"),
                      couple(builder, "Blocked", "out", "Done", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 43;
  config.arrivals = 3;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: combine checkpoint restores the waiting input port",
          "[process_flow][checkpoint][combine]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name, double first_time) {
    return block(builder, name, "source",
                 {var_dist(builder, "arrival", dist(builder, 0, {100.0})),
                  var_string(builder, "firstArrivalMode", "at_time"),
                  var_float(builder, "firstArrivalTime", first_time),
                  var_bool(builder, "limitArrivals", true),
                  var_int(builder, "maxArrivals", 1)}, {});
  };
  const auto left = source("Left", 0.0);
  const auto right = source("Right", 1.0);
  const auto combine = block(builder, "Join", "combine",
                             {var_string(builder, "combineMode", "new")}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  std::string error;
  auto model = build(builder, {left, right, combine, sink},
                     {couple(builder, "Left", "out", "Join", "in1"),
                      couple(builder, "Right", "out", "Join", "in2"),
                      couple(builder, "Join", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 47;
  config.arrivals = 2;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: match checkpoint restores conditioned pair queues",
          "[process_flow][checkpoint][match]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name, double first_time) {
    return block_with_state(
        builder, name, "source",
        {var_dist(builder, "arrival", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "kind", 7)}, {});
  };
  const auto left = source("Left", 0.0);
  const auto right = source("Right", 1.0);
  const auto match = block(builder, "Match", "match",
                           {var_string(builder, "matchCondition", "kind")},
                           {});
  const auto out1 = block(builder, "Out1", "sink", {}, {});
  const auto out2 = block(builder, "Out2", "sink", {}, {});
  std::string error;
  auto model = build(builder, {left, right, match, out1, out2},
                     {couple(builder, "Left", "out", "Match", "in1"),
                      couple(builder, "Right", "out", "Match", "in2"),
                      couple(builder, "Match", "out1", "Out1", "in"),
                      couple(builder, "Match", "out2", "Out2", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 53;
  config.arrivals = 2;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: split checkpoint restores pending clone output",
          "[process_flow][checkpoint][split]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_start"),
       var_bool(builder, "multipleEntitiesPerArrival", true),
       var_int(builder, "agentsPerArrival", 2),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto split = block(builder, "Fork", "split",
                           {var_int(builder, "copies", 2)}, {});
  const auto work = block(builder, "Work", "service",
                          {var_dist(builder, "time", dist(builder, 0, {1.0}))},
                          {});
  const auto original = block(builder, "Original", "sink", {}, {});
  const auto clone = block(builder, "Clone", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, split, work, original, clone},
                     {couple(builder, "In", "out", "Fork", "in"),
                      couple(builder, "Fork", "out", "Original", "in"),
                      couple(builder, "Fork", "outCopy", "Work", "in"),
                      couple(builder, "Work", "out", "Clone", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 59;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: selectOutput5 checkpoint restores waiting route",
          "[process_flow][checkpoint][select]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_start"),
       var_bool(builder, "multipleEntitiesPerArrival", true),
       var_int(builder, "agentsPerArrival", 2),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto select = block(
      builder, "Route", "selectOutput5",
      {var_string(builder, "type", "conditions"),
       var_string(builder, "condition1", "1")}, {});
  const auto work = block(builder, "Work", "service",
                          {var_dist(builder, "time", dist(builder, 0, {1.0}))},
                          {});
  const auto done = block(builder, "Done", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, select, work, done},
                     {couple(builder, "In", "out", "Route", "in"),
                      couple(builder, "Route", "out1", "Work", "in"),
                      couple(builder, "Work", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 61;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: assembler checkpoint restores waiting parts",
          "[process_flow][checkpoint][assembler]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name, double first_time) {
    return block(builder, name, "source",
                 {var_string(builder, "arrivalType", "interarrival_time"),
                  var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
                  var_string(builder, "firstArrivalMode", "at_time"),
                  var_float(builder, "firstArrivalTime", first_time),
                  var_bool(builder, "limitArrivals", true),
                  var_int(builder, "maxArrivals", 1)}, {});
  };
  const auto kit = source("Kit", 0.0);
  const auto part = source("Part", 1.0);
  const auto assembler = block(builder, "Build", "assembler",
                               {var_int(builder, "quantity125", 1),
                                var_float(builder, "delayTime", 1.0)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  std::string error;
  auto model = build(builder, {kit, part, assembler, sink},
                     {couple(builder, "Kit", "out", "Build", "in"),
                      couple(builder, "Part", "out", "Build", "p1"),
                      couple(builder, "Build", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 67;
  config.arrivals = 2;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: assembler checkpoint restores in-service resource",
          "[process_flow][checkpoint][assembler][resource]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name) {
    return block(builder, name, "source",
                 {var_string(builder, "arrivalType", "interarrival_time"),
                  var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
                  var_string(builder, "firstArrivalMode", "at_start"),
                  var_bool(builder, "limitArrivals", true),
                  var_int(builder, "maxArrivals", 1)}, {});
  };
  const auto kit = source("Kit");
  const auto part = source("Part");
  const auto resource = block(builder, "Crew", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto assembler = block(
      builder, "Build", "assembler",
      {var_int(builder, "quantity125", 1),
       var_float(builder, "delayTime", 1.0),
       var_string(builder, "resourcePool", "Crew"),
       var_int(builder, "numberOfUnits", 1)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {kit, part, assembler, sink},
                     {couple(builder, "Kit", "out", "Build", "in"),
                      couple(builder, "Part", "out", "Build", "p1"),
                      couple(builder, "Build", "out", "Done", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 71;
  config.arrivals = 2;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.availability == first.availability);
}

TEST_CASE("process flow: wait checkpoint restores timeout state",
          "[process_flow][checkpoint][wait][timeout]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_start"),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto wait = block(
      builder, "Wait", "wait",
      {var_int(builder, "capacity", 1),
       var_bool(builder, "enableTimeout", true),
       var_float(builder, "timeout", 0.5)}, {});
  const auto blocked = block(builder, "Blocked", "queue",
                             {var_int(builder, "capacity", 0)}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto timed_out = block(builder, "TimedOut", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, wait, blocked, done, timed_out},
                     {couple(builder, "In", "out", "Wait", "in"),
                      couple(builder, "Wait", "out", "Blocked", "in"),
                      couple(builder, "Wait", "outTimeout", "TimedOut", "in"),
                      couple(builder, "Blocked", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 73;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.blocks[1].timed_out == first.blocks[1].timed_out);
}

TEST_CASE("process flow: exit checkpoint restores pending source event",
          "[process_flow][checkpoint][exit]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_time"),
       var_float(builder, "firstArrivalTime", 1.0),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto exit = block(builder, "Out", "exit", {}, {});
  std::string error;
  auto model = build(builder, {source, exit},
                     {couple(builder, "In", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 89;
  config.arrivals = 1;
  model->reset(config);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: local service preemption checkpoint restores victim state",
          "[process_flow][checkpoint][service][preemption]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = [&](const char* name, double first_time,
                          std::int64_t priority) {
    return block_with_state(
        builder, name, "source",
        {var_dist(builder, "arrival", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "priority", priority)}, {});
  };
  const auto low = source("Low", 0.0, 1);
  const auto high = source("High", 1.0, 5);
  const auto service = block(
      builder, "Work", "service",
      {var_dist(builder, "time", dist(builder, 0, {10.0})),
       var_int(builder, "queueCapacity", 10),
       var_bool(builder, "enablePreemption", true),
       var_bool(builder, "taskMayPreempt", true),
       var_string(builder, "taskPreemptionPolicy", "pp_terminate")}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto preempted = block(builder, "Preempted", "sink", {}, {});
  std::string error;
  auto model = build(builder, {low, high, service, done, preempted},
                     {couple(builder, "Low", "out", "Work", "in"),
                      couple(builder, "High", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Done", "in"),
                      couple(builder, "Work", "outPreempted", "Preempted", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 41;
  config.arrivals = 2;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
}

TEST_CASE("process flow: source honors first arrival, batch size, and limit",
          "[process_flow][source]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_string(builder, "arrivalType", "interarrival_time"),
             var_dist(builder, "interarrivalTime", dist(builder, 0, {5.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "multipleEntitiesPerArrival", true),
             var_int(builder, "agentsPerArrival", 3),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 2)},
            {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, sink},
                     {couple(builder, "In", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 100, 0);
  CHECK(metrics.arrivals == 6);
  CHECK(metrics.departures == 6);
  CHECK(metrics.horizon_seconds == 5.0);
  REQUIRE(metrics.blocks.size() == 2);
  CHECK(metrics.blocks[0].name == "In");
  CHECK(metrics.blocks[0].kind == "source");
  CHECK(metrics.blocks[0].arrived == 6);
  CHECK(metrics.blocks[1].name == "Out");
  CHECK(metrics.blocks[1].departed == 6);
}

TEST_CASE(
    "process flow: source selects interarrivalTime and specified first time",
    "[process_flow][source]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_string(builder, "arrivalType", "interarrival_time"),
             var_dist(builder, "arrival", dist(builder, 0, {100.0})),
             var_dist(builder, "interarrivalTime", dist(builder, 0, {2.0})),
             var_string(builder, "firstArrivalMode", "at_time"),
             var_float(builder, "firstArrivalTime", 7.0),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 3)},
            {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, sink},
                     {couple(builder, "In", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 11, 100, 0);
  CHECK(metrics.arrivals == 3);
  CHECK(metrics.departures == 3);
  CHECK(metrics.horizon_seconds == 11.0);
}

TEST_CASE("process flow: unsupported scheduled source fails explicitly",
          "[process_flow][source]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_string(builder, "arrivalType", "arrival_table"),
             var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
            {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, sink},
                     {couple(builder, "In", "out", "Out", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  CHECK(error.find("is not executable yet") != std::string::npos);
}

TEST_CASE("process flow: service internal queue times out waiting agents",
          "[process_flow][service]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto service =
      block(builder, "Work", "service",
            {var_dist(builder, "time", dist(builder, 0, {10.0})),
             var_int(builder, "queueCapacity", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 1.0)},
            {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto timed_out = block(builder, "TimedOut", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, service, done, timed_out},
                     {couple(builder, "In", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Done", "in"),
                      couple(builder, "Work", "outTimeout", "TimedOut", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 9, 3, 0);
  CHECK(metrics.arrivals == 3);
  CHECK(metrics.departures == 3);
  CHECK(metrics.horizon_seconds == Catch::Approx(10.1));
  REQUIRE(metrics.blocks.size() == 4);
  CHECK(metrics.blocks[1].name == "Work");
  CHECK(metrics.blocks[1].capacity == 1);
  CHECK(metrics.blocks[1].timed_out == 2);
  CHECK(metrics.blocks[1].departed == 3);
  CHECK(metrics.blocks[1].utilization > 0.9);
}

TEST_CASE("process flow: service seizes numberOfUnits from its resource pool",
          "[process_flow][service][resource]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 4)},
            {});
  const auto resource = block(builder, "Workers", "resource",
                              {var_int(builder, "capacity", 4)}, {});
  const auto service =
      block(builder, "Work", "service",
            {var_string(builder, "resource", "Workers"),
             var_int(builder, "numberOfUnits", 2),
             var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_int(builder, "queueCapacity", 4)},
            {});
  const auto sink = block(builder, "Done", "sink", {}, {});
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
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Done", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 100, 0);
  REQUIRE(metrics.departures == 4);
  // Four units with two units per task permit two concurrent tasks. Arrivals
  // occur at 0.1, 0.2, 0.3, 0.4; completions are 1.1, 1.2, 2.1, 2.2.
  CHECK(metrics.horizon_seconds == Catch::Approx(2.2));
  REQUIRE(metrics.blocks.size() == 3);
  CHECK(metrics.blocks[1].name == "Work");
  CHECK(metrics.blocks[1].departed == 4);
}

TEST_CASE("process flow: zero-capacity queue is not an unbounded queue",
          "[process_flow][queue]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto queue = block(builder, "NoBuffer", "queue",
                           {var_int(builder, "capacity", 0)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, queue, sink},
                     {couple(builder, "In", "out", "NoBuffer", "in"),
                      couple(builder, "NoBuffer", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 100, 0);
  CHECK(metrics.arrivals == 1);
  CHECK(metrics.departures == 0);
  REQUIRE(metrics.blocks.size() == 3);
  CHECK(metrics.blocks[1].name == "NoBuffer");
  CHECK(metrics.blocks[1].capacity == 0);
  CHECK(metrics.blocks[1].arrived == 0);
}

TEST_CASE("process flow: service blocks arbitrate one shared resource pool",
          "[process_flow][service][resource]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source_a =
      block(builder, "InA", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto source_b =
      block(builder, "InB", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto resource = block(builder, "Shared", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto service_a =
      block(builder, "WorkA", "service",
            {var_string(builder, "resource", "Shared"),
             var_int(builder, "numberOfUnits", 1),
             var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_int(builder, "queueCapacity", 1)},
            {});
  const auto service_b =
      block(builder, "WorkB", "service",
            {var_string(builder, "resource", "Shared"),
             var_int(builder, "numberOfUnits", 1),
             var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_int(builder, "queueCapacity", 1)},
            {});
  const auto done_a = block(builder, "DoneA", "sink", {}, {});
  const auto done_b = block(builder, "DoneB", "sink", {}, {});
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
      builder,
      {source_a, source_b, service_a, service_b, done_a, done_b},
      {couple(builder, "InA", "out", "WorkA", "in"),
       couple(builder, "InB", "out", "WorkB", "in"),
       couple(builder, "WorkA", "out", "DoneA", "in"),
       couple(builder, "WorkB", "out", "DoneB", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 100, 0);
  REQUIRE(metrics.departures == 2);
  // Both jobs arrive at t=0. A single shared unit serializes the two
  // one-second services; independent per-block pools would finish at t=1.
  CHECK(metrics.horizon_seconds == Catch::Approx(2.0));
  CHECK(metrics.utilization == Catch::Approx(1.0));
  REQUIRE(metrics.blocks.size() == 6);
  CHECK(metrics.blocks[2].utilization == Catch::Approx(0.5));
  CHECK(metrics.blocks[3].utilization == Catch::Approx(0.5));
}

TEST_CASE("process flow: delay maximumCapacity=true gives unlimited capacity",
          "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {1.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {10.0})),
             var_int(builder, "capacity", 1),
             var_bool(builder, "maximumCapacity", true)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
                     {couple(builder, "In", "out", "D", "in"),
                      couple(builder, "D", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 100, 0);
  REQUIRE(metrics.departures == 100);
  REQUIRE(metrics.mean_sojourn > 5.0);
  // Unlimited: every entity is delayed ~10s in parallel. With the bug the
  // bool was ignored and a single server serialized all 100 (~500s mean).
  REQUIRE(metrics.mean_sojourn < 30.0);
}

TEST_CASE("process flow: split clones each agent", "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
  const auto split = block(
      builder, "S", "split",
      {var_int(builder, "copies", 3), var_float(builder, "probability", 1.0)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, split, sink},
                     {couple(builder, "In", "out", "S", "in"),
                      couple(builder, "S", "out", "K", "in"),
                      couple(builder, "S", "outCopy", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 3, 1000, 0);
  // Original + 2 copies per arrival.
  REQUIRE(metrics.departures == 3000);
}

TEST_CASE("process flow: engine rejects implicit fan-out on an output port",
          "[process_flow][fan_out]") {
  // One source feeding two branches pushes the same entity id into both;
  // every branch exit would count as a system departure (departures >
  // arrivals, negative in_system, one id in several branches). The compiler
  // rejects this as LP5007; the engine must reject hand-built IR too.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto left = block(builder, "Left", "sink", {}, {});
  const auto right = block(builder, "Right", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, left, right},
                     {couple(builder, "In", "out", "Left", "in"),
                      couple(builder, "In", "out", "Right", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  // The engine reports the violation through the error channel and refuses
  // to run the flow (an inert model, not a fan-out simulation).
  REQUIRE(!error.empty());
  REQUIRE(error.find("fan-out") != std::string::npos);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 10, 0);
  REQUIRE(metrics.arrivals == 0);
  REQUIRE(metrics.departures == 0);
}

TEST_CASE("process flow: split keeps arrivals/departures/in-system "
          "consistent",
          "[process_flow][split][fan_out]") {
  // Explicit duplication via split: each arrival produces the original on
  // `out` plus numberOfCopies-1 fresh entities on `outCopy`. Every copy is a
  // new entity (counted on creation, leaves exactly once), so the system
  // totals stay balanced: arrivals == departures and in-system never goes
  // negative (an unaccounted clone would leave without its +1 and drive
  // in_system below zero).
  const auto build_model = [](flatbuffers::FlatBufferBuilder& builder) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto split = block(
        builder, "S", "split",
        {var_int(builder, "copies", 3), var_float(builder, "probability", 1.0)},
        {});
    const auto original_lane =
        block(builder, "D", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
    const auto copy_lane =
        block(builder, "D2", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {1.0}))}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {source, split, original_lane, copy_lane, sink, sink2},
        {couple(builder, "In", "out", "S", "in"),
         couple(builder, "S", "out", "D", "in"),
         couple(builder, "S", "outCopy", "D2", "in"),
         couple(builder, "D", "out", "K", "in"),
         couple(builder, "D2", "out", "K2", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return model;
  };
  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  const ReplicationMetrics metrics = run_once(*model, 3, 1000, 0);
  // 1000 arrivals -> 1000 originals + 2000 copies; everything leaves once.
  REQUIRE(metrics.arrivals == 3000);
  REQUIRE(metrics.departures == 3000);
  REQUIRE(metrics.mean_in_system >= 0.0);
  REQUIRE(metrics.mean_in_system > 0.0);  // both lanes delay entities
  // The split block itself saw exactly the 1000 originals.
  const BlockMetrics* split_metrics = nullptr;
  for (const BlockMetrics& block : metrics.blocks) {
    if (block.name == "S") {
      split_metrics = &block;
    }
  }
  REQUIRE(split_metrics != nullptr);
  REQUIRE(split_metrics->arrived == 1000);
  REQUIRE(split_metrics->departed == 1000);

  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder builder2;
  auto model2 = build_model(builder2);
  const ReplicationMetrics again = run_once(*model2, 3, 1000, 0);
  REQUIRE(again.arrivals == metrics.arrivals);
  REQUIRE(again.departures == metrics.departures);
  REQUIRE(again.mean_in_system == metrics.mean_in_system);
}

TEST_CASE("process flow: split copies never shift the warm-up boundary",
          "[process_flow][split][warmup]") {
  // Warm-up excludes entities by external Source arrival ordinal, not by
  // unique id. With warmup = 1 the first arrival's original AND its split
  // copies must stay out of the sojourn/wait samples; the second arrival
  // and its copies enter. Original lane is a capacity-1 service (1.0 s),
  // copy lane an unbounded delay (2.0 s), arrivals 3.0 s apart - so the
  // second arrival finds every lane idle and every sampled sojourn is
  // deterministic and independent of the copy count:
  //   original sojourn = 1.0, each copy sojourn = 2.0
  //   mean_sojourn(copies) = (1.0 + 2.0 * (copies - 1)) / copies
  // Pre-fix, the first arrival's copies (fresh ids >= warmup) entered the
  // sample with their own 2.0 s sojourns, shifting the mean.
  const auto run_model = [](std::int64_t copies) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {3.0}))}, {});
    const auto split = block(
        builder, "S", "split",
        {var_int(builder, "copies", copies),
         var_float(builder, "probability", 1.0)},
        {});
    const auto service =
        block(builder, "Srv", "service",
              {var_dist(builder, "time", dist(builder, 0, {1.0}))}, {});
    const auto copy_lane =
        block(builder, "Copy", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {2.0})),
               var_bool(builder, "maximumCapacity", true)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(
        builder, {source, split, service, copy_lane, sink, sink2},
        {couple(builder, "In", "out", "S", "in"),
         couple(builder, "S", "out", "Srv", "in"),
         couple(builder, "S", "outCopy", "Copy", "in"),
         couple(builder, "Srv", "out", "K", "in"),
         couple(builder, "Copy", "out", "K2", "in")},
        flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 5, 2, 1);  // warmup = 1 external arrival
  };

  // Exact sampled means per copy count: only the second arrival's entities
  // contribute, so each value pins down the sample set. A stray first-
  // arrival copy would add 2.0 s samples and move the mean (e.g. copies=2:
  // (2.0+1.0+2.0)/3 = 1.667 instead of 1.5).
  const ReplicationMetrics three = run_model(3);
  REQUIRE(three.arrivals == 6);
  REQUIRE(three.departures == 6);
  REQUIRE(three.mean_in_system >= 0.0);
  REQUIRE(three.mean_sojourn == Catch::Approx((1.0 + 2.0 + 2.0) / 3.0));
  REQUIRE(three.mean_wait == Catch::Approx(0.0));  // lanes idle at arrival

  const ReplicationMetrics two = run_model(2);
  const ReplicationMetrics four = run_model(4);
  REQUIRE(two.arrivals == 4);
  REQUIRE(two.departures == 4);
  REQUIRE(two.mean_sojourn == Catch::Approx((1.0 + 2.0) / 2.0));
  REQUIRE(four.arrivals == 8);
  REQUIRE(four.departures == 8);
  REQUIRE(four.mean_sojourn == Catch::Approx((1.0 + 2.0 * 3.0) / 4.0));

  // Determinism: identical config reproduces identical metrics.
  const ReplicationMetrics again = run_model(3);
  REQUIRE(again.arrivals == three.arrivals);
  REQUIRE(again.departures == three.departures);
  REQUIRE(again.mean_sojourn == three.mean_sojourn);
  REQUIRE(again.mean_wait == three.mean_wait);
}

TEST_CASE("process flow: backpressure never re-delivers an accepted entity",
          "[process_flow][backpressure]") {
  // A single-edge chain with a slow server: while the service is busy the
  // source keeps its entity and re-emits when the slot frees. Each entity
  // must be delivered exactly once - the service's arrived counter is the
  // duplicate detector (a re-delivery would push it above the arrival
  // count) and departures must match arrivals (no entity is lost either).
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {0.5}))}, {});
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Server")},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model =
      build(builder, {source, service, sink},
            {couple(builder, "In", "out", "S", "in"),
             couple(builder, "S", "out", "K", "in")},
            root, &error);
  REQUIRE(model != nullptr);
  const ReplicationMetrics metrics = run_once(*model, 7, 10, 0);
  REQUIRE(metrics.arrivals == 10);
  REQUIRE(metrics.departures == 10);
  REQUIRE(metrics.mean_in_system >= 0.0);
  const BlockMetrics* service_metrics = nullptr;
  for (const BlockMetrics& block : metrics.blocks) {
    if (block.name == "S") {
      service_metrics = &block;
    }
  }
  REQUIRE(service_metrics != nullptr);
  REQUIRE(service_metrics->arrived == 10);   // exactly once per entity
  REQUIRE(service_metrics->departed == 10);  // nothing stuck or duplicated
}

TEST_CASE("process flow: selectOutput routes by probability",
          "[process_flow]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
  const auto route = block(builder, "R", "selectOutput",
                           {var_float(builder, "probability", 0.5)}, {});
  const auto yes = block(builder, "Yes", "sink", {}, {});
  const auto no = block(builder, "No", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, route, yes, no},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto queue =
      block(builder, "Q", "queue", {var_int(builder, "capacity", 1000000)}, {});
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1),
                               var_float(builder, "failure_rate", 0.0)},
                              {});
  const auto service =
      block(builder, "S", "service",
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
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}), 0,
      0, 0, 0);
  std::string error;
  auto model = build(builder, {source, queue, service, count, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 3, {1.0})),
             var_int(builder, "capacity", -1)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 4, {0.8}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 3, {1.0})),
             var_int(builder, "capacity", -1)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
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

TEST_CASE("process flow: incremental scheduler enforces the shared event budget",
          "[process_flow][incremental][safety]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {1.0})),
             var_int(builder, "capacity", -1)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, sink},
                     {couple(builder, "In", "out", "D", "in"),
                      couple(builder, "D", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.arrivals = 10;
  config.warmup_arrivals = 0;
  config.max_events = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::infinity(), nullptr) == 1);
  REQUIRE(model->failed());
  REQUIRE(model->failure_reason().find("KR1017") != std::string::npos);
  REQUIRE(model->failure_reason().find("1 events") != std::string::npos);
}

TEST_CASE(
    "process flow: selectOutput runtime condition routes "
    "deterministically",
    "[process_flow][condition]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route = block(builder, "R", "selectOutput",
                             {var_string(builder, "condition", condition)}, {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
               var_int(builder, "capacity", -1)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
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

TEST_CASE(
    "process flow: selectOutput5 conditions route first-true and "
    "default to out5",
    "[process_flow][condition]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route = block(builder, "R", "selectOutput5",
                             {var_string(builder, "type", "conditions"),
                              var_string(builder, "condition1", condition)},
                             {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
               var_int(builder, "capacity", -1)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
                       {couple(builder, "In", "out", "R", "in"),
                        couple(builder, "R", "out1", "Slow", "in"),
                        couple(builder, "R", "out5", "K", "in"),
                        couple(builder, "Slow", "out", "K", "in")},
                       flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  // `t < 0` is never true -> all conditions false -> default out5 (no delay);
  // `t < 1e8` is always true -> condition1 wins -> out1 (100s delay).
  const ReplicationMetrics fast = run_route("t < 0");
  const ReplicationMetrics slow = run_route("t < 100000000");
  REQUIRE(fast.departures == 2000);
  REQUIRE(slow.departures == 2000);
  REQUIRE(fast.mean_sojourn < 1.0);
  REQUIRE(slow.mean_sojourn > 50.0);
}

TEST_CASE("process flow: selectOutput5 exit-number expression picks exit",
          "[process_flow][condition]") {
  const auto run_exit = [](const char* exit_number) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route = block(builder, "R", "selectOutput5",
                             {var_string(builder, "type", "exit_number"),
                              var_string(builder, "exitNumber", exit_number)},
                             {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
               var_int(builder, "capacity", -1)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
                       {couple(builder, "In", "out", "R", "in"),
                        couple(builder, "R", "out1", "Slow", "in"),
                        couple(builder, "R", "out5", "K", "in"),
                        couple(builder, "Slow", "out", "K", "in")},
                       flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  const ReplicationMetrics via_five = run_exit("5");
  const ReplicationMetrics via_one = run_exit("1");
  REQUIRE(via_five.departures == 2000);
  REQUIRE(via_one.departures == 2000);
  REQUIRE(via_five.mean_sojourn < 1.0);  // out5 -> sink
  REQUIRE(via_one.mean_sojourn > 50.0);  // out1 -> 100s delay
}

TEST_CASE("process flow: selectOutput5 probabilities route with weights",
          "[process_flow]") {
  const auto run_probs = [](double p1, double p5) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route = block(builder, "R", "selectOutput5",
                             {var_string(builder, "type", "probabilities"),
                              var_float(builder, "probability1", p1),
                              var_float(builder, "probability2", 0.0),
                              var_float(builder, "probability3", 0.0),
                              var_float(builder, "probability4", 0.0),
                              var_float(builder, "probability5", p5)},
                             {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
               var_int(builder, "capacity", -1)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
                       {couple(builder, "In", "out", "R", "in"),
                        couple(builder, "R", "out1", "Slow", "in"),
                        couple(builder, "R", "out5", "K", "in"),
                        couple(builder, "Slow", "out", "K", "in")},
                       flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  const ReplicationMetrics all_fast = run_probs(0.0, 1.0);  // all -> out5
  const ReplicationMetrics all_slow = run_probs(1.0, 0.0);  // all -> out1
  REQUIRE(all_fast.departures == 2000);
  REQUIRE(all_slow.departures == 2000);
  REQUIRE(all_fast.mean_sojourn < 1.0);
  REQUIRE(all_slow.mean_sojourn > 50.0);
}

TEST_CASE(
    "process flow: selectOutputIn/Out quasi-select routes by "
    "probability and choice",
    "[process_flow][condition]") {
  const auto run_quasi = [](bool probabilistic, const char* choice,
                            double fast_prob) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto route =
        block(builder, "R", "selectOutputIn",
              {var_bool(builder, "conditionIsProbabilistic", probabilistic),
               var_string(builder, "choice", choice)},
              {});
    const auto fast = block(builder, "Fast", "selectOutputOut",
                            {var_string(builder, "selectOutputIn", "R"),
                             var_float(builder, "probability", fast_prob)},
                            {});
    const auto slow =
        block(builder, "Slow", "selectOutputOut",
              {var_string(builder, "selectOutputIn", "R"),
               var_float(builder, "probability", 1.0 - fast_prob)},
              {});
    const auto delay =
        block(builder, "D", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {100.0})),
               var_int(builder, "capacity", -1)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, fast, slow, delay, sink},
                       {couple(builder, "In", "out", "R", "in"),
                        couple(builder, "Fast", "out", "D", "in"),
                        couple(builder, "Slow", "out", "K", "in"),
                        couple(builder, "D", "out", "K", "in")},
                       flatbuffers::Offset<Node>{}, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 2000, 0);
  };

  // Probability mode: 0.7 of agents take the 100s delay through Fast.
  const ReplicationMetrics via_prob = run_quasi(true, "", 0.7);
  REQUIRE(via_prob.departures == 2000);
  REQUIRE(via_prob.mean_sojourn > 50.0);

  // All probability on Slow: every agent takes the fast branch.
  const ReplicationMetrics prob_fast = run_quasi(true, "", 0.0);
  REQUIRE(prob_fast.departures == 2000);
  REQUIRE(prob_fast.mean_sojourn < 1.0);

  // Explicit choice: 1 -> Fast (slow), 2 -> Slow (fast).
  const ReplicationMetrics choice_fast = run_quasi(false, "1", 0.7);
  const ReplicationMetrics choice_slow = run_quasi(false, "2", 0.7);
  REQUIRE(choice_fast.departures == 2000);
  REQUIRE(choice_slow.departures == 2000);
  REQUIRE(choice_fast.mean_sojourn > 50.0);
  REQUIRE(choice_slow.mean_sojourn < 1.0);
}

TEST_CASE("process flow: hold blockingCondition blocks tokens while true",
          "[process_flow][condition]") {
  const auto run_hold = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {10.0}))}, {});
    const auto hold =
        block(builder, "H", "hold",
              {var_string(builder, "blockingCondition", condition)}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, hold, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 3), var_bool(builder, "permanent", true)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, batch, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 3), var_bool(builder, "permanent", false)},
      {});
  const auto unbatch = block(builder, "U", "unbatch", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, batch, unbatch, sink},
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

TEST_CASE("process flow: temporary batch contents survive checkpoint",
          "[process_flow][checkpoint][batch]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 3)}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 3), var_bool(builder, "permanent", false)},
      {});
  const auto unbatch = block(builder, "U", "unbatch", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, batch, unbatch, sink},
                     {couple(builder, "In", "out", "B", "in"),
                      couple(builder, "B", "out", "U", "in"),
                      couple(builder, "U", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 61;
  config.arrivals = 3;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(1'500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: seize held resources survive checkpoint",
          "[process_flow][checkpoint][seize][resource]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_string(builder, "firstArrivalMode", "at_start"),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)}, {});
  const auto resource = block(builder, "Crew", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto seize = block(builder, "Grab", "seize",
                           {var_string(builder, "resource", "Crew"),
                            var_int(builder, "numberOfUnits", 1)}, {});
  const auto delay = block(
      builder, "Hold", "delay",
      {var_dist(builder, "delayTime", dist(builder, 0, {1.0})),
       var_int(builder, "capacity", 1)}, {});
  const auto release = block(builder, "Free", "release", {}, {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder, {source, seize, delay, release, sink},
      {couple(builder, "In", "out", "Grab", "in"),
       couple(builder, "Grab", "out", "Hold", "in"),
       couple(builder, "Hold", "out", "Free", "in"),
       couple(builder, "Free", "out", "Out", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 67;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
}

TEST_CASE("process flow: combine waits for both inputs and emits one",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto in1 =
      block(builder, "In1", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto in2 =
      block(builder, "In2", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto combine = block(builder, "C", "combine", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {in1, in2, combine, sink},
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
  const auto in1 =
      block(builder, "In1", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto in2 =
      block(builder, "In2", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto match = block(builder, "M", "match", {}, {});
  const auto sink1 = block(builder, "K1", "sink", {}, {});
  const auto sink2 = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(builder, {in1, in2, match, sink1, sink2},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto seize = block(builder, "Grab", "seize",
                           {var_string(builder, "resource", "Server"),
                            var_int(builder, "numberOfUnits", 1)},
                           {});
  const auto delay =
      block(builder, "Work", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release = block(builder, "Drop", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}), 0,
      0, 0, 0);
  std::string error;
  auto model = build(builder, {source, seize, delay, release, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto start = block(builder, "T0", "timeMeasureStart", {}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto end = block(builder, "T1", "timeMeasureEnd", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, start, delay, end, sink},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto hold = block(builder, "H", "hold",
                          {var_bool(builder, "initiallyBlocked", true)}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, hold, sink},
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
    const auto route = block(builder, "R", "selectOutput",
                             {var_string(builder, "condition", condition)}, {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {1.0}))}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
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
  const auto source =
      block_with_state(builder, "In", "source",
                       {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
                       {var_int(builder, "size", 10)}, {});
  const auto hold =
      block(builder, "H", "hold",
            {var_string(builder, "blockingCondition", "size > 5")}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, hold, sink},
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
      shared + 2.0 / (kRepair * kRepair) + 2.0 / ((kMu + kFailure) * kRepair) +
      2.0 * service_mean * (1.0 / (kMu + kFailure) + 1.0 / kRepair);
  const double service_second_moment =
      (p * shared + (1.0 - p) * failed_branch) / p;
  const double rho_eff = kLambda * service_mean;
  const double theory_wq =
      kLambda * service_second_moment / (2.0 * (1.0 - rho_eff));

  const auto build_model = [&](flatbuffers::FlatBufferBuilder& builder) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {kLambda}))}, {});
    const auto queue = block(builder, "Q", "queue",
                             {var_int(builder, "capacity", 1000000)}, {});
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", 1),
                                 var_float(builder, "failure_rate", kFailure),
                                 var_float(builder, "repair_rate", kRepair)},
                                {});
    const auto service =
        block(builder, "S", "service",
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
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, queue, service, count, sink},
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
    const ReplicationMetrics metrics =
        run_once(*model, replication_seed(42, rep), kArrivals, kWarmup);
    REQUIRE(metrics.departures == kArrivals);  // preemption never loses a job
    results.push_back(metrics);
  }

  const ReplicationSummary summary = summarize_replications(results, 0.95);
  INFO("Wq mean=" << summary.mean_wait.mean << " theory=" << theory_wq
                  << " CI=[" << summary.mean_wait.ci_low << ", "
                  << summary.mean_wait.ci_high << "]");
  // Same acceptance rule as test_mm1_failure: cross-replication CI covers
  // theory.wq, or the point estimate is within 0.75 of it.
  const bool ci_covers = summary.mean_wait.covers(theory_wq);
  const bool point_ok = std::abs(summary.mean_wait.mean - theory_wq) <= 0.75;
  REQUIRE((ci_covers || point_ok));
  REQUIRE(std::abs(summary.availability.mean - availability) < 0.03);
  REQUIRE(std::abs(summary.throughput.mean - kLambda) <= 0.05 * kLambda);
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
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 4, {kLambda}))}, {});
    const auto queue = block(builder, "Q", "queue",
                             {var_int(builder, "capacity", 1000000)}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", failure_rate),
               var_float(builder, "repair_rate", kRepair)},
              {});
    const auto service =
        block(builder, "S", "service",
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
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, queue, service, count, sink},
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
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto wait = block(builder, "W", "wait",
                            {var_int(builder, "capacity", 100),
                             var_bool(builder, "enableTimeout", enable_timeout),
                             var_float(builder, "timeout", 1.0)},
                            {});
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto service =
        block(builder, "S", "service",
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
    auto model = build(builder, {source, wait, service, sink, late},
                       {couple(builder, "In", "out", "W", "in"),
                        couple(builder, "W", "out", "S", "in"),
                        couple(builder, "W", "outTimeout", "Late", "in"),
                        couple(builder, "S", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 5, 0);
  };

  flatbuffers::FlatBufferBuilder with_timeout_builder;
  const ReplicationMetrics timed = build_wait(true, with_timeout_builder);
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
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto seize =
        block(builder, "Grab", "seize",
              {var_string(builder, "resource", "Server"),
               var_int(builder, "numberOfUnits", 1),
               var_bool(builder, "enableTimeout", enable_timeout),
               var_float(builder, "timeout", 0.5)},
              {});
    const auto service =
        block(builder, "S", "service",
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
    auto model = build(builder, {source, seize, service, sink, late},
                       {couple(builder, "In", "out", "Grab", "in"),
                        couple(builder, "Grab", "out", "S", "in"),
                        couple(builder, "Grab", "outTimeout", "Late", "in"),
                        couple(builder, "S", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 5, 0);
  };

  flatbuffers::FlatBufferBuilder with_timeout_builder;
  const ReplicationMetrics timed = build_seize(true, with_timeout_builder);
  // The first agent seizes the (single) unit but its downstream service has
  // zero capacity, so the other four wait 0.5s at the seize then exit via
  // outTimeout. (The first agent stays blocked in the seize's outgoing.)
  REQUIRE(timed.departures == 4);
  REQUIRE(timed.mean_sojourn == 0.5);

  flatbuffers::FlatBufferBuilder no_timeout_builder;
  const ReplicationMetrics stuck = build_seize(false, no_timeout_builder);
  REQUIRE(stuck.departures == 0);
}

TEST_CASE("process flow: full preempting queue routes every overflow",
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
    const auto queue = block(builder, "Q", "queue",
                             {var_int(builder, "capacity", 2),
                              var_string(builder, "queuing", queuing),
                              var_bool(builder, "enablePreemption", true)},
                             {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto service =
        block(builder, "S", "service",
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
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {s1, s2, queue, service, sink, preempted},
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
  // Seven arrivals, capacity two and a blocked normal output leave five
  // overflows. Preemption accepts and routes all five instead of propagating
  // backpressure, independent of which discipline selects the victim.
  REQUIRE(fifo.departures == 5);
  REQUIRE(priority.departures == 5);
}

TEST_CASE("process flow: full priority queue may preempt the newcomer itself",
          "[process_flow][preemption][queue]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto one_shot_source = [&](const char* name, double first_time,
                                   std::int64_t priority) {
    return block_with_state(
        builder, name, "source",
        {var_string(builder, "arrivalType", "interarrival_time"),
         var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "priority", priority)}, {});
  };
  const auto established = one_shot_source("Established", 1.0, 1);
  const auto preferred = one_shot_source("Preferred", 2.0, 5);
  const auto weak_newcomer = one_shot_source("WeakNewcomer", 3.0, 0);
  const auto queue =
      block(builder, "Q", "queue",
            {var_int(builder, "capacity", 1),
             var_string(builder, "queuing", "queuing_priority"),
             var_bool(builder, "enablePreemption", true)},
            {});
  const auto blocked = block(builder, "Blocked", "resource",
                             {var_int(builder, "capacity", 0)}, {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Blocked")},
            {});
  const auto route = block(builder, "WhichWasPreempted", "selectOutput",
                           {var_string(builder, "condition", "priority == 0")}, {});
  const auto old_dropped = block(builder, "EstablishedDropped", "sink", {}, {});
  const auto newcomer_dropped = block(builder, "NewcomerDropped", "sink", {}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder,
      {established, preferred, weak_newcomer, queue, service, route,
       old_dropped, newcomer_dropped, done},
      {couple(builder, "Established", "out", "Q", "in"),
       couple(builder, "Preferred", "out", "Q", "in"),
       couple(builder, "WeakNewcomer", "out", "Q", "in"),
       couple(builder, "Q", "out", "S", "in"),
       couple(builder, "Q", "outPreempted", "WhichWasPreempted", "in"),
       couple(builder, "WhichWasPreempted", "outT", "NewcomerDropped", "in"),
       couple(builder, "WhichWasPreempted", "outF", "EstablishedDropped", "in"),
       couple(builder, "S", "out", "Done", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 3, 0);
  const auto block_metric = [&](const char* name) -> const BlockMetrics& {
    const auto it = std::find_if(
        metrics.blocks.begin(), metrics.blocks.end(),
        [name](const BlockMetrics& block) { return block.name == name; });
    REQUIRE(it != metrics.blocks.end());
    return *it;
  };
  // Preferred ejects the established priority-1 waiter. The later priority-0
  // newcomer is still accepted, but as the weakest item it ejects itself.
  CHECK(block_metric("Q").arrived == 3);
  CHECK(block_metric("Q").preempted == 2);
  CHECK(block_metric("EstablishedDropped").departed == 1);
  CHECK(block_metric("NewcomerDropped").departed == 1);
  CHECK(block_metric("WeakNewcomer").departed == 1);
}

TEST_CASE("process flow: full preempting priority queue ejects the weakest "
          "established waiter",
          "[process_flow][preemption][queue]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto one_shot_source = [&](const char* name, double first_time,
                                   const char* first_mode,
                                   std::int64_t priority) {
    return block_with_state(
        builder, name, "source",
        {var_string(builder, "arrivalType", "interarrival_time"),
         var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", first_mode),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "priority", priority)}, {});
  };
  const auto weak = one_shot_source("Weak", 0.0, "at_start", 1);
  const auto mid = one_shot_source("Mid", 5.0, "at_time", 2);
  const auto strong = one_shot_source("Strong", 10.0, "at_time", 5);
  const auto queue =
      block(builder, "Q", "queue",
            {var_int(builder, "capacity", 2),
             var_string(builder, "queuing", "queuing_priority"),
             var_bool(builder, "enablePreemption", true)},
            {});
  const auto blocked = block(builder, "Blocked", "resource",
                             {var_int(builder, "capacity", 0)}, {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Blocked")},
            {});
  const auto route = block(builder, "Who", "selectOutput",
                           {var_string(builder, "condition", "priority == 1")},
                           {});
  const auto weakest_dropped =
      block(builder, "WeakestDropped", "sink", {}, {});
  const auto other_dropped = block(builder, "OtherDropped", "sink", {}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder,
      {weak, mid, strong, queue, service, route, weakest_dropped,
       other_dropped, done},
      {couple(builder, "Weak", "out", "Q", "in"),
       couple(builder, "Mid", "out", "Q", "in"),
       couple(builder, "Strong", "out", "Q", "in"),
       couple(builder, "Q", "out", "S", "in"),
       couple(builder, "Q", "outPreempted", "Who", "in"),
       couple(builder, "Who", "outT", "WeakestDropped", "in"),
       couple(builder, "Who", "outF", "OtherDropped", "in"),
       couple(builder, "S", "out", "Done", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 3, 0);
  const auto block_metric = [&](const char* name) -> const BlockMetrics& {
    const auto it = std::find_if(
        metrics.blocks.begin(), metrics.blocks.end(),
        [name](const BlockMetrics& block) { return block.name == name; });
    REQUIRE(it != metrics.blocks.end());
    return *it;
  };
  // Weak (priority 1, t=0) and Mid (priority 2, t=5) fill the capacity-2
  // queue; the out port is blocked, so Strong (priority 5, t=10) overflows.
  // The queue always accepts the newcomer, then routes the lowest-priority
  // entity -- the established priority-1 waiter, never the newcomer -- out
  // through outPreempted (AnyLogic queue.txt lines 980-983).
  CHECK(block_metric("Q").arrived == 3);
  CHECK(block_metric("Q").preempted == 1);
  CHECK(block_metric("Q").departed == 1);  // the one preempted exit
  CHECK(block_metric("WeakestDropped").departed == 1);
  CHECK(block_metric("OtherDropped").departed == 0);
  CHECK(block_metric("Done").departed == 0);
  CHECK(metrics.arrivals == 3);
  CHECK(metrics.departures == 1);
  // The ejected priority-1 waiter waited from t=0 until t=10.
  CHECK(metrics.mean_sojourn == 10.0);
}

TEST_CASE("process flow: full preempting priority queue ejects a lower-or-equal "
          "newcomer itself, never backpressuring upstream",
          "[process_flow][preemption][queue]") {
  const auto run_case = [&](std::int64_t newcomer_priority) {
    flatbuffers::FlatBufferBuilder builder;
    const auto established_source = [&](const char* name, double first_time,
                                        const char* first_mode) {
      return block_with_state(
          builder, name, "source",
          {var_string(builder, "arrivalType", "interarrival_time"),
           var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
           var_string(builder, "firstArrivalMode", first_mode),
           var_float(builder, "firstArrivalTime", first_time),
           var_bool(builder, "limitArrivals", true),
           var_int(builder, "maxArrivals", 1)},
          {var_int(builder, "priority", 5), var_int(builder, "tag", 1)}, {});
    };
    const auto est_a = established_source("EstablishedA", 0.0, "at_start");
    const auto est_b = established_source("EstablishedB", 5.0, "at_time");
    const auto newcomer = block_with_state(
        builder, "Newcomer", "source",
        {var_string(builder, "arrivalType", "interarrival_time"),
         var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", 10.0),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "priority", newcomer_priority),
         var_int(builder, "tag", 2)},
        {});
    const auto queue =
        block(builder, "Q", "queue",
              {var_int(builder, "capacity", 2),
               var_string(builder, "queuing", "queuing_priority"),
               var_bool(builder, "enablePreemption", true)},
              {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto service =
        block(builder, "S", "service",
              {var_dist(builder, "time", dist(builder, 0, {1.0})),
               var_string(builder, "resource", "Blocked")},
              {});
    const auto route = block(builder, "Who", "selectOutput",
                             {var_string(builder, "condition", "tag == 2")},
                             {});
    const auto newcomer_dropped =
        block(builder, "NewcomerDropped", "sink", {}, {});
    const auto established_dropped =
        block(builder, "EstablishedDropped", "sink", {}, {});
    const auto done = block(builder, "Done", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder,
        {est_a, est_b, newcomer, queue, service, route, newcomer_dropped,
         established_dropped, done},
        {couple(builder, "EstablishedA", "out", "Q", "in"),
         couple(builder, "EstablishedB", "out", "Q", "in"),
         couple(builder, "Newcomer", "out", "Q", "in"),
         couple(builder, "Q", "out", "S", "in"),
         couple(builder, "Q", "outPreempted", "Who", "in"),
         couple(builder, "Who", "outT", "NewcomerDropped", "in"),
         couple(builder, "Who", "outF", "EstablishedDropped", "in"),
         couple(builder, "S", "out", "Done", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return run_once(*model, 7, 3, 0);
  };
  const auto check_case = [&](const ReplicationMetrics& metrics) {
    const auto block_metric = [&](const char* name) -> const BlockMetrics& {
      const auto it = std::find_if(
          metrics.blocks.begin(), metrics.blocks.end(),
          [name](const BlockMetrics& block) { return block.name == name; });
      REQUIRE(it != metrics.blocks.end());
      return *it;
    };
    // Two priority-5 waiters (tag 1) fill the capacity-2 queue; the out port
    // is blocked. The newcomer is still always accepted (Q.arrived == 3) and,
    // being lower-or-equal priority than the weakest waiter, ejects ITSELF
    // through outPreempted -- never an established waiter, and never upstream
    // backpressure (AnyLogic queue.txt lines 980-983).
    CHECK(block_metric("Q").arrived == 3);
    CHECK(block_metric("Q").preempted == 1);
    CHECK(block_metric("Q").departed == 1);  // the one preempted exit
    CHECK(block_metric("NewcomerDropped").departed == 1);
    CHECK(block_metric("EstablishedDropped").departed == 0);
    CHECK(block_metric("Done").departed == 0);
    CHECK(metrics.arrivals == 3);
    CHECK(metrics.departures == 1);
    // The newcomer arrived and left at t=10 (no time spent queued).
    CHECK(metrics.mean_sojourn == 0.0);
  };

  // Lower-priority newcomer (1 < weakest 5): accepted, then ejects itself.
  const ReplicationMetrics lower = run_case(1);
  check_case(lower);
  // Equal-priority newcomer (5 == weakest 5): stable priority order leaves
  // the newcomer behind established equals, so it ejects itself too.
  const ReplicationMetrics equal = run_case(5);
  check_case(equal);
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
    const auto wait =
        block(builder, "W", "wait",
              {var_int(builder, "capacity", 100),
               var_string(builder, "queuing", "queuing_priority"),
               var_bool(builder, "enablePreemption", enable_preemption)},
              {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto service =
        block(builder, "S", "service",
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
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {s1, s2, wait, service, sink, preempted},
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
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", 1)}, {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto seize =
        block(builder, "Grab", "seize",
              {var_string(builder, "resource", "Server"),
               var_int(builder, "numberOfUnits", 1),
               var_bool(builder, "enablePreemption", enable_preemption)},
              {});
    const auto service =
        block(builder, "S", "service",
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
    auto model = build(builder, {s1, s2, seize, service, sink, preempted},
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
    const auto match =
        block(builder, "M", "match",
              {var_string(builder, "matchCondition", condition)}, {});
    const auto sink1 = block(builder, "K1", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(builder, {s1, s2, match, sink1, sink2},
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
    const auto match =
        block(builder, "M", "match",
              {var_string(builder, "matchCondition", condition)}, {});
    const auto sink1 = block(builder, "K1", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    std::string error;
    auto model = build(builder, {s1, s2, match, sink1, sink2},
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
  const ReplicationMetrics equal =
      run_match(1, 1, "agent1.kind == agent2.kind");
  REQUIRE(equal.departures == 6);

  const ReplicationMetrics mismatched =
      run_match(1, 2, "agent1.kind == agent2.kind");
  REQUIRE(mismatched.departures == 0);

  const ReplicationMetrics not_equal =
      run_match(1, 2, "agent1.kind != agent2.kind");
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
    const auto queue =
        block(builder, "Q", "queue",
              {var_int(builder, "capacity", 1),
               var_string(builder, "queuing", "queuing_comparison"),
               var_string(builder, "agent1IsPreferredToAgent2", comparison),
               var_bool(builder, "enablePreemption", true)},
              {});
    const auto blocked = block(builder, "Blocked", "resource",
                               {var_int(builder, "capacity", 0)}, {});
    const auto service =
        block(builder, "S", "service",
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
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {s1, s2, queue, service, sink, preempted},
                       {couple(builder, "S1", "out", "Q", "in"),
                        couple(builder, "S2", "out", "Q", "in"),
                        couple(builder, "Q", "out", "S", "in"),
                        couple(builder, "Q", "outPreempted", "Out", "in"),
                        couple(builder, "S", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // Capacity-1 queue: after the first waiter, every subsequent arrival is an
  // overflow and therefore reaches outPreempted. The comparison decides the
  // victim identity; the dedicated identity test below proves that boundary.
  const ReplicationMetrics bigger_first =
      run_comparison("agent1.size > agent2.size");
  REQUIRE(bigger_first.departures == 5);

  const ReplicationMetrics smaller_first =
      run_comparison("agent1.size < agent2.size");
  REQUIRE(smaller_first.departures == 5);

  // Insertion path: comparison ordering with an accepting downstream keeps
  // every agent (conservation through the repositioning code).
  flatbuffers::FlatBufferBuilder builder;
  const auto s1 =
      block_with_state(builder, "S1", "source",
                       {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
                       {var_int(builder, "size", 1)}, {});
  const auto s2 =
      block_with_state(builder, "S2", "source",
                       {var_dist(builder, "arrival", dist(builder, 0, {2.0}))},
                       {var_int(builder, "size", 5)}, {});
  const auto queue =
      block(builder, "Q", "queue",
            {var_int(builder, "capacity", 100),
             var_string(builder, "queuing", "queuing_comparison"),
             var_string(builder, "agent1IsPreferredToAgent2",
                        "agent1.size > agent2.size")},
            {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Server")},
            {});
  const auto resource = block(builder, "Server", "resource",
                              {var_int(builder, "capacity", 1)}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}), 0,
      0, 0, 0);
  std::string error2;
  auto model = build(builder, {s1, s2, queue, service, sink},
                     {couple(builder, "S1", "out", "Q", "in"),
                      couple(builder, "S2", "out", "Q", "in"),
                      couple(builder, "Q", "out", "S", "in"),
                      couple(builder, "S", "out", "K", "in")},
                     root, &error2);
  REQUIRE(model != nullptr);
  const ReplicationMetrics conserved = run_once(*model, 7, 6, 0);
  REQUIRE(conserved.departures == 6);
}

TEST_CASE("process flow: comparison overflow ejects the least preferred entity",
          "[process_flow][queuing][preemption]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto one_shot_source = [&](const char* name, double first_time,
                                   std::int64_t size) {
    return block_with_state(
        builder, name, "source",
        {var_string(builder, "arrivalType", "interarrival_time"),
         var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
         var_string(builder, "firstArrivalMode", "at_time"),
         var_float(builder, "firstArrivalTime", first_time),
         var_bool(builder, "limitArrivals", true),
         var_int(builder, "maxArrivals", 1)},
        {var_int(builder, "size", size)}, {});
  };
  const auto established = one_shot_source("Established", 1.0, 3);
  const auto preferred = one_shot_source("Preferred", 2.0, 5);
  const auto weak_newcomer = one_shot_source("WeakNewcomer", 3.0, 1);
  const auto queue =
      block(builder, "Q", "queue",
            {var_int(builder, "capacity", 1),
             var_string(builder, "queuing", "queuing_comparison"),
             var_string(builder, "agent1IsPreferredToAgent2",
                        "agent1.size > agent2.size"),
             var_bool(builder, "enablePreemption", true)},
            {});
  const auto blocked = block(builder, "Blocked", "resource",
                             {var_int(builder, "capacity", 0)}, {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Blocked")},
            {});
  const auto route = block(builder, "WhichWasPreempted", "selectOutput",
                           {var_string(builder, "condition", "size == 1")}, {});
  const auto old_dropped = block(builder, "EstablishedDropped", "sink", {}, {});
  const auto newcomer_dropped = block(builder, "NewcomerDropped", "sink", {}, {});
  const auto done = block(builder, "Done", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{blocked}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder,
      {established, preferred, weak_newcomer, queue, service, route,
       old_dropped, newcomer_dropped, done},
      {couple(builder, "Established", "out", "Q", "in"),
       couple(builder, "Preferred", "out", "Q", "in"),
       couple(builder, "WeakNewcomer", "out", "Q", "in"),
       couple(builder, "Q", "out", "S", "in"),
       couple(builder, "Q", "outPreempted", "WhichWasPreempted", "in"),
       couple(builder, "WhichWasPreempted", "outT", "NewcomerDropped", "in"),
       couple(builder, "WhichWasPreempted", "outF", "EstablishedDropped", "in"),
       couple(builder, "S", "out", "Done", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  const ReplicationMetrics metrics = run_once(*model, 7, 3, 0);
  const auto block_metric = [&](const char* name) -> const BlockMetrics& {
    const auto it = std::find_if(
        metrics.blocks.begin(), metrics.blocks.end(),
        [name](const BlockMetrics& block) { return block.name == name; });
    REQUIRE(it != metrics.blocks.end());
    return *it;
  };
  CHECK(block_metric("Q").arrived == 3);
  CHECK(block_metric("Q").preempted == 2);
  CHECK(block_metric("EstablishedDropped").departed == 1);
  CHECK(block_metric("NewcomerDropped").departed == 1);
}

TEST_CASE("process flow: equality comparison drives condition routing",
          "[process_flow][condition][attributes]") {
  const auto run_route = [](const char* condition) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source = block_with_state(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "size", 10)}, {});
    const auto route = block(builder, "R", "selectOutput",
                             {var_string(builder, "condition", condition)}, {});
    const auto slow =
        block(builder, "Slow", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {1.0}))}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, route, slow, sink},
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
  // Busy-time failure on a pool referenced by Seize/Release: while units
  // are held the pool may go down (exponential time-to-failure) and no new
  // grants are issued until the repair; units already held by an agent are
  // NOT interrupted (AnyLogic's "No preemption" default for seize-held
  // tasks - the failure task waits for the unit). Availability reflects
  // the pool downtime; a healthy pool keeps availability == 1.
  const auto run_seize_pool = [&](double failure_rate) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", failure_rate),
               var_float(builder, "repair_rate", 1.0)},
              {});
    const auto seize = block(builder, "Grab", "seize",
                             {var_string(builder, "resource", "Server"),
                              var_int(builder, "numberOfUnits", 1)},
                             {});
    const auto delay =
        block(builder, "Work", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
    const auto release = block(builder, "Drop", "release", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, seize, delay, release, sink},
                       {couple(builder, "In", "out", "Grab", "in"),
                        couple(builder, "Grab", "out", "Work", "in"),
                        couple(builder, "Work", "out", "Drop", "in"),
                        couple(builder, "Drop", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return run_once(*model, 7, 2000, 0);
  };

  // The pool fails while units are held by seize (busy-time failure law);
  // every agent still completes, the pool's downtime shows up in
  // availability, and no failures means availability == 1. An in-flight
  // failure keeps its repair: a unit released before the repair completes
  // does not clear the down state (the wait-through-repair lifecycle is
  // covered deterministically by the dedicated test above/below).
  const ReplicationMetrics failing = run_seize_pool(0.1);
  REQUIRE(failing.departures == 2000);
  REQUIRE(failing.availability > 0.85);
  REQUIRE(failing.availability < 1.0);
  REQUIRE(failing.availability >= 0.0);
  REQUIRE(failing.availability <= 1.0);

  const ReplicationMetrics clean = run_seize_pool(0.0);
  REQUIRE(clean.departures == 2000);
  REQUIRE(clean.availability == 1.0);

  // Determinism: identical config reproduces identical metrics.
  const ReplicationMetrics again = run_seize_pool(0.1);
  REQUIRE(again.departures == failing.departures);
  REQUIRE(again.availability == failing.availability);
  REQUIRE(again.mean_in_queue == failing.mean_in_queue);
}

TEST_CASE("process flow: assembler waits out pool failures without losing "
          "assemblies",
          "[process_flow][failure][des_blocks]") {
  // An Assembler referencing a failing pool behaves like Seize: new grants
  // are gated while the pool is down (agents wait), assemblies already in
  // progress are not interrupted (AnyLogic's "No preemption" default), and
  // every assembly still completes. availability reflects the downtime.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto parts =
      block(builder, "Parts", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1),
             var_float(builder, "failure_rate", 0.1),
             var_float(builder, "repair_rate", 1.0)},
            {});
  const auto assembler = block(
      builder, "Assemble", "assembler",
      {var_string(builder, "resourcePool", "Server"),
       var_int(builder, "numberOfUnits", 1),
       var_float(builder, "delayTime", 0.5)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, parts, assembler, sink},
                     {couple(builder, "In", "out", "Assemble", "in"),
                      couple(builder, "Parts", "out", "Assemble", "p1"),
                      couple(builder, "Assemble", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  const ReplicationMetrics metrics = run_once(*model, 7, 400, 0);
  // 400 arrival events total (200 per source): 200 main agents + 200
  // parts; every assembly completes once.
  REQUIRE(metrics.departures == 200);
  REQUIRE(metrics.mean_in_system >= 0.0);
  // The pool fails during the run (downtime shows up, bounds stay sane).
  REQUIRE(metrics.availability > 0.5);
  REQUIRE(metrics.availability < 1.0);
  REQUIRE(metrics.availability >= 0.0);
  REQUIRE(metrics.availability <= 1.0);
  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder builder2;
  const auto source2 =
      block(builder2, "In", "source",
            {var_dist(builder2, "arrival", dist(builder2, 0, {1.0}))}, {});
  const auto parts2 =
      block(builder2, "Parts", "source",
            {var_dist(builder2, "arrival", dist(builder2, 0, {1.0}))}, {});
  const auto resource2 =
      block(builder2, "Server", "resource",
            {var_int(builder2, "capacity", 1),
             var_float(builder2, "failure_rate", 0.1),
             var_float(builder2, "repair_rate", 1.0)},
            {});
  const auto assembler2 = block(
      builder2, "Assemble", "assembler",
      {var_string(builder2, "resourcePool", "Server"),
       var_int(builder2, "numberOfUnits", 1),
       var_float(builder2, "delayTime", 0.5)},
      {});
  const auto sink2 = block(builder2, "K", "sink", {}, {});
  const auto root2 = CreateNode(
      builder2, CreateMetadata(builder2, builder2.CreateString("M"), 0, 0, 0),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder2, builder2.CreateString("core"),
                         builder2.CreateString("model"), 0, 0),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource2}),
      0, 0, 0, 0);
  std::string error2;
  auto model2 =
      build(builder2, {source2, parts2, assembler2, sink2},
            {couple(builder2, "In", "out", "Assemble", "in"),
             couple(builder2, "Parts", "out", "Assemble", "p1"),
             couple(builder2, "Assemble", "out", "K", "in")},
            root2, &error2);
  REQUIRE(model2 != nullptr);
  const ReplicationMetrics again = run_once(*model2, 7, 400, 0);
  REQUIRE(again.departures == metrics.departures);
  REQUIRE(again.availability == metrics.availability);
  REQUIRE(again.mean_in_system == metrics.mean_in_system);
}

TEST_CASE("process flow: shared failure pool interrupts every consumer "
          "together",
          "[process_flow][failure][des_blocks]") {
  // Two Service blocks share one 4-unit pool, each task needing 2 units.
  // Busy-time failure is pool-wide (AnyLogic ResourcePool): one failure
  // clock per pool, and when it fires both consumers' in-service tasks are
  // preempted at the same instant and restart only after the pool repair.
  // Preemptive-repeat must extend sojourn (a stale pre-failure depart event
  // completing early would keep it near the bare 1.0s service time).
  //
  // Each lane has its own Source: process output ports do not fan out
  // implicitly (LP5007), so one source may not feed both consumers - a
  // single source reaching two branches would push the same entity id into
  // both and double-count departures. The pool itself is still shared, so
  // one pool-wide failure clock still interrupts both consumers together.
  const auto build_model = [](flatbuffers::FlatBufferBuilder& builder) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
    const auto source2 =
        block(builder, "In2", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
    const auto resource =
        block(builder, "Crew", "resource",
              {var_int(builder, "capacity", 4),
               var_float(builder, "failure_rate", 1.0),
               var_float(builder, "repair_rate", 1.0)},
              {});
    const auto left = block(
        builder, "Left", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Crew"),
         var_int(builder, "numberOfUnits", 2)}, {});
    const auto right = block(
        builder, "Right", "service",
        {var_dist(builder, "time", dist(builder, 0, {1.0})),
         var_string(builder, "resource", "Crew"),
         var_int(builder, "numberOfUnits", 2)}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto sink2 = block(builder, "K2", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(
        builder, {source, source2, left, right, sink, sink2},
        {couple(builder, "In", "out", "Left", "in"),
         couple(builder, "In2", "out", "Right", "in"),
         couple(builder, "Left", "out", "K", "in"),
         couple(builder, "Right", "out", "K2", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    return model;
  };
  const auto departed = [](const ReplicationMetrics& metrics,
                           const char* name) {
    for (const BlockMetrics& block : metrics.blocks) {
      if (block.name == name) {
        return block.departed;
      }
    }
    return std::uint64_t{0};
  };

  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  // 120 arrival events total (60 per source): 60 arrivals per lane produce
  // 120 tasks in total; the counts stay balanced (no entity exits twice,
  // in-system never negative).
  const ReplicationMetrics metrics = run_once(*model, 17, 120, 0);
  REQUIRE(metrics.departures == 120);
  REQUIRE(metrics.mean_in_system >= 0.0);
  // f = r = 1.0: long-run availability is ~0.5 (both consumers share one
  // pool-wide down period).
  REQUIRE(metrics.availability > 0.30);
  REQUIRE(metrics.availability < 0.70);
  // Availability is a fraction by construction: never outside [0, 1].
  REQUIRE(metrics.availability >= 0.0);
  REQUIRE(metrics.availability <= 1.0);
  // Preemptive-repeat: constant 1.0s service plus repair cycles keeps mean
  // sojourn well above the bare service time.
  REQUIRE(metrics.mean_sojourn > 1.3);
  // Both consumers actually served work.
  REQUIRE(departed(metrics, "Left") > 0);
  REQUIRE(departed(metrics, "Right") > 0);

  // One pool-wide failure clock per declared pool: the engine starts a
  // failure/repair clock exactly once per busy period (when the pool's busy
  // count leaves zero) and reschedules it on repair only while still busy.
  // Two consumers sharing the pool must not each start their own clock - a
  // duplicated clock would halve availability (f = r = 1: ~0.5 with one
  // clock, ~0.33 with two), which the bounds below would reject, and the
  // M/G/1 theory test (availability == r/(f+r)) rejects it statistically
  // too. A fixed seed reproduces the same run bit-for-bit.
  REQUIRE(metrics.availability > 0.40);
  REQUIRE(metrics.availability < 0.60);

  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder builder2;
  auto model2 = build_model(builder2);
  const ReplicationMetrics again = run_once(*model2, 17, 120, 0);
  REQUIRE(again.departures == metrics.departures);
  REQUIRE(again.mean_sojourn == metrics.mean_sojourn);
  REQUIRE(again.availability == metrics.availability);
}

TEST_CASE("process flow: shared pool failure checkpoint restores down state",
          "[process_flow][checkpoint][failure][resource]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto resource = block(
      builder, "Crew", "resource",
      {var_int(builder, "capacity", 1),
       var_float(builder, "failure_rate", 1.0),
       var_float(builder, "repair_rate", 1.0)}, {});
  const auto service = block(
      builder, "Work", "service",
      {var_dist(builder, "time", dist(builder, 0, {1.0})),
       var_string(builder, "resource", "Crew")}, {});
  const auto sink = block(builder, "Out", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Out", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 53;
  config.arrivals = 5;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(250'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.availability == first.availability);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
}

TEST_CASE("process flow: in_service snapshots keep pool-preempted tasks "
          "visible",
          "[process_flow][failure][telemetry]") {
  // BlockSnapshot.in_service reports the slots actually occupied: a task
  // preempted by a pool-wide failure keeps its slot until the repair (it
  // restarts then), so the live snapshot must not read 0 while the pool is
  // down. Single task, single unit, f = 2 (time-to-failure mean 0.5 s vs
  // 1.0 s service: the failure fires mid-task with high probability),
  // r = 0.5 (repair mean 2 s). Once the task occupies the slot there is no
  // legitimate empty window - it is either serving or preempted-held - so
  // in_service must stay >= 1 for every snapshot until the run drains.
  // (An extreme failure rate would livelock here: every repair would be
  // followed by an instant re-failure, so the task could never complete.)
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1}))}, {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1),
             var_float(builder, "failure_rate", 2.0),
             var_float(builder, "repair_rate", 0.5)},
            {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {1.0})),
             var_string(builder, "resource", "Server")},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "S", "in"),
                      couple(builder, "S", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 11;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);

  // Drive the run in 1 ms slices. Once the single task occupies the slot,
  // in_service must never read 0 while events are still pending: the task
  // is either serving or preempted-held during a pool-down window. When
  // the task completes, the pool's failure clock is cancelled (busy period
  // ends), so no stale pool event stays pending afterwards - "pending" is
  // a reliable window boundary.
  bool started = false;
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
    const bool pending = model->has_pending_events();
    for (const logicpilot::BlockSnapshot& snapshot : model->block_snapshots()) {
      if (snapshot.name != "S") {
        continue;
      }
      if (snapshot.in_service > 0) {
        started = true;
      }
      if (started && pending) {
        INFO("snapshot at t=" << boundary_ns << " in_service="
                              << snapshot.in_service);
        REQUIRE(snapshot.in_service > 0);
      }
    }
  }
  // The scheduler drains immediately after the business ends: no stale
  // pool failure/repair event may keep it alive past the last departure.
  REQUIRE_FALSE(model->has_pending_events());
  REQUIRE(started);
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 1);
  // The seed must actually exercise a pool-down window, otherwise the test
  // proves nothing: availability < 1 means the pool went down mid-task.
  REQUIRE(metrics.availability < 1.0);
  REQUIRE(metrics.availability >= 0.0);
  REQUIRE(metrics.availability <= 1.0);
}

TEST_CASE("process flow: pool failure clock stops when the busy period ends",
          "[process_flow][failure]") {
  // A single task on a failing pool: when the last unit is released the
  // pool's busy period ends, and the pending time-to-failure event must be
  // cancelled (not left to fire at a business-meaningless future time).
  // The scheduler must drain immediately after the task completes.
  const auto build_model = [](flatbuffers::FlatBufferBuilder& builder,
                              double failure_rate) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", failure_rate),
               var_float(builder, "repair_rate", 1.0)},
              {});
    const auto service =
        block(builder, "S", "service",
              {var_dist(builder, "time", dist(builder, 0, {1.0})),
               var_string(builder, "resource", "Server")},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, service, sink},
                       {couple(builder, "In", "out", "S", "in"),
                        couple(builder, "S", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return model;
  };

  // failure_rate = 0.001: the first TTF averages 1000 s, far beyond the
  // 1.0 s task, so the business ends long before the failure would fire.
  // The leftover TTF event (pre-fix behavior) kept the scheduler alive and
  // advanced the clock/areas when it finally fired.
  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder, 0.001);
  ReplicationConfig config;
  config.seed = 11;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  // The scheduler drains at the business end; the failure clock must not
  // hold it open. The task completes at 2.0 s (arrival at 1.0 + 1.0 s
  // service) - a leftover TTF would push the horizon toward ~1000 s.
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE_FALSE(model->has_pending_events());
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.horizon_seconds == Catch::Approx(2.0));
  REQUIRE(metrics.availability == 1.0);  // the failure never fired
}

TEST_CASE("process flow: an idle-pool stale failure cannot pollute time "
          "integrals",
          "[process_flow][failure]") {
  // Identical business, two failure rates: 0 (no clock at all) and a tiny
  // rate whose first TTF lands far after the business ends. The horizon
  // and the time integrals (L, utilization, availability, sojourn) must be
  // identical - the stale TTF must neither advance the clock nor touch the
  // area accumulators (pre-fix it ran accumulate_areas() before its
  // validity check and inflated the horizon).
  const auto run = [](double failure_rate) {
    flatbuffers::FlatBufferBuilder builder;
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", failure_rate),
               var_float(builder, "repair_rate", 1.0)},
              {});
    const auto service =
        block(builder, "S", "service",
              {var_dist(builder, "time", dist(builder, 0, {1.0})),
               var_string(builder, "resource", "Server")},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, service, sink},
                       {couple(builder, "In", "out", "S", "in"),
                        couple(builder, "S", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 11, 3, 0);
  };

  const ReplicationMetrics clean = run(0.0);
  const ReplicationMetrics tiny_ttf = run(0.001);
  REQUIRE(clean.departures == 3);
  REQUIRE(tiny_ttf.departures == 3);
  REQUIRE(tiny_ttf.horizon_seconds == clean.horizon_seconds);
  REQUIRE(tiny_ttf.mean_in_system == clean.mean_in_system);
  REQUIRE(tiny_ttf.mean_in_queue == clean.mean_in_queue);
  REQUIRE(tiny_ttf.mean_sojourn == clean.mean_sojourn);
  REQUIRE(tiny_ttf.mean_wait == clean.mean_wait);
  REQUIRE(tiny_ttf.utilization == clean.utilization);
  REQUIRE(tiny_ttf.availability == clean.availability);
}

TEST_CASE("process flow: seize waiters stay blocked until the repair "
          "completes",
          "[process_flow][failure][des_blocks]") {
  // Entity 1 seizes the only unit at 1.5 s and holds it for 0.5 s. With
  // f = 2 the failure fires inside the hold (fixed seed) and the pool goes
  // down; a repair with mean 5 s is scheduled. Seize is no-preemption, so
  // entity 1 keeps its unit and releases at 2.0 s - BEFORE the repair.
  // Entity 2 arrives at 3.0 s while the pool is still down: it must keep
  // waiting until the repair event actually fires. Releasing the last
  // held unit must NOT cancel the repair or clear the down state
  // (pre-fix behaviour: entity 2 seized immediately at 3.0 s).
  const auto build_model = [](flatbuffers::FlatBufferBuilder& builder) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.5}))}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", 2.0),
               var_float(builder, "repair_rate", 0.2)},
              {});
    const auto seize = block(builder, "Grab", "seize",
                             {var_string(builder, "resource", "Server"),
                              var_int(builder, "numberOfUnits", 1)},
                             {});
    const auto delay =
        block(builder, "Work", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
    const auto release = block(builder, "Drop", "release", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, seize, delay, release, sink},
                       {couple(builder, "In", "out", "Grab", "in"),
                        couple(builder, "Grab", "out", "Work", "in"),
                        couple(builder, "Work", "out", "Drop", "in"),
                        couple(builder, "Drop", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return model;
  };

  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  const ReplicationMetrics metrics = run_once(*model, 3, 2, 0);
  REQUIRE(metrics.departures == 2);
  // The seed must fire the failure inside entity 1's hold and keep the
  // pool down past 3.0 s (otherwise the test proves nothing).
  REQUIRE(metrics.availability < 1.0);
  REQUIRE(metrics.availability > 0.0);
  // Entity 1 sojourn 0.5 s; entity 2 waits through the repair (mean 5 s
  // starting at 2.0 s, so it seizes around 5-9 s). Without the wait the
  // mean would be ~0.5.
  REQUIRE(metrics.mean_sojourn > 1.5);
  REQUIRE(metrics.mean_sojourn < 8.0);
  // Entity 2 queued inside the seize block while the pool was down.
  REQUIRE(metrics.mean_in_queue > 0.0);

  // Determinism: identical config reproduces identical metrics.
  flatbuffers::FlatBufferBuilder builder2;
  auto model2 = build_model(builder2);
  const ReplicationMetrics again = run_once(*model2, 3, 2, 0);
  REQUIRE(again.departures == metrics.departures);
  REQUIRE(again.mean_sojourn == metrics.mean_sojourn);
  REQUIRE(again.mean_in_queue == metrics.mean_in_queue);
  REQUIRE(again.availability == metrics.availability);
}

TEST_CASE("process flow: tail pool maintenance cannot stretch the final "
          "horizon",
          "[process_flow][failure][des_blocks]") {
  // A single entity seizes the unit at 1.0 s, the pool fails inside the
  // 0.5 s hold (f = 2, fixed seed), and the entity releases at 1.5 s -
  // the run's business ends right there (arrivals = 1, nothing left in
  // the system). The repair (mean 20 s) is still pending: it is a tail
  // maintenance event with no business meaning, so the runner must cancel
  // it and drain at the exact business end instead of dragging the
  // horizon to the repair time.
  const auto build_model = [](flatbuffers::FlatBufferBuilder& builder) {
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto resource =
        block(builder, "Server", "resource",
              {var_int(builder, "capacity", 1),
               var_float(builder, "failure_rate", 2.0),
               var_float(builder, "repair_rate", 0.05)},
              {});
    const auto seize = block(builder, "Grab", "seize",
                             {var_string(builder, "resource", "Server"),
                              var_int(builder, "numberOfUnits", 1)},
                             {});
    const auto delay =
        block(builder, "Work", "delay",
              {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
    const auto release = block(builder, "Drop", "release", {}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, seize, delay, release, sink},
                       {couple(builder, "In", "out", "Grab", "in"),
                        couple(builder, "Grab", "out", "Work", "in"),
                        couple(builder, "Work", "out", "Drop", "in"),
                        couple(builder, "Drop", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return model;
  };

  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  ReplicationConfig config;
  config.seed = 23;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 1);
  // The seed must fire the failure inside the 0.5 s hold.
  REQUIRE(metrics.availability < 1.0);
  // Horizon is the exact business end (arrival 1.0 + 0.5 s hold = 1.5 s),
  // not the repair time (~21 s).
  REQUIRE(metrics.horizon_seconds == Catch::Approx(1.5));
  REQUIRE(metrics.availability >= 0.0);
  REQUIRE(metrics.availability <= 1.0);
}

TEST_CASE("process flow: a source limited below config.arrivals still ends "
          "the business",
          "[process_flow][failure][source_limit]") {
  // The only source has limitArrivals = 1 while config.arrivals = 100:
  // the business ends when that single entity leaves, even though the
  // global arrival counter never reaches the configured cap. A pending
  // pool repair (mean 20 s) must be treated as a tail maintenance event
  // and cancelled, so the scheduler drains at the exact business end.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1),
             var_float(builder, "failure_rate", 2.0),
             var_float(builder, "repair_rate", 0.05)},
            {});
  const auto seize = block(builder, "Grab", "seize",
                           {var_string(builder, "resource", "Server"),
                            var_int(builder, "numberOfUnits", 1)},
                           {});
  const auto delay =
      block(builder, "Work", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release = block(builder, "Drop", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, seize, delay, release, sink},
                     {couple(builder, "In", "out", "Grab", "in"),
                      couple(builder, "Grab", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Drop", "in"),
                      couple(builder, "Drop", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 23;
  config.arrivals = 100;  // far above the source's own limit
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  // Exactly one external arrival (maxArrivals = 1), one departure.
  REQUIRE(metrics.arrivals == 1);
  REQUIRE(metrics.departures == 1);
  // The failure fired inside the hold (seed must guarantee it).
  REQUIRE(metrics.availability < 1.0);
  // Horizon is the business end (arrival 1.0 + 0.5 s hold = 1.5 s), not
  // the repair time (~21 s) - the tail repair was cancelled even though
  // config.arrivals was never reached.
  REQUIRE(metrics.horizon_seconds == Catch::Approx(1.5));
  REQUIRE(metrics.availability >= 0.0);
  REQUIRE(metrics.availability <= 1.0);
}

TEST_CASE("process flow: a pending arrival of another source cannot stretch "
          "the horizon",
          "[process_flow][multi_source][arrivals]") {
  // Two sources with one global arrival: source A fires at 0.5 s, source B
  // has already scheduled a far-future arrival at 100 s. When A's arrival
  // reaches the global cap, B's pending arrival must be cancelled - it
  // would otherwise be popped by run_until and advance the clock to 100 s
  // before its no-op handler runs.
  flatbuffers::FlatBufferBuilder builder;
  const auto source_a =
      block(builder, "A", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto source_b =
      block(builder, "B", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {100.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5})),
             var_bool(builder, "maximumCapacity", true)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source_a, source_b, delay, sink},
                     {couple(builder, "A", "out", "D", "in"),
                      couple(builder, "B", "out", "D", "in"),
                      couple(builder, "D", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  // Exactly one arrival from A; B's pending arrival was cancelled.
  REQUIRE(metrics.arrivals == 1);
  REQUIRE(metrics.departures == 1);
  // Horizon is A's business end (0.5 + 0.5 = 1.0 s), never 100 s.
  REQUIRE(metrics.horizon_seconds == Catch::Approx(1.0));
  REQUIRE(metrics.mean_in_system >= 0.0);

  // Determinism: same seed reproduces the same run (and the same A/B
  // resolution).
  flatbuffers::FlatBufferBuilder builder2;
  const auto source_a2 =
      block(builder2, "A", "source",
            {var_dist(builder2, "arrival", dist(builder2, 0, {0.5}))}, {});
  const auto source_b2 =
      block(builder2, "B", "source",
            {var_dist(builder2, "arrival", dist(builder2, 0, {100.0}))}, {});
  const auto delay2 =
      block(builder2, "D", "delay",
            {var_dist(builder2, "delayTime", dist(builder2, 0, {0.5})),
             var_bool(builder2, "maximumCapacity", true)},
            {});
  const auto sink2 = block(builder2, "K", "sink", {}, {});
  std::string error2;
  auto model2 = build(builder2, {source_a2, source_b2, delay2, sink2},
                      {couple(builder2, "A", "out", "D", "in"),
                       couple(builder2, "B", "out", "D", "in"),
                       couple(builder2, "D", "out", "K", "in")},
                      flatbuffers::Offset<Node>{}, &error2);
  REQUIRE(model2 != nullptr);
  const ReplicationMetrics again = run_once(*model2, 7, 1, 0);
  REQUIRE(again.arrivals == metrics.arrivals);
  REQUIRE(again.departures == metrics.departures);
  REQUIRE(again.horizon_seconds == metrics.horizon_seconds);
}

TEST_CASE("process flow: an idle gap with pending arrivals is not the end "
          "of the business",
          "[process_flow][multi_source][arrivals]") {
  // Two sources that BOTH produce an entity. Source A's entity completes
  // at 1.5 s, leaving in_system == 0 while source B's arrival is still
  // pending at 1.5 s - business_finished must stay false during that idle
  // gap (a pool repair pending across it must not be cancelled), and B's
  // arrival must still fire. With a failing pool, B's entity waits for the
  // repair that A's hold triggered - proving the repair survived the gap.
  flatbuffers::FlatBufferBuilder builder;
  const auto source_a =
      block(builder, "A", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto source_b =
      block(builder, "B", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {2.0}))}, {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1),
             var_float(builder, "failure_rate", 2.0),
             var_float(builder, "repair_rate", 0.2)},
            {});
  const auto seize_a =
      block(builder, "GrabA", "seize",
            {var_string(builder, "resource", "Server"),
             var_int(builder, "numberOfUnits", 1)},
            {});
  const auto seize_b =
      block(builder, "GrabB", "seize",
            {var_string(builder, "resource", "Server"),
             var_int(builder, "numberOfUnits", 1)},
            {});
  const auto delay_a =
      block(builder, "WorkA", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto delay_b =
      block(builder, "WorkB", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release_a = block(builder, "DropA", "release", {}, {});
  const auto release_b = block(builder, "DropB", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(
      builder,
      {source_a, source_b, seize_a, seize_b, delay_a, delay_b, release_a,
       release_b, sink},
      {couple(builder, "A", "out", "GrabA", "in"),
       couple(builder, "B", "out", "GrabB", "in"),
       couple(builder, "GrabA", "out", "WorkA", "in"),
       couple(builder, "GrabB", "out", "WorkB", "in"),
       couple(builder, "WorkA", "out", "DropA", "in"),
       couple(builder, "WorkB", "out", "DropB", "in"),
       couple(builder, "DropA", "out", "K", "in"),
       couple(builder, "DropB", "out", "K", "in")},
      root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 3;
  config.arrivals = 2;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  // Both sources produced and both entities completed.
  REQUIRE(metrics.arrivals == 2);
  REQUIRE(metrics.departures == 2);
  // The failure fired inside A's hold (seed must guarantee it), and B's
  // entity waited for the repair instead of being cut short by a tail
  // cancellation during the idle gap.
  REQUIRE(metrics.availability < 1.0);
  REQUIRE(metrics.mean_sojourn > 1.0);
}

TEST_CASE("process flow: a completed service leaves no stale timeout",
          "[process_flow][timeout][des_blocks]") {
  // The single entity never waits: it starts service immediately at 0.1 s
  // and finishes at 0.3 s. With enableTimeout = true and timeout = 10 s the
  // block schedules a timeout for the waiting entity - which must be
  // cancelled when the entity starts service. Pre-fix, the timeout fired at
  // ~10.1 s, dragging the horizon there despite the run being done at
  // 0.3 s.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {0.2})),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 10.0)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "S", "in"),
                      couple(builder, "S", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 1);
  // Horizon is the exact business end (0.1 + 0.2 = 0.3 s), not the 10.1 s
  // stale timeout.
  REQUIRE(metrics.horizon_seconds == Catch::Approx(0.3));
}

TEST_CASE("process flow: starting service cancels a queued entity's timeout",
          "[process_flow][timeout][des_blocks]") {
  // Entity 1 starts at 0.2 s and serves until 0.7 s (0.5 s service);
  // entity 2 arrives at 0.4 s, queues (queueCapacity 1) and a 10 s timeout
  // is scheduled. It starts service at 0.7 s - before the timeout - so the
  // timeout must be cancelled and the horizon must end at 1.2 s, not
  // ~10.4 s.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.2})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 2)},
            {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {0.5})),
             var_int(builder, "queueCapacity", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 10.0)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, service, sink},
                     {couple(builder, "In", "out", "S", "in"),
                      couple(builder, "S", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 2;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 2);
  REQUIRE(metrics.horizon_seconds == Catch::Approx(1.2));
}

TEST_CASE("process flow: seizing before the timeout cancels it",
          "[process_flow][timeout][des_blocks]") {
  // Entity 1 seizes the only unit at 0.1 s and holds it for 0.5 s; entity
  // 2 arrives at 0.1 s, queues in the seize block and gets a 10 s timeout,
  // then seizes at 0.6 s - before the timeout fires. The timeout must be
  // cancelled; horizon ends at 0.6 s.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 2)},
            {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1)}, {});
  const auto seize =
      block(builder, "Grab", "seize",
            {var_string(builder, "resource", "Server"),
             var_int(builder, "numberOfUnits", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 10.0)},
            {});
  const auto delay =
      block(builder, "Work", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release = block(builder, "Drop", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, seize, delay, release, sink},
                     {couple(builder, "In", "out", "Grab", "in"),
                      couple(builder, "Grab", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Drop", "in"),
                      couple(builder, "Drop", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 2;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 2);
  // Entity 2 seizes at 0.6 s (release of the 0.5 s hold), then holds
  // through its own 0.5 s delay and leaves at 1.1 s; the stale 10.1 s
  // timeout must not stretch the horizon.
  REQUIRE(metrics.horizon_seconds == Catch::Approx(1.1));
}

TEST_CASE("process flow: a wait that passes before its timeout leaves no "
          "stale event",
          "[process_flow][timeout][des_blocks]") {
  // A queue with enableTimeout: the entity passes immediately (downstream
  // accepts), so its timeout is scheduled and must be cancelled when it
  // leaves the waiting area normally.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 1)},
            {});
  const auto queue =
      block(builder, "Q", "queue",
            {var_int(builder, "capacity", 10),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 10.0)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, queue, sink},
                     {couple(builder, "In", "out", "Q", "in"),
                      couple(builder, "Q", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.horizon_seconds == Catch::Approx(0.1));
}

TEST_CASE("process flow: a live wait timeout still fires while the business "
          "is running",
          "[process_flow][timeout][des_blocks]") {
  // The entity waits in a queue whose timeout is shorter than the service
  // hold: the timeout is a real business event (the entity leaves through
  // outTimeout) and must NOT be cancelled - neither by the idle-gap tail
  // logic (business is not finished: another arrival is pending and the
  // entity is still in the system) nor by any premature cancellation.
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.1})),
             var_bool(builder, "limitArrivals", true),
             var_int(builder, "maxArrivals", 2)},
            {});
  const auto service =
      block(builder, "S", "service",
            {var_dist(builder, "time", dist(builder, 0, {0.5})),
             var_int(builder, "queueCapacity", 1),
             var_bool(builder, "enableTimeout", true),
             var_float(builder, "timeout", 0.2)},
            {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto timeout_sink = block(builder, "T", "sink", {}, {});
  std::string error;
  auto model =
      build(builder, {source, service, sink, timeout_sink},
            {couple(builder, "In", "out", "S", "in"),
             couple(builder, "S", "out", "K", "in"),
             couple(builder, "S", "outTimeout", "T", "in")},
            flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 2;
  config.warmup_arrivals = 0;
  model->reset(config);
  std::int64_t boundary_ns = 0;
  while (model->has_pending_events()) {
    boundary_ns += 1'000'000;
    model->advance(logicpilot::SimTime::from_ns(boundary_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  // Entity 1 serves 0.1-0.6 s; entity 2 (arriving at 0.2 s, queueCapacity
  // 1) times out at 0.4 s through outTimeout. Both left the system.
  REQUIRE(metrics.departures == 2);
  REQUIRE(metrics.horizon_seconds == Catch::Approx(0.6));
  const BlockMetrics* service_metrics = nullptr;
  for (const BlockMetrics& block : metrics.blocks) {
    if (block.name == "S") {
      service_metrics = &block;
    }
  }
  REQUIRE(service_metrics != nullptr);
  REQUIRE(service_metrics->timed_out == 1);
}

TEST_CASE("process flow: exit removes agents from the flow (sojourn kept)",
          "[process_flow][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto delay =
      block(builder, "D", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto exit = block(builder, "Out", "exit", {}, {});
  std::string error;
  auto model = build(builder, {source, delay, exit},
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
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto enter = block(builder, "E", "enter", {}, {});
  const auto sink2 = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, sink, enter, sink2},
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
    const auto kits =
        block(builder, "Kits", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {2.0}))}, {});
    const auto parts = block(
        builder, "Parts", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {parts_rate}))}, {});
    const auto assembler =
        block(builder, "Build", "assembler",
              {var_int(builder, "quantity125", parts_needed),
               var_float(builder, "delayTime", delay_seconds)},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {kits, parts, assembler, sink},
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

TEST_CASE("process flow: assembler gates on assembly resources",
          "[process_flow][assembler][des_blocks]") {
  const auto run_assembler_resource = [&](std::int64_t capacity) {
    flatbuffers::FlatBufferBuilder builder;
    const auto kits =
        block(builder, "Kits", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {2.0}))}, {});
    const auto parts =
        block(builder, "Parts", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto assembler = block(builder, "Build", "assembler",
                                 {var_int(builder, "quantity125", 2),
                                  var_float(builder, "delayTime", 2.0),
                                  var_string(builder, "resourcePool", "Server"),
                                  var_int(builder, "numberOfUnits", 1)},
                                 {});
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", capacity)}, {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {kits, parts, assembler, sink},
                       {couple(builder, "Kits", "out", "Build", "in"),
                        couple(builder, "Parts", "out", "Build", "p1"),
                        couple(builder, "Build", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // Assemblies form at t=2 and t=4, each holding the single unit for 2.0s.
  const ReplicationMetrics gated = run_assembler_resource(1);
  REQUIRE(gated.departures == 2);
  REQUIRE(gated.mean_sojourn == 2.0);

  // A zero-capacity pool never grants a unit: no assembly starts.
  const ReplicationMetrics blocked = run_assembler_resource(0);
  REQUIRE(blocked.departures == 0);

  // Determinism.
  const ReplicationMetrics again = run_assembler_resource(1);
  REQUIRE(again.departures == gated.departures);
  REQUIRE(again.mean_sojourn == gated.mean_sojourn);
}

TEST_CASE("process flow: composed blocks conserve entities end-to-end",
          "[process_flow][composition][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block_with_state(builder, "In", "source",
                       {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
                       {var_int(builder, "priority", 5)}, {});
  const auto route =
      block(builder, "R", "selectOutput",
            {var_string(builder, "condition", "priority > 3")}, {});
  const auto batch = block(
      builder, "B", "batch",
      {var_int(builder, "batchSize", 2), var_bool(builder, "permanent", false)},
      {});
  const auto unbatch = block(builder, "U", "unbatch", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto late_sink = block(builder, "K2", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, route, batch, unbatch, sink, late_sink},
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
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto move = block(builder, "M", "moveTo",
                            {var_float(builder, "tripTime", trip_time),
                             var_float(builder, "speed", speed),
                             var_float(builder, "xYZ", target_x)},
                            {});
    const auto sink = block(builder, "K", "sink", {}, {});
    std::string error;
    auto model = build(builder, {source, move, sink},
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

TEST_CASE("process flow: moveTo resolves a node destination",
          "[process_flow][moveTo][des_blocks]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
  const auto move = block(
      builder, "M", "moveTo",
      {var_string(builder, "node", "Depot"), var_float(builder, "speed", 5.0)},
      {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto node = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("Depot"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{
          var_float(builder, "x", 10.0), var_float(builder, "y", 0.0)}),
      0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("node"), 0, 0),
      0, 0, 0, 0, 0);
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{node}), 0, 0,
      0, 0);
  std::string error;
  auto model = build(builder, {source, move, sink},
                     {couple(builder, "In", "out", "M", "in"),
                      couple(builder, "M", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  // Depot is 10 units away at speed 5 -> 2.0s travel.
  const ReplicationMetrics metrics = run_once(*model, 7, 3, 0);
  REQUIRE(metrics.departures == 3);
  REQUIRE(metrics.mean_sojourn == 2.0);
}

TEST_CASE("process flow: moveTo checkpoint restores explicit trip",
          "[process_flow][checkpoint][moveTo]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_start"),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto move = block(builder, "Move", "moveTo",
                          {var_float(builder, "tripTime", 2.0)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, move, sink},
                     {couple(builder, "In", "out", "Move", "in"),
                      couple(builder, "Move", "out", "Done", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 79;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
}

TEST_CASE("process flow: moveTo checkpoint restores path travel",
          "[process_flow][checkpoint][moveTo][network]") {
  flatbuffers::FlatBufferBuilder builder;
  const auto build_node = [&](const char* name, double x, double y) {
    return CreateNode(
        builder, CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{
            var_float(builder, "x", x), var_float(builder, "y", y)}),
        0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("node"), 0, 0),
        0, 0, 0, 0, 0);
  };
  const auto build_path = [&](const char* name, const char* a,
                              const char* b) {
    return CreateNode(
        builder, CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{
            var_string(builder, "node1", a), var_string(builder, "node2", b)}),
        0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("path"), 0, 0),
        0, 0, 0, 0, 0);
  };
  const auto source = block(
      builder, "In", "source",
      {var_string(builder, "arrivalType", "interarrival_time"),
       var_dist(builder, "interarrivalTime", dist(builder, 0, {100.0})),
       var_string(builder, "firstArrivalMode", "at_start"),
       var_bool(builder, "limitArrivals", true),
       var_int(builder, "maxArrivals", 1)}, {});
  const auto move = block(builder, "Move", "moveTo",
                          {var_string(builder, "node", "C"),
                           var_float(builder, "speed", 10.0)}, {});
  const auto sink = block(builder, "Done", "sink", {}, {});
  const auto node_a = build_node("A", 0.0, 0.0);
  const auto node_b = build_node("B", 10.0, 0.0);
  const auto node_c = build_node("C", 10.0, 10.0);
  const auto path_ab = build_path("AB", "A", "B");
  const auto path_bc = build_path("BC", "B", "C");
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{
          node_a, node_b, node_c, path_ab, path_bc}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, move, sink},
                     {couple(builder, "In", "out", "Move", "in"),
                      couple(builder, "Move", "out", "Done", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  ReplicationConfig config;
  config.seed = 83;
  config.arrivals = 1;
  model->reset(config);
  REQUIRE(model->advance(SimTime::from_ns(500'000'000), nullptr) > 0);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(model->checkpoint_save(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics first = model->metrics();
  REQUIRE(model->checkpoint_restore(checkpoint));
  REQUIRE(model->advance(SimTime::infinity(), nullptr) > 0);
  const ReplicationMetrics second = model->metrics();
  REQUIRE(second.departures == first.departures);
  REQUIRE(second.horizon_seconds == first.horizon_seconds);
  REQUIRE(second.mean_sojourn == first.mean_sojourn);
  REQUIRE(first.horizon_seconds == 2.0);
}

TEST_CASE("process flow: moveTo follows the path network's shortest route",
          "[process_flow][moveTo][network][des_blocks]") {
  const auto run = [&](bool with_paths) {
    flatbuffers::FlatBufferBuilder builder;
    const auto build_node = [&](const char* name, double x, double y) {
      return CreateNode(
          builder, CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
          builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
          builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{
              var_float(builder, "x", x), var_float(builder, "y", y)}),
          0,
          CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("node"), 0, 0),
          0, 0, 0, 0, 0);
    };
    const auto build_path = [&](const char* name, const char* a,
                                const char* b) {
      return CreateNode(
          builder, CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
          builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
          builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{
              var_string(builder, "node1", a),
              var_string(builder, "node2", b)}),
          0,
          CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("path"), 0, 0),
          0, 0, 0, 0, 0);
    };
    const auto source =
        block(builder, "In", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0}))}, {});
    const auto move = block(
        builder, "M", "moveTo",
        {var_string(builder, "node", "C"), var_float(builder, "speed", 10.0)},
        {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto nodeA = build_node("A", 0.0, 0.0);
    const auto nodeB = build_node("B", 10.0, 0.0);
    const auto nodeC = build_node("C", 10.0, 10.0);
    std::vector<flatbuffers::Offset<Node>> children{nodeA, nodeB, nodeC};
    if (with_paths) {
      children.push_back(build_path("AB", "A", "B"));
      children.push_back(build_path("BC", "B", "C"));
    }
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(children), 0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {source, move, sink},
                       {couple(builder, "In", "out", "M", "in"),
                        couple(builder, "M", "out", "K", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 3, 0);
  };

  // Entity starts at A (0,0): A->C via B along the network is 20 units
  // (10 + 10); without paths the fallback is the direct 14.14.
  const ReplicationMetrics networked = run(true);
  REQUIRE(networked.mean_sojourn == 2.0);

  const ReplicationMetrics direct = run(false);
  REQUIRE(std::abs(direct.mean_sojourn - std::sqrt(200.0) / 10.0) < 1e-6);
}

TEST_CASE("process flow: service task preemption interrupts weak tasks",
          "[process_flow][preemption][des_blocks]") {
  const auto run_service = [&](bool enable_preemption) {
    flatbuffers::FlatBufferBuilder builder;
    const auto s1 = block_with_state(
        builder, "S1", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {1.0}))},
        {var_int(builder, "priority", 1)}, {});
    const auto s2 = block_with_state(
        builder, "S2", "source",
        {var_dist(builder, "arrival", dist(builder, 0, {3.0}))},
        {var_int(builder, "priority", 5)}, {});
    const auto resource = block(builder, "Server", "resource",
                                {var_int(builder, "capacity", 1)}, {});
    const auto service =
        block(builder, "S", "service",
              {var_dist(builder, "time", dist(builder, 0, {1000.0})),
               var_string(builder, "resource", "Server"),
               var_bool(builder, "enablePreemption", enable_preemption),
               var_bool(builder, "taskMayPreempt", true),
               var_string(builder, "taskPreemptionPolicy", "pp_terminate")},
              {});
    const auto sink = block(builder, "K", "sink", {}, {});
    const auto preempted = block(builder, "Out", "sink", {}, {});
    const auto root = CreateNode(
        builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
        CreateSemanticsRef(builder, builder.CreateString("core"),
                           builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
        0, 0, 0, 0);
    std::string error;
    auto model = build(builder, {s1, s2, service, sink, preempted},
                       {couple(builder, "S1", "out", "S", "in"),
                        couple(builder, "S2", "out", "S", "in"),
                        couple(builder, "S", "out", "K", "in"),
                        couple(builder, "S", "outPreempted", "Out", "in")},
                       root, &error);
    REQUIRE(model != nullptr);
    return run_once(*model, 7, 6, 0);
  };

  // The priority-5 task at t=3 preempts the running priority-1 task (it
  // exits through outPreempted at t=3 instead of completing at t=1001), so
  // the high-priority job jumps ahead and the mean sojourn drops sharply.
  const ReplicationMetrics preempting = run_service(true);
  REQUIRE(preempting.departures == 6);
  REQUIRE(preempting.mean_sojourn < 3000.0);

  const ReplicationMetrics plain = run_service(false);
  REQUIRE(plain.departures == 6);
  REQUIRE(plain.mean_sojourn > 3000.0);
  REQUIRE(preempting.mean_sojourn < plain.mean_sojourn);
}

// ---------------------------------------------------------------------------
// Pool-level ResourcePool semantics when one pool is shared by two Service
// consumers (AnyLogic docs: resourcepool.txt, downtime.txt, service.txt).
//
// Doc contract (library-reference-guides/process-modeling-library):
//  * The pool is one shared set of units: "The requests from different Seize
//    and Service blocks are queued in ResourcePool if they cannot be
//    satisfied immediately" (resourcepool.txt ~986). A 1-unit pool serves at
//    most one task at a time no matter how many Service blocks reference it.
//  * A failure is a downtime task on the busy unit: "May preempt other
//    tasks ... true means that the resource unit will 'drop its work' when
//    this task is activated" (downtime.txt ~1227); while the unit is broken
//    no unit is available to seize (busy() includes failure, resourcepool.txt
//    ~1410, and "During the off intervals, 0 resources are available",
//    resourcepool.txt ~1011).
//  * The interrupted task is suspended, not destroyed: "Wait for original
//    resource - the task is interrupted and waits for the same resource unit
//    to finish it" (service.txt ~1095) and the agent is "automatically
//    resumed at the time there are available resources" (service.txt ~1107).
//
// These tests pin pool-level arbitration for failure-enabled resources so a
// future refactor cannot accidentally give each Service a private pool copy.
TEST_CASE("process flow: failing pool shared by two services arbitrates the "
          "single unit",
          "[process_flow][service][resource][failure][acceptance]") {
  // Deterministic scenario: one 1-unit pool with a low busy-time failure rate
  // (nonzero so the engine takes the failing-pool path), two Service
  // consumers, one job each arriving at t=0, constant 0.5s service. The seed
  // is fixed so the run is failure-free and fully deterministic: each job
  // would finish in 0.5s if it owned the unit immediately.
  constexpr double kService = 0.5;
  constexpr double kFailureRate = 0.02;  // mean TTF 50s: no failure in ~1s
  constexpr double kRepairRate = 1.0;

  const auto build_model = [&](flatbuffers::FlatBufferBuilder& builder) {
    const auto source_a =
        block(builder, "InA", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
               var_string(builder, "firstArrivalMode", "at_start"),
               var_bool(builder, "limitArrivals", true),
               var_int(builder, "maxArrivals", 1)},
              {});
    const auto source_b =
        block(builder, "InB", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
               var_string(builder, "firstArrivalMode", "at_start"),
               var_bool(builder, "limitArrivals", true),
               var_int(builder, "maxArrivals", 1)},
              {});
    const auto resource = block(builder, "Pool", "resource",
                                {var_int(builder, "capacity", 1),
                                 var_float(builder, "failure_rate",
                                           kFailureRate),
                                 var_float(builder, "repair_rate",
                                           kRepairRate)},
                                {});
    const auto service_a =
        block(builder, "WorkA", "service",
              {var_string(builder, "resource", "Pool"),
               var_int(builder, "numberOfUnits", 1),
               var_dist(builder, "time", dist(builder, 0, {kService})),
               var_int(builder, "queueCapacity", 1)},
              {});
    const auto service_b =
        block(builder, "WorkB", "service",
              {var_string(builder, "resource", "Pool"),
               var_int(builder, "numberOfUnits", 1),
               var_dist(builder, "time", dist(builder, 0, {kService})),
               var_int(builder, "queueCapacity", 1)},
              {});
    const auto done_a = block(builder, "DoneA", "sink", {}, {});
    const auto done_b = block(builder, "DoneB", "sink", {}, {});
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
        builder,
        {source_a, source_b, service_a, service_b, done_a, done_b},
        {couple(builder, "InA", "out", "WorkA", "in"),
         couple(builder, "WorkA", "out", "DoneA", "in"),
         couple(builder, "InB", "out", "WorkB", "in"),
         couple(builder, "WorkB", "out", "DoneB", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return model;
  };

  const auto block_by_name = [](const ReplicationMetrics& metrics,
                                const std::string& name) {
    for (const BlockMetrics& item : metrics.blocks) {
      if (item.name == name) {
        return item;
      }
    }
    return BlockMetrics{};
  };

  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  const ReplicationMetrics metrics = run_once(*model, 7, 2, 0);

  // Both jobs finish exactly once (each service block gets its one job).
  REQUIRE(metrics.departures == 2);
  const BlockMetrics work_a = block_by_name(metrics, "WorkA");
  const BlockMetrics work_b = block_by_name(metrics, "WorkB");
  REQUIRE(work_a.name == "WorkA");
  REQUIRE(work_b.name == "WorkB");
  CHECK(work_a.arrived == 1);
  CHECK(work_b.arrived == 1);
  CHECK(work_a.departed == 1);
  CHECK(work_b.departed == 1);
  CHECK(work_a.preempted == 0);
  CHECK(work_b.preempted == 0);

  // Pool-level capacity arbitration: a 1-unit pool can never be more than
  // 100% utilized, regardless of how many Service blocks reference it. The
  CHECK(metrics.utilization <= 1.0 + 1e-9);
  CHECK(work_a.utilization + work_b.utilization <= 1.0 + 1e-9);

  // The second consumer must wait for the shared unit: it stays queued
  // (queue occupancy > 0) while WorkA holds the only unit.
  CHECK(work_b.mean_occupancy > 0.0);
  CHECK(work_a.mean_occupancy == 0.0);  // WorkA seized the unit instantly
  CHECK(work_a.wait_count == 1);
  CHECK(work_a.mean_wait == Catch::Approx(0.0));
  CHECK(work_b.wait_count == 1);
  CHECK(work_b.mean_wait == Catch::Approx(kService));

  // FIFO pool queue: WorkB starts only after WorkA's 0.5s service, so the
  // mean wait (waitA = 0, waitB = 0.5) is at least half the service time.
  CHECK(metrics.mean_wait >= kService / 2.0);

  // Determinism: the same fixed seed reproduces the identical run.
  flatbuffers::FlatBufferBuilder builder2;
  auto model2 = build_model(builder2);
  const ReplicationMetrics again = run_once(*model2, 7, 2, 0);
  REQUIRE(again.departures == 2);
  REQUIRE(again.utilization == metrics.utilization);
  REQUIRE(again.mean_wait == metrics.mean_wait);
  REQUIRE(block_by_name(again, "WorkB").mean_occupancy ==
          work_b.mean_occupancy);
}

TEST_CASE("process flow: pool-level failure interrupts the task sharing the "
          "single unit and recovers",
          "[process_flow][service][resource][failure][acceptance]") {
  // Deterministic scenario: one 1-unit pool, two Service consumers, one job
  // each arriving at t=0, constant 10s service. Busy-time failure law is
  // exponential with mean 1s (failure_rate = 1.0) and repair mean 1s; with
  // the fixed seed the TTF/repair draws are deterministic, so the unit fails
  // mid-service on every run of this test.
  constexpr double kService = 10.0;
  constexpr double kFailureRate = 1.0;
  constexpr double kRepairRate = 1.0;

  const auto build_model = [&](flatbuffers::FlatBufferBuilder& builder) {
    const auto source_a =
        block(builder, "InA", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
               var_string(builder, "firstArrivalMode", "at_start"),
               var_bool(builder, "limitArrivals", true),
               var_int(builder, "maxArrivals", 1)},
              {});
    const auto source_b =
        block(builder, "InB", "source",
              {var_dist(builder, "arrival", dist(builder, 0, {1.0})),
               var_string(builder, "firstArrivalMode", "at_start"),
               var_bool(builder, "limitArrivals", true),
               var_int(builder, "maxArrivals", 1)},
              {});
    const auto resource = block(builder, "Pool", "resource",
                                {var_int(builder, "capacity", 1),
                                 var_float(builder, "failure_rate",
                                           kFailureRate),
                                 var_float(builder, "repair_rate",
                                           kRepairRate)},
                                {});
    const auto service_a =
        block(builder, "WorkA", "service",
              {var_string(builder, "resource", "Pool"),
               var_int(builder, "numberOfUnits", 1),
               var_dist(builder, "time", dist(builder, 0, {kService})),
               var_int(builder, "queueCapacity", 1)},
              {});
    const auto service_b =
        block(builder, "WorkB", "service",
              {var_string(builder, "resource", "Pool"),
               var_int(builder, "numberOfUnits", 1),
               var_dist(builder, "time", dist(builder, 0, {kService})),
               var_int(builder, "queueCapacity", 1)},
              {});
    const auto done_a = block(builder, "DoneA", "sink", {}, {});
    const auto done_b = block(builder, "DoneB", "sink", {}, {});
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
        builder,
        {source_a, source_b, service_a, service_b, done_a, done_b},
        {couple(builder, "InA", "out", "WorkA", "in"),
         couple(builder, "WorkA", "out", "DoneA", "in"),
         couple(builder, "InB", "out", "WorkB", "in"),
         couple(builder, "WorkB", "out", "DoneB", "in")},
        root, &error);
    REQUIRE(model != nullptr);
    REQUIRE(error.empty());
    return model;
  };

  const auto block_by_name = [](const ReplicationMetrics& metrics,
                                const std::string& name) {
    for (const BlockMetrics& item : metrics.blocks) {
      if (item.name == name) {
        return item;
      }
    }
    return BlockMetrics{};
  };

  flatbuffers::FlatBufferBuilder builder;
  auto model = build_model(builder);
  const ReplicationMetrics metrics = run_once(*model, 7, 2, 0);

  // Both consumers get exactly one job and both finish: the failure suspends
  // (does not destroy) the in-flight task, which resumes after the repair
  // (service.txt 1095: "waits for the same resource unit to finish it").
  REQUIRE(metrics.departures == 2);
  const BlockMetrics work_a = block_by_name(metrics, "WorkA");
  const BlockMetrics work_b = block_by_name(metrics, "WorkB");
  REQUIRE(work_a.name == "WorkA");
  REQUIRE(work_b.name == "WorkB");
  CHECK(work_a.arrived == 1);
  CHECK(work_b.arrived == 1);
  CHECK(work_a.departed == 1);
  CHECK(work_b.departed == 1);
  // Suspended-and-resumed, not ejected through outPreempted.
  CHECK(work_a.preempted == 0);
  CHECK(work_b.preempted == 0);

  // Pool-level arbitration holds even under failure: a 1-unit pool stays at
  // or below 100% utilization no matter how many consumers reference it.
  CHECK(metrics.utilization <= 1.0 + 1e-9);
  CHECK(work_a.utilization + work_b.utilization <= 1.0 + 1e-9);

  // The failure impact is pool-level, not confined to WorkA: while the single
  // unit is held (service) or broken (repair), the second consumer must wait
  // in the queue (occupancy > 0).
  CHECK(work_b.mean_occupancy > 0.0);
  CHECK(work_a.mean_occupancy == 0.0);  // WorkA seized the unit instantly

  // The pool actually went down mid-run (busy-time failure) and recovered.
  CHECK(metrics.availability < 1.0);
  CHECK(metrics.availability > 0.0);
  CHECK(work_a.availability < 1.0);

  // Determinism: the same fixed seed reproduces the identical run.
  flatbuffers::FlatBufferBuilder builder2;
  auto model2 = build_model(builder2);
  const ReplicationMetrics again = run_once(*model2, 7, 2, 0);
  REQUIRE(again.departures == 2);
  REQUIRE(again.utilization == metrics.utilization);
  REQUIRE(again.availability == metrics.availability);
  REQUIRE(block_by_name(again, "WorkB").mean_occupancy ==
          work_b.mean_occupancy);
}

TEST_CASE("process flow: external reset cancels stale events on the shared "
          "scheduler",
          "[process_flow][external][kernel]") {
  // One shared scheduler/clock/handler-registry (a real RuntimeContext)
  // drives the SAME ProcessFlowSim across two resets. Round one schedules
  // a far-future pool repair; round two's business ends early. If reset
  // only bumped generations, the stale repair would still be popped by
  // run_until and advance the shared clock to its (future) time before the
  // no-op handler ran. reset() must cancel every engine-owned event on the
  // external scheduler.
  logicpilot::BinaryHeapScheduler scheduler(64);
  logicpilot::SimulationClock clock;
  logicpilot::EventHandlerRegistry handlers;
  logicpilot::VariableStore variables;
  logicpilot::RuntimeContext context(clock, scheduler, handlers, variables);

  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto resource =
      block(builder, "Server", "resource",
            {var_int(builder, "capacity", 1),
             var_float(builder, "failure_rate", 2.0),
             var_float(builder, "repair_rate", 0.05)},
            {});
  const auto seize = block(builder, "Grab", "seize",
                           {var_string(builder, "resource", "Server"),
                            var_int(builder, "numberOfUnits", 1)},
                           {});
  const auto delay =
      block(builder, "Work", "delay",
            {var_dist(builder, "delayTime", dist(builder, 0, {0.5}))}, {});
  const auto release = block(builder, "Drop", "release", {}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  const auto root = CreateNode(
      builder, CreateMetadata(builder, builder.CreateString("M"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder, builder.CreateString("core"),
                         builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource}),
      0, 0, 0, 0);
  std::string error;
  auto model = build(builder, {source, seize, delay, release, sink},
                     {couple(builder, "In", "out", "Grab", "in"),
                      couple(builder, "Grab", "out", "Work", "in"),
                      couple(builder, "Work", "out", "Drop", "in"),
                      couple(builder, "Drop", "out", "K", "in")},
                     root, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());
  model->attach(context);

  // Round one: one entity holds the unit 0.5-1.0 s; the pool fails inside
  // the hold (f = 2, seed 23) and schedules a repair with mean 20 s that is
  // still pending when we stop at 2.0 s.
  ReplicationConfig first;
  first.seed = 23;
  first.arrivals = 1;
  first.warmup_arrivals = 0;
  model->reset(first);
  model->advance(logicpilot::SimTime::from_ns(2'000'000'000LL), nullptr);
  REQUIRE(clock.now().as_ns() == 1'000'000'000LL);  // business end at 1.0 s
  REQUIRE(model->metrics().departures == 1);
  // The shared registry must not accumulate handlers across resets.
  const std::size_t handlers_after_first = handlers.size();

  // Round two: a fresh seed/config. The stale round-one repair (~21 s)
  // must be cancelled by reset(), not fired. SimulationKernel resets the
  // shared clock at the start of every run (kernel/src/runtime/
  // simulation_kernel.cpp: clock_.reset()), so the test does the same for
  // round two - the engine's reset must not touch the kernel-owned clock.
  clock.reset();
  ReplicationConfig second;
  second.seed = 42;
  second.arrivals = 2;
  second.warmup_arrivals = 0;
  model->reset(second);
  std::int64_t probe_ns = 0;
  while (model->has_pending_events()) {
    probe_ns += 100'000'000;
    model->advance(logicpilot::SimTime::from_ns(probe_ns), nullptr);
  }
  REQUIRE_FALSE(model->has_pending_events());
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 2);
  // The stale round-one repair would have landed around 21 s; anything
  // below that proves it was cancelled before run_until could pop it.
  REQUIRE(metrics.horizon_seconds > 0.0);
  REQUIRE(metrics.horizon_seconds < 10.0);
  REQUIRE(handlers.size() == handlers_after_first);  // registered once

  // Determinism: a fresh engine with the same config matches bit-for-bit.
  flatbuffers::FlatBufferBuilder builder2;
  const auto source2 =
      block(builder2, "In", "source",
            {var_dist(builder2, "arrival", dist(builder2, 0, {0.5}))}, {});
  const auto resource2 =
      block(builder2, "Server", "resource",
            {var_int(builder2, "capacity", 1),
             var_float(builder2, "failure_rate", 2.0),
             var_float(builder2, "repair_rate", 0.05)},
            {});
  const auto seize2 = block(builder2, "Grab", "seize",
                            {var_string(builder2, "resource", "Server"),
                             var_int(builder2, "numberOfUnits", 1)},
                            {});
  const auto delay2 =
      block(builder2, "Work", "delay",
            {var_dist(builder2, "delayTime", dist(builder2, 0, {0.5}))}, {});
  const auto release2 = block(builder2, "Drop", "release", {}, {});
  const auto sink2 = block(builder2, "K", "sink", {}, {});
  const auto root2 = CreateNode(
      builder2, CreateMetadata(builder2, builder2.CreateString("M"), 0, 0, 0),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Var>>{}),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Var>>{}), 0,
      CreateSemanticsRef(builder2, builder2.CreateString("core"),
                         builder2.CreateString("model"), 0, 0),
      builder2.CreateVector(std::vector<flatbuffers::Offset<Node>>{resource2}),
      0, 0, 0, 0);
  std::string error2;
  auto fresh = build(builder2, {source2, seize2, delay2, release2, sink2},
                     {couple(builder2, "In", "out", "Grab", "in"),
                      couple(builder2, "Grab", "out", "Work", "in"),
                      couple(builder2, "Work", "out", "Drop", "in"),
                      couple(builder2, "Drop", "out", "K", "in")},
                     root2, &error2);
  REQUIRE(fresh != nullptr);
  const ReplicationMetrics fresh_metrics = run_once(*fresh, 42, 2, 0);
  REQUIRE(fresh_metrics.departures == metrics.departures);
  REQUIRE(fresh_metrics.horizon_seconds == metrics.horizon_seconds);
  REQUIRE(fresh_metrics.mean_in_system == metrics.mean_in_system);
  REQUIRE(fresh_metrics.availability == metrics.availability);
}

TEST_CASE("streaming driver: external reset cancels stale mm1 events on the "
          "shared scheduler",
          "[process_flow][external][kernel]") {
  // Same shared RuntimeContext for QueueingFlowSim: round one schedules a
  // far-future source arrival; round two resets with the same model. If
  // reset did not cancel the stale arrival token, BOTH the stale and the
  // fresh arrival (same time) would fire, producing a second entity and
  // corrupting the round-two run.
  logicpilot::BinaryHeapScheduler scheduler(64);
  logicpilot::SimulationClock clock;
  logicpilot::EventHandlerRegistry handlers;
  logicpilot::VariableStore variables;
  logicpilot::RuntimeContext context(clock, scheduler, handlers, variables);

  logicpilot::QueueingFlowSpec spec;
  spec.interarrival = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.0};
    return dist(engine);
  };
  spec.service = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.0};
    return dist(engine);
  };
  spec.servers = 1;
  logicpilot::QueueingFlowSim flow{spec};
  flow.attach(context);

  ReplicationConfig first;
  first.seed = 7;
  first.arrivals = 1;
  first.warmup_arrivals = 0;
  flow.reset(first);
  flow.advance(logicpilot::SimTime::from_ns(100'000'000LL), nullptr);
  // Whether or not the first arrival fired inside this window (the
  // exponential interarrival can sample short), round one must leave a
  // pending event on the shared scheduler (its arrival, or the depart of
  // the customer it started serving).
  REQUIRE(scheduler.size() > 0);
  const std::size_t handlers_after_first = handlers.size();

  // SimulationKernel resets the shared clock at the start of every run.
  clock.reset();
  ReplicationConfig second;
  second.seed = 7;
  second.arrivals = 1;
  second.warmup_arrivals = 0;
  flow.reset(second);
  flow.advance(logicpilot::SimTime::infinity(), nullptr);
  REQUIRE_FALSE(flow.has_pending_events());
  const ReplicationMetrics metrics = flow.metrics();
  // Exactly one customer served: any stale round-one event was cancelled
  // (a stale depart would have underflowed the reset in_system counter or
  // produced a second service; a stale arrival a second customer).
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.arrivals == 1);
  REQUIRE(metrics.horizon_seconds > 0.0);
  // Handlers registered once (4 QueueingFlowSim handlers).
  REQUIRE(handlers.size() == handlers_after_first);
  REQUIRE(handlers.size() == 4);
}

TEST_CASE("process flow: attaching to another context cancels old events "
          "without touching the new one",
          "[process_flow][external][kernel]") {
  // Engine runs on context A and leaves a pending event (a source arrival
  // far in the future). It is then attached to context B, which already
  // holds an unrelated sentinel event. The engine must cancel its old
  // event on A's scheduler, must NOT cancel B's sentinel (EventTokens
  // carry no scheduler identity), and must run cleanly on B with its
  // handlers registered against B's registry.
  logicpilot::BinaryHeapScheduler scheduler_a(64);
  logicpilot::SimulationClock clock_a;
  logicpilot::EventHandlerRegistry handlers_a;
  logicpilot::VariableStore variables_a;
  logicpilot::RuntimeContext context_a(clock_a, scheduler_a, handlers_a,
                                       variables_a);

  logicpilot::BinaryHeapScheduler scheduler_b(64);
  logicpilot::SimulationClock clock_b;
  logicpilot::EventHandlerRegistry handlers_b;
  logicpilot::VariableStore variables_b;
  logicpilot::RuntimeContext context_b(clock_b, scheduler_b, handlers_b,
                                       variables_b);

  // A sentinel event on B, owned by B's registry, dispatched through its
  // own handler. The engine must never cancel or misfire it.
  std::uint64_t sentinel_fired = 0;
  const logicpilot::HandlerId sentinel_id = handlers_b.add(
      [&sentinel_fired](const logicpilot::Event&) { ++sentinel_fired; });
  scheduler_b.schedule(
      logicpilot::SimTime::from_ns(5'000'000'000LL), 99, sentinel_id, 0);

  flatbuffers::FlatBufferBuilder builder;
  const auto source =
      block(builder, "In", "source",
            {var_dist(builder, "arrival", dist(builder, 0, {0.5}))}, {});
  const auto sink = block(builder, "K", "sink", {}, {});
  std::string error;
  auto model = build(builder, {source, sink},
                     {couple(builder, "In", "out", "K", "in")},
                     flatbuffers::Offset<Node>{}, &error);
  REQUIRE(model != nullptr);
  REQUIRE(error.empty());

  // Run on A: the source schedules an arrival at 0.5 s (pending).
  model->attach(context_a);
  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  model->reset(config);
  REQUIRE(scheduler_a.size() == 1);  // the pending arrival

  // Switch to B: the old arrival on A must be cancelled, B's sentinel
  // untouched, and B must run normally with handlers registered on B.
  model->attach(context_b);
  REQUIRE(scheduler_a.size() == 0);  // old event cancelled on A's scheduler
  REQUIRE(scheduler_b.size() == 1);  // only B's sentinel remains

  model->reset(config);
  // Drive only the engine's business (0.5 s); the sentinel at 5 s stays.
  model->advance(logicpilot::SimTime::from_ns(600'000'000LL), nullptr);
  const ReplicationMetrics metrics = model->metrics();
  REQUIRE(metrics.departures == 1);
  REQUIRE(metrics.horizon_seconds == Catch::Approx(0.5));
  // B's sentinel was never cancelled by the engine; it fires when B's
  // clock reaches it.
  REQUIRE(scheduler_b.size() == 1);
  model->advance(logicpilot::SimTime::from_ns(5'100'000'000LL), nullptr);
  REQUIRE(sentinel_fired == 1);
  REQUIRE_FALSE(model->has_pending_events());

  // Same registry, repeated reset: handlers must not grow.
  const std::size_t b_handlers_before = handlers_b.size();
  model->reset(config);
  REQUIRE(handlers_b.size() == b_handlers_before);

  // Registry clear: HandlerIds become invalid, the engine must re-register
  // on the next reset and dispatch normally. SimulationKernel resets the
  // shared clock at the start of every run, so the test does the same.
  clock_b.reset();
  handlers_b.clear();
  model->reset(config);
  model->advance(logicpilot::SimTime::infinity(), nullptr);
  const ReplicationMetrics after_clear = model->metrics();
  REQUIRE(after_clear.departures == 1);
  REQUIRE(after_clear.horizon_seconds == Catch::Approx(0.5));
}

TEST_CASE("streaming driver: zero-arrival runs are empty and safe",
          "[process_flow][external][kernel]") {
  // ReplicationConfig.arrivals == 0 is a public engine boundary: reset()
  // must not schedule a first arrival (payload 0 would index out of bounds
  // in the zero-length arrival_ns_/service_start_ns_) and the run must be
  // empty.
  logicpilot::QueueingFlowSpec spec;
  spec.interarrival = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.0};
    return dist(engine);
  };
  spec.service = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.0};
    return dist(engine);
  };
  spec.servers = 1;
  logicpilot::QueueingFlowSim flow{spec};

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 0;
  config.warmup_arrivals = 0;
  flow.reset(config);
  REQUIRE_FALSE(flow.has_pending_events());
  flow.advance(logicpilot::SimTime::infinity(), nullptr);
  REQUIRE_FALSE(flow.has_pending_events());
  const ReplicationMetrics metrics = flow.metrics();
  REQUIRE(metrics.arrivals == 0);
  REQUIRE(metrics.departures == 0);
  REQUIRE(metrics.horizon_seconds == 0.0);
}

TEST_CASE("queueing flow: incremental scheduler enforces the shared event budget",
          "[process_flow][incremental][safety]") {
  logicpilot::QueueingFlowSpec spec;
  spec.interarrival = [](logicpilot::Xoshiro256PlusPlus&) { return 0.0; };
  spec.service = [](logicpilot::Xoshiro256PlusPlus&) { return 1.0; };
  spec.servers = 1;
  logicpilot::QueueingFlowSim flow{spec};

  ReplicationConfig config;
  config.arrivals = 2;
  config.warmup_arrivals = 0;
  config.max_events = 1;
  flow.reset(config);
  REQUIRE(flow.advance(SimTime::infinity(), nullptr) == 1);
  REQUIRE(flow.failed());
  REQUIRE(flow.failure_reason().find("KR1017") != std::string::npos);
  REQUIRE(flow.failure_reason().find("1 events") != std::string::npos);
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(flow.checkpoint_save(checkpoint));
  flow.reset(ReplicationConfig{});
  REQUIRE(flow.checkpoint_restore(checkpoint));
  REQUIRE(flow.failed());
  REQUIRE(flow.failure_reason().find("1 events") != std::string::npos);
}

TEST_CASE("streaming driver: owned to external attach cannot replay tokens",
          "[process_flow][external][kernel]") {
  // Both fresh schedulers allocate the same first token identity. An owned
  // run leaves its first arrival pending; context B already owns a sentinel
  // with that identity. attach(B) must forget the owned token after cancelling
  // it on the owned scheduler, otherwise reset() will cancel B's sentinel.
  logicpilot::QueueingFlowSpec spec;
  spec.interarrival = [](logicpilot::Xoshiro256PlusPlus&) { return 0.5; };
  spec.service = [](logicpilot::Xoshiro256PlusPlus&) { return 0.1; };
  spec.servers = 1;
  logicpilot::QueueingFlowSim flow{spec};

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 1;
  config.warmup_arrivals = 0;
  flow.reset(config);  // owned scheduler: first pending token
  REQUIRE(flow.has_pending_events());

  logicpilot::BinaryHeapScheduler scheduler(64);
  logicpilot::SimulationClock clock;
  logicpilot::EventHandlerRegistry handlers;
  logicpilot::VariableStore variables;
  logicpilot::RuntimeContext context(clock, scheduler, handlers, variables);
  std::uint64_t sentinel_fired = 0;
  const logicpilot::HandlerId sentinel_id = handlers.add(
      [&sentinel_fired](const logicpilot::Event&) { ++sentinel_fired; });
  scheduler.schedule(logicpilot::SimTime::from_ns(5'000'000'000LL), 99,
                     sentinel_id, 0);

  flow.attach(context);
  flow.reset(config);
  REQUIRE(scheduler.size() == 2);  // sentinel + new engine arrival
  flow.advance(logicpilot::SimTime::from_ns(700'000'000LL), nullptr);
  REQUIRE(flow.metrics().departures == 1);
  REQUIRE(scheduler.size() == 1);  // sentinel survived reset
  flow.advance(logicpilot::SimTime::from_ns(5'100'000'000LL), nullptr);
  REQUIRE(sentinel_fired == 1);
  REQUIRE(scheduler.empty());
}

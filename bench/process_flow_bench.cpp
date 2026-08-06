// Generic process-flow engine benchmark (performance budget #2 extension):
// ProcessFlowSim (source -> delay -> sink through the modular block engine).
// SetItemsProcessed counts dispatched events (arrivals + departures), so
// items_per_second reports events/s directly.
#include <benchmark/benchmark.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/devs/replication.h"
#include "process_flow.h"

namespace {

namespace v2 = logicpilot::ir::v2;

flatbuffers::Offset<v2::Distribution> dist(flatbuffers::FlatBufferBuilder& b,
                                           std::uint8_t kind,
                                           std::vector<double> params) {
  return v2::CreateDistribution(b, kind, b.CreateVector(params));
}

flatbuffers::Offset<v2::Var> var_dist(flatbuffers::FlatBufferBuilder& b,
                                      const char* name,
                                      flatbuffers::Offset<v2::Distribution> d) {
  return v2::CreateVar(b, b.CreateString(name), v2::VarType_Distribution,
                       false, 0, 0.0, 0, d);
}

flatbuffers::Offset<v2::Var> var_int(flatbuffers::FlatBufferBuilder& b,
                                     const char* name, std::int64_t value) {
  return v2::CreateVar(b, b.CreateString(name), v2::VarType_Int, false, value,
                       0.0, 0, 0);
}

flatbuffers::Offset<v2::Node> block(flatbuffers::FlatBufferBuilder& b,
                                    const char* name, const char* kind,
                                    std::vector<flatbuffers::Offset<v2::Var>> params) {
  return v2::CreateNode(
      b, v2::CreateMetadata(b, b.CreateString(name), 0, 0, 0),
      b.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      b.CreateVector(params), 0,
      v2::CreateSemanticsRef(b, b.CreateString("process"),
                             b.CreateString(kind), 0, 0),
      0, 0, 0, 0, 0);
}

struct FlowFixture {
  flatbuffers::FlatBufferBuilder builder;
  std::vector<const v2::Node*> stages;
  std::vector<const v2::Coupling*> couplings;
  const v2::Node* root{nullptr};
  std::string error;

  FlowFixture() {
    const auto source = block(
        builder, "In", "source",
        {var_dist(builder, "arrival", dist(builder, 4, {0.8}))});
    const auto delay = block(
        builder, "D", "delay",
        {var_dist(builder, "delayTime", dist(builder, 0, {0.5})),
         var_int(builder, "capacity", -1)});
    const auto sink = block(builder, "K", "sink", {});

    const auto port_out = builder.CreateString("out");
    const auto port_in = builder.CreateString("in");
    const auto in_name = builder.CreateString("In");
    const auto d_name = builder.CreateString("D");
    const auto k_name = builder.CreateString("K");
    const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                            flatbuffers::Offset<flatbuffers::String> to) {
      return v2::CreateCoupling(builder, from, port_out, to, port_in);
    };
    const auto root_offset = v2::CreateNode(
        builder,
        v2::CreateMetadata(builder, builder.CreateString("Bench"), 0, 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
        v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                               builder.CreateString("model"), 0, 0),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{
            source, delay, sink}),
        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Coupling>>{
            couple(in_name, d_name), couple(d_name, k_name)}),
        0, 0, 0);
    builder.Finish(v2::CreateModelFile(builder, 2, root_offset, 0, 0),
                   "LP2R");
    for (const flatbuffers::Offset<v2::Node>& offset :
         std::vector<flatbuffers::Offset<v2::Node>>{source, delay, sink}) {
      stages.push_back(flatbuffers::GetTemporaryPointer(builder, offset));
    }
    root = flatbuffers::GetTemporaryPointer(builder, root_offset);
  }
};

}  // namespace

static void BM_ProcessFlow(benchmark::State& state) {
  FlowFixture fixture;
  auto model = std::make_unique<logicpilot::ProcessFlowSim>(
      fixture.stages, fixture.couplings, fixture.root, &fixture.error);
  if (model == nullptr || !fixture.error.empty()) {
    state.SkipWithError(fixture.error.c_str());
    return;
  }
  const auto arrivals = static_cast<std::uint64_t>(state.range(0));
  logicpilot::ReplicationConfig config;
  config.seed = 42;
  config.arrivals = arrivals;
  config.warmup_arrivals = arrivals / 10;

  std::uint64_t events_per_iteration = 0;
  for (auto _ : state) {
    const logicpilot::ReplicationMetrics metrics = model->run(config, nullptr);
    events_per_iteration = metrics.arrivals + metrics.departures;
    benchmark::DoNotOptimize(metrics);
  }
  state.SetItemsProcessed(static_cast<std::int64_t>(
      events_per_iteration * static_cast<std::uint64_t>(state.iterations())));
}

BENCHMARK(BM_ProcessFlow)->Arg(10000)->Arg(100000)->Unit(benchmark::kMillisecond);

// MM1-style end-to-end event loop benchmark - performance budget #2
// (docs/performance-budget.md): DSL model -> kernel execution steady state.
// Phase 1b acceptance bar: >= 1,000,000 events/s single-threaded.
//
// Each benchmark iteration runs one full M/M/1 replication (arrivals +
// services through the binary-heap scheduler); SetItemsProcessed counts the
// dispatched events, so items_per_second reports events/s directly.
#include <benchmark/benchmark.h>

#include <cstdint>

#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

static void BM_Mm1EventLoop(benchmark::State& state) {
  using namespace logicpilot;

  const auto arrivals = static_cast<std::uint64_t>(state.range(0));
  Mm1Simulator simulator{Mm1Params{0.8, 1.0}};
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = arrivals;
  config.warmup_arrivals = arrivals / 10;

  std::uint64_t events_per_iteration = 0;
  for (auto _ : state) {
    ReplicationMetrics metrics = simulator.run(config, nullptr);
    events_per_iteration = metrics.arrivals + metrics.departures;
    benchmark::DoNotOptimize(metrics);
  }
  state.SetItemsProcessed(static_cast<std::int64_t>(
      events_per_iteration * static_cast<std::uint64_t>(state.iterations())));
}
// Small runs expose setup overhead; large runs measure steady state.
BENCHMARK(BM_Mm1EventLoop)->Arg(10000)->Arg(100000)->Unit(benchmark::kMillisecond);

// main() comes from benchmark::benchmark_main (see kernel/CMakeLists.txt).

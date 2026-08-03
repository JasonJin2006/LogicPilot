// RNG throughput benchmarks: raw xoshiro256++ draws, uniform doubles, and
// distribution sampling costs (Normal / Poisson) relative to the raw stream.
#include <benchmark/benchmark.h>

#include <cstdint>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"

static void BM_Xoshiro256pp_Next(benchmark::State& state) {
  logicpilot::Xoshiro256PlusPlus rng{0xC0FFEE};
  std::uint64_t sink = 0;
  for (auto _ : state) {
    sink += rng.next();
    benchmark::DoNotOptimize(sink);
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_Xoshiro256pp_Next);

static void BM_Xoshiro256pp_UniformDouble(benchmark::State& state) {
  logicpilot::Xoshiro256PlusPlus rng{0xC0FFEE};
  double sink = 0.0;
  for (auto _ : state) {
    sink += rng.next_double();
    benchmark::DoNotOptimize(sink);
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_Xoshiro256pp_UniformDouble);

static void BM_NormalSample(benchmark::State& state) {
  logicpilot::Xoshiro256PlusPlus rng{0xC0FFEE};
  logicpilot::Normal<logicpilot::Xoshiro256PlusPlus> dist{0.0, 1.0};
  double sink = 0.0;
  for (auto _ : state) {
    sink += dist(rng);
    benchmark::DoNotOptimize(sink);
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_NormalSample);

static void BM_ExponentialSample(benchmark::State& state) {
  logicpilot::Xoshiro256PlusPlus rng{0xC0FFEE};
  logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.5};
  double sink = 0.0;
  for (auto _ : state) {
    sink += dist(rng);
    benchmark::DoNotOptimize(sink);
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_ExponentialSample);

static void BM_PoissonSample(benchmark::State& state) {
  logicpilot::Xoshiro256PlusPlus rng{0xC0FFEE};
  logicpilot::Poisson<logicpilot::Xoshiro256PlusPlus> dist{
      static_cast<double>(state.range(0))};
  std::uint64_t sink = 0;
  for (auto _ : state) {
    sink += static_cast<std::uint64_t>(dist(rng));
    benchmark::DoNotOptimize(sink);
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_PoissonSample)->Arg(4)->Arg(120);

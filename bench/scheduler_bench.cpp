// Scheduler throughput benchmarks - performance budget #1
// (docs/performance-budget.md): schedule + pop ops, MVP baseline
// >= 1,000,000 ops/s, production target >= 10,000,000 ops/s.
//
// Each iteration performs one schedule and one pop against a queue held at a
// realistic steady-state depth, with pseudo-random timestamp deltas so the
// heap does real ordering work. SetItemsProcessed counts both operations, so
// google/benchmark's items_per_second reports ops/s directly.
#include <benchmark/benchmark.h>

#include <cstdint>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/sim_time.h"

namespace {

// Deterministic LCG keeps the benchmark reproducible without paying RNG cost.
struct CheapLcg {
  std::uint64_t state{0x2545F4914F6CDD1DULL};
  std::uint64_t next() {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return state >> 33;
  }
};

}  // namespace

// Sustained mixed workload at a fixed queue depth.
static void BM_SchedulerSchedulePop(benchmark::State& state) {
  using namespace logicpilot;

  const auto depth = static_cast<std::size_t>(state.range(0));
  BinaryHeapScheduler sched;
  sched.reserve(depth + 64);

  CheapLcg lcg;
  SimTime t = SimTime::zero();
  for (std::size_t i = 0; i < depth; ++i) {
    t += SimTime::from_ns(static_cast<std::int64_t>(lcg.next() % 1000));
    sched.schedule(t, 0, 0, i);
  }

  std::uint64_t sink = 0;
  for (auto _ : state) {
    t += SimTime::from_ns(static_cast<std::int64_t>(lcg.next() % 1000));
    const EventToken token = sched.schedule(t, 0, 0, sink);
    Event e = sched.pop_next();
    sink += e.payload + token.generation;
    benchmark::DoNotOptimize(sink);
  }
  // One schedule + one pop per iteration = 2 ops.
  state.SetItemsProcessed(static_cast<std::int64_t>(state.iterations()) * 2);
}
BENCHMARK(BM_SchedulerSchedulePop)->Arg(256)->Arg(1024)->Arg(4096);

// Burst: schedule a batch, then drain it (worst case for sift-down).
static void BM_SchedulerBurstDrain(benchmark::State& state) {
  using namespace logicpilot;

  const auto batch = static_cast<std::size_t>(state.range(0));
  BinaryHeapScheduler sched;
  sched.reserve(batch);
  CheapLcg lcg;

  for (auto _ : state) {
    state.PauseTiming();
    SimTime t = SimTime::zero();
    for (std::size_t i = 0; i < batch; ++i) {
      t += SimTime::from_ns(static_cast<std::int64_t>(lcg.next() % 1000));
      sched.schedule(t, 0, 0, i);
    }
    state.ResumeTiming();

    Event e{};
    while (sched.try_pop_next(e)) {
      benchmark::DoNotOptimize(e);
    }
  }
  state.SetItemsProcessed(static_cast<std::int64_t>(state.iterations()) *
                          static_cast<std::int64_t>(batch) * 2);
}
BENCHMARK(BM_SchedulerBurstDrain)->Arg(1024)->Arg(16384);

// Cancellation-heavy workload: schedule, cancel half, drain the survivors.
static void BM_SchedulerCancel(benchmark::State& state) {
  using namespace logicpilot;

  constexpr std::size_t kBatch = 1024;
  BinaryHeapScheduler sched;
  sched.reserve(kBatch);
  CheapLcg lcg;

  for (auto _ : state) {
    state.PauseTiming();
    SimTime t = SimTime::zero();
    EventToken tokens[kBatch];
    for (std::size_t i = 0; i < kBatch; ++i) {
      t += SimTime::from_ns(static_cast<std::int64_t>(lcg.next() % 1000));
      tokens[i] = sched.schedule(t, 0, 0, i);
    }
    state.ResumeTiming();

    std::uint64_t cancelled = 0;
    for (std::size_t i = 0; i < kBatch; i += 2) {
      cancelled += sched.cancel(tokens[i]) ? 1 : 0;
    }
    Event e{};
    while (sched.try_pop_next(e)) {
      benchmark::DoNotOptimize(e);
    }
    benchmark::DoNotOptimize(cancelled);
  }
  // Per batch: 1024 schedules + 512 cancels + 1024 pops/cleanups.
  state.SetItemsProcessed(static_cast<std::int64_t>(state.iterations()) *
                          static_cast<std::int64_t>(kBatch * 2 + kBatch / 2));
}
BENCHMARK(BM_SchedulerCancel);

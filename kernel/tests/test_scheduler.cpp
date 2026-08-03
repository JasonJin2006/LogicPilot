// Scheduler tests: ordering, FIFO tie-break, lazy cancellation, peek/size,
// handler dispatch, run_until clock advancement, zero-allocation hot path.
#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <iterator>
#include <vector>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"

using namespace logicpilot;

TEST_CASE("Events pop in timestamp order", "[scheduler]") {
  BinaryHeapScheduler sched;
  const SimTime times[] = {5_ms, 1_ms, 9_ms, 3_ms, 7_ms, 2_ms, 8_ms, 4_ms, 6_ms};
  for (SimTime t : times) {
    sched.schedule(t, /*type=*/0, /*handler=*/0, static_cast<std::uint64_t>(t.as_ns()));
  }
  REQUIRE(sched.size() == std::size(times));

  SimTime last = SimTime::zero();
  std::size_t popped = 0;
  Event e{};
  while (sched.try_pop_next(e)) {
    REQUIRE(e.at >= last);
    last = e.at;
    ++popped;
  }
  CHECK(popped == std::size(times));
  CHECK(sched.empty());
}

TEST_CASE("Equal timestamps deliver FIFO by arrival order", "[scheduler]") {
  BinaryHeapScheduler sched;
  for (std::uint64_t i = 0; i < 64; ++i) {
    sched.schedule(1_s, /*type=*/0, /*handler=*/0, i);
  }
  for (std::uint64_t i = 0; i < 64; ++i) {
    const Event e = sched.pop_next();
    CHECK(e.at == 1_s);
    CHECK(e.payload == i);
  }
}

TEST_CASE("Reverse-sorted insertion stays sorted", "[scheduler]") {
  BinaryHeapScheduler sched;
  for (int i = 1000; i > 0; --i) {
    sched.schedule(SimTime::from_ns(i), 0, 0, static_cast<std::uint64_t>(i));
  }
  std::int64_t expected = 1;
  Event e{};
  while (sched.try_pop_next(e)) {
    CHECK(e.at.as_ns() == expected);
    ++expected;
  }
  CHECK(expected == 1001);
}

TEST_CASE("cancel() lazily removes events", "[scheduler]") {
  BinaryHeapScheduler sched;
  const EventToken t1 = sched.schedule(1_ms, 0, 0, 1);
  const EventToken t2 = sched.schedule(2_ms, 0, 0, 2);
  const EventToken t3 = sched.schedule(3_ms, 0, 0, 3);

  // Cancel the earliest: peek must skip it.
  CHECK(sched.cancel(t1));
  CHECK(sched.size() == 2);
  CHECK(sched.peek_time() == 2_ms);

  // Cancel the middle.
  CHECK(sched.cancel(t2));
  CHECK(sched.size() == 1);

  // Only t3 survives the drain.
  const Event e = sched.pop_next();
  CHECK(e.payload == 3);
  CHECK(sched.empty());

  // Tokens of popped / cancelled events are dead.
  CHECK_FALSE(sched.cancel(t1));
  CHECK_FALSE(sched.cancel(t2));
  CHECK_FALSE(sched.cancel(t3));
  CHECK_FALSE(sched.cancel(EventToken{}));
}

TEST_CASE("Stale tokens cannot cancel recycled slots", "[scheduler]") {
  BinaryHeapScheduler sched;
  const EventToken stale = sched.schedule(1_ms, 0, 0, 100);
  CHECK(sched.cancel(stale));

  // Drain the (dead) entry and re-schedule; the slab may hand back the same
  // slot, but the generation counter must invalidate the old token.
  Event e{};
  while (sched.try_pop_next(e)) {
  }
  const EventToken fresh = sched.schedule(2_ms, 0, 0, 200);
  CHECK(fresh.id == stale.id);          // slot recycled...
  CHECK(fresh.generation != stale.generation);  // ...with a new generation
  CHECK_FALSE(sched.cancel(stale));     // stale handle is inert
  CHECK(sched.cancel(fresh));
}

TEST_CASE("peek_time reports infinity on an empty queue", "[scheduler]") {
  BinaryHeapScheduler sched;
  CHECK(sched.peek_time() == SimTime::infinity());
  CHECK(sched.peek_time().is_infinity());

  sched.schedule(42_ns, 0, 0, 0);
  CHECK(sched.peek_time() == 42_ns);

  Event e{};
  CHECK(sched.try_pop_next(e));
  CHECK(sched.peek_time() == SimTime::infinity());
  CHECK_THROWS_AS(sched.pop_next(), std::logic_error);
}

TEST_CASE("Handler registry dispatches by indexed handler id", "[scheduler]") {
  EventHandlerRegistry registry;
  std::vector<std::uint64_t> seen_a;
  std::vector<std::uint64_t> seen_b;
  const HandlerId a = registry.add([&](const Event& e) { seen_a.push_back(e.payload); });
  const HandlerId b = registry.add([&](const Event& e) { seen_b.push_back(e.payload); });

  BinaryHeapScheduler sched;
  sched.schedule(1_ms, 0, a, 11);
  sched.schedule(2_ms, 0, b, 22);
  sched.schedule(3_ms, 0, a, 33);

  SimulationClock clock;
  const std::size_t n = run_until(sched, clock, SimTime::infinity(),
                                  [&](const Event& e) { registry.dispatch(e); });

  CHECK(n == 3);
  CHECK(seen_a == std::vector<std::uint64_t>{11, 33});
  CHECK(seen_b == std::vector<std::uint64_t>{22});
}

TEST_CASE("run_until advances the clock event-by-event", "[scheduler]") {
  BinaryHeapScheduler sched;
  sched.schedule(30_ms, 0, 0, 0);
  sched.schedule(10_ms, 0, 0, 0);
  sched.schedule(20_ms, 0, 0, 0);
  sched.schedule(50_ms, 0, 0, 0);  // beyond horizon: must stay queued

  SimulationClock clock;
  std::vector<std::int64_t> observed;
  const std::size_t n = run_until(sched, clock, 40_ms, [&](const Event& e) {
    observed.push_back(clock.now().as_ns());
    // The clock must be exactly at the event timestamp during dispatch and
    // never move backwards.
    CHECK(clock.now() == e.at);
  });

  CHECK(n == 3);
  CHECK(observed == std::vector<std::int64_t>{10'000'000, 20'000'000, 30'000'000});
  CHECK(clock.now() == 30_ms);
  CHECK(sched.size() == 1);
  CHECK(sched.peek_time() == 50_ms);
}

TEST_CASE("Hot path performs zero pool allocations after reserve()",
          "[scheduler][alloc]") {
  constexpr std::size_t kDepth = 1024;
  BinaryHeapScheduler sched;
  sched.reserve(kDepth + 16);
  const std::size_t chunks_before = sched.pool_chunks();
  CHECK(chunks_before >= 1);

  // Pre-fill to the steady-state depth, then churn 200k interleaved
  // schedule/pop pairs with random-ish timestamps.
  std::uint64_t lcg = 0x2545F4914F6CDD1DULL;
  auto next_rand = [&] {
    lcg = lcg * 6364136223846793005ULL + 1442695040888963407ULL;
    return lcg >> 33;
  };
  SimTime t = SimTime::zero();
  for (std::size_t i = 0; i < kDepth; ++i) {
    t += SimTime::from_ns(static_cast<std::int64_t>(next_rand() % 1000));
    sched.schedule(t, 0, 0, 0);
  }
  Event e{};
  for (std::size_t i = 0; i < 200'000; ++i) {
    t += SimTime::from_ns(static_cast<std::int64_t>(next_rand() % 1000));
    sched.schedule(t, 0, 0, i);
    CHECK(sched.try_pop_next(e));
  }

  // Slab watermark untouched: every slot came from the pre-provisioned pool.
  CHECK(sched.pool_chunks() == chunks_before);
  CHECK(sched.size() == kDepth);
}

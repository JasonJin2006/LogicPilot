// Performance baseline gate (budget #2 MVP: >= 500k events/s end-to-end;
// the Phase 1b acceptance bar for this task is the MM1-style loop at
// >= 1,000,000 events/s single-threaded). Runs in Release; CTest-registered
// so regressions fail the build instead of silently landing.
#include <chrono>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;

TEST_CASE("MM1-style event loop sustains >= 1M events/s single-threaded",
          "[perf][mm1]") {
  constexpr std::uint64_t kArrivals = 200000;  // ~400k events

  Mm1Simulator simulator{Mm1Params{0.8, 1.0}};
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = kArrivals;
  config.warmup_arrivals = 2000;

  const auto start = std::chrono::steady_clock::now();
  const ReplicationMetrics metrics = simulator.run(config, nullptr);
  const auto stop = std::chrono::steady_clock::now();

  const double seconds =
      std::chrono::duration<double>(stop - start).count();
  const double events = static_cast<double>(metrics.arrivals +
                                            metrics.departures);
  const double events_per_second = events / seconds;
  INFO("events=" << events << " in " << seconds << "s -> "
                 << events_per_second << " events/s");
  REQUIRE(events_per_second >= 1'000'000.0);
}

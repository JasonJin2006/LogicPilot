// Time subsystem tests: SimTime literals/arithmetic, SimulationClock
// monotonic next-event advancement. (The ODE integrator lives in
// kernel/src/devs/continuous.cpp and is covered by test_continuous.cpp.)
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"

using namespace logicpilot;

TEST_CASE("SimTime literals express exact nanosecond counts", "[time]") {
  CHECK((45_ns).as_ns() == 45);
  CHECK((3_us).as_ns() == 3'000);
  CHECK((2_ms).as_ns() == 2'000'000);
  CHECK((1_s).as_ns() == 1'000'000'000);
  CHECK((1_s + 2_ms + 3_us + 45_ns).as_ns() == 1'002'003'045);
  CHECK((1_s).as_seconds() == 1.0);
  CHECK((500_ms).as_seconds() == 0.5);
}

TEST_CASE("SimTime ordering and arithmetic are exact", "[time]") {
  CHECK(999_ns < 1_us);
  CHECK(1_s > 999'999'999_ns);
  CHECK(1_s == 1'000_ms);
  CHECK((5_s - 2_s).as_ns() == 3'000'000'000LL);
  CHECK(SimTime::zero() == SimTime{});
  CHECK(SimTime::infinity() > 1'000'000_s);
  CHECK(SimTime::infinity().is_infinity());
}

TEST_CASE("SimulationClock advances monotonically", "[time]") {
  SimulationClock clock;
  CHECK(clock.now() == SimTime::zero());

  clock.advance_to(10_ms);
  CHECK(clock.now() == 10_ms);

  // Equal-time advance is a legal no-op (simultaneous events).
  clock.advance_to(10_ms);
  CHECK(clock.now() == 10_ms);

  clock.advance_by(5_ms);
  CHECK(clock.now() == 15_ms);

  CHECK_THROWS_AS(clock.advance_to(14_ms), std::logic_error);
  CHECK_THROWS_AS(clock.advance_by(-1_ns), std::logic_error);

  clock.reset();
  CHECK(clock.now() == SimTime::zero());
}

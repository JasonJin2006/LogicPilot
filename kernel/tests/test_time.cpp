// Time subsystem tests: SimTime literals/arithmetic, SimulationClock
// monotonic next-event advancement, Euler/RK4 integrator accuracy.
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include <cmath>
#include <vector>

#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/integrator.h"
#include "logicpilot/core/time/sim_time.h"
#include "tolerances.h"

using namespace logicpilot;
using Catch::Matchers::WithinAbs;

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

namespace {

// dy/dt = y, y(0) = 1  ->  y(t) = e^t
DerivativeFn exponential_growth() {
  return [](double, std::span<const double> y, std::span<double> dy) {
    dy[0] = y[0];
  };
}

// Harmonic oscillator: x' = v, v' = -x. Energy x^2 + v^2 is conserved.
DerivativeFn harmonic_oscillator() {
  return [](double, std::span<const double> y, std::span<double> dy) {
    dy[0] = y[1];
    dy[1] = -y[0];
  };
}

constexpr double kPi = 3.14159265358979323846;

}  // namespace

TEST_CASE("Euler and RK4 are deterministic fixed-step integrators", "[time]") {
  auto run = [](IIntegrator& integrator) {
    std::vector<double> y{1.0};
    integrator.integrate(0.0, 1.0, 100, std::span<double>{y},
                         exponential_growth());
    return y[0];
  };

  EulerIntegrator euler;
  RungeKutta4Integrator rk4;

  const double euler_a = run(euler);
  const double euler_b = run(euler);
  const double rk4_a = run(rk4);
  const double rk4_b = run(rk4);

  // Same inputs -> bit-identical outputs.
  CHECK(euler_a == euler_b);
  CHECK(rk4_a == rk4_b);
}

TEST_CASE("Integrator accuracy against the analytic solution", "[time]") {
  const double exact = std::exp(1.0);

  EulerIntegrator euler;
  std::vector<double> ye{1.0};
  euler.integrate(0.0, 1.0, 100, std::span<double>{ye}, exponential_growth());
  CHECK_THAT(ye[0], WithinAbs(exact, test::kEulerMaxAbsError));

  RungeKutta4Integrator rk4;
  std::vector<double> yr{1.0};
  rk4.integrate(0.0, 1.0, 100, std::span<double>{yr}, exponential_growth());
  CHECK_THAT(yr[0], WithinAbs(exact, test::kRk4MaxAbsError));

  // RK4 must be orders of magnitude better than Euler at the same step size.
  CHECK(std::abs(yr[0] - exact) < std::abs(ye[0] - exact) / 1000.0);
}

TEST_CASE("RK4 conserves harmonic oscillator energy", "[time]") {
  RungeKutta4Integrator rk4;
  std::vector<double> y{1.0, 0.0};  // x = 1, v = 0
  const double period = 2.0 * kPi;
  rk4.integrate(0.0, period, 1000, std::span<double>{y}, harmonic_oscillator());

  // After one full period the state returns to (1, 0) and energy to 1.
  CHECK_THAT(y[0], WithinAbs(1.0, test::kOscillatorEnergyDrift));
  CHECK_THAT(y[1], WithinAbs(0.0, test::kOscillatorEnergyDrift));
  const double energy = y[0] * y[0] + y[1] * y[1];
  CHECK_THAT(energy, WithinAbs(1.0, test::kOscillatorEnergyDrift));
}

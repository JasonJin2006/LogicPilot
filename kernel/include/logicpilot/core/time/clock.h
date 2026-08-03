// SimulationClock - next-event discrete time driver.
//
// The clock never ticks on a wall-clock basis: it only jumps forward to the
// timestamp of the next scheduled event (classic next-event DES advancement).
// Monotonicity is enforced - any attempt to move time backwards is a logic
// error and throws.
#pragma once

#include <stdexcept>

#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

class SimulationClock {
 public:
  constexpr SimulationClock() = default;
  explicit constexpr SimulationClock(SimTime start) : now_{start} {}

  [[nodiscard]] constexpr SimTime now() const { return now_; }

  // Advance the clock to `t`. Must be >= now(); equality is a no-op.
  constexpr void advance_to(SimTime t) {
    if (t < now_) {
      throw std::logic_error("SimulationClock: time must not move backwards");
    }
    now_ = t;
  }

  // Advance relative to the current instant.
  constexpr void advance_by(SimTime delta) {
    if (delta < SimTime::zero()) {
      throw std::logic_error("SimulationClock: negative delta");
    }
    now_ = now_ + delta;
  }

  // Reset for run reuse (e.g. deterministic replay from t0).
  constexpr void reset(SimTime start = SimTime::zero()) { now_ = start; }

 private:
  SimTime now_{};
};

}  // namespace logicpilot

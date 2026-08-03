// run_until - next-event simulation driver.
//
// Pops events in timestamp order, advancing the SimulationClock to each
// event's delivery time (never between events). Stops when the queue is
// drained or the next live event lies beyond `horizon` (it stays queued).
// Returns the number of events dispatched.
#pragma once

#include <cstddef>

#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/time/clock.h"

namespace logicpilot {

template <typename Dispatch>
std::size_t run_until(IEventScheduler& scheduler, SimulationClock& clock,
                      SimTime horizon, Dispatch&& dispatch) {
  std::size_t dispatched = 0;
  Event event{};
  for (;;) {
    const SimTime next = scheduler.peek_time();
    if (next > horizon) {
      break;
    }
    if (!scheduler.try_pop_next(event)) {
      break;
    }
    clock.advance_to(event.at);
    dispatch(event);
    ++dispatched;
  }
  return dispatched;
}

}  // namespace logicpilot

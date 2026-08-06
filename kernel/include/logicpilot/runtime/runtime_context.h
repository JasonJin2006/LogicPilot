// RuntimeContext - the facilities the kernel hands to method runtimes.
//
// The kernel is the simulation world: time, events, scheduling, lifecycle
// and shared state. A method runtime receives these via RuntimeContext at
// initialize() and drives its own behavior through them, so Process/Agent/
// SystemDynamics runtimes stay interchangeable plugins.
#pragma once

#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/state/variable_store.h"

namespace logicpilot {

class RuntimeContext {
 public:
  RuntimeContext(SimulationClock& clock, IEventScheduler& scheduler,
                 VariableStore& variables)
      : clock_(clock), scheduler_(scheduler), variables_(variables) {}

  [[nodiscard]] SimulationClock& clock() const { return clock_; }
  [[nodiscard]] IEventScheduler& scheduler() const { return scheduler_; }
  [[nodiscard]] VariableStore& variables() const { return variables_; }

 private:
  SimulationClock& clock_;
  IEventScheduler& scheduler_;
  VariableStore& variables_;
};

}  // namespace logicpilot

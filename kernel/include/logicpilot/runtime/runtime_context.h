// RuntimeContext - the facilities the kernel hands to method runtimes.
//
// The kernel is the simulation world: time, events, scheduling, lifecycle
// and shared state. A method runtime receives these via RuntimeContext at
// initialize() and drives its own behavior through them, so Process/Agent/
// SystemDynamics runtimes stay interchangeable plugins.
#pragma once

#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/state/variable_store.h"

namespace logicpilot {

class RuntimeContext {
 public:
  RuntimeContext(SimulationClock& clock, IEventScheduler& scheduler,
                 EventHandlerRegistry& handlers,
                 VariableStore& variables,
                 const ReplicationConfig& config = ReplicationConfig{})
      : clock_(clock),
        scheduler_(scheduler),
        handlers_(handlers),
        variables_(variables),
        config_(config) {}

  [[nodiscard]] SimulationClock& clock() const { return clock_; }
  [[nodiscard]] IEventScheduler& scheduler() const { return scheduler_; }
  // Kernel-level event dispatch table: method runtimes register their
  // handlers here so one shared scheduler can route events across methods.
  [[nodiscard]] EventHandlerRegistry& handlers() const { return handlers_; }
  [[nodiscard]] VariableStore& variables() const { return variables_; }
  // Replication parameters for this run (seed / arrivals / warmup), set by
  // the driver (SimulationKernel) or the RuntimeManager constructor.
  [[nodiscard]] const ReplicationConfig& config() const { return config_; }

 private:
  SimulationClock& clock_;
  IEventScheduler& scheduler_;
  EventHandlerRegistry& handlers_;
  VariableStore& variables_;
  ReplicationConfig config_;
};

}  // namespace logicpilot

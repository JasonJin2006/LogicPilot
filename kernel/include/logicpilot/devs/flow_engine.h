// Shared incremental-flow contract for the process method engines.
//
// ProcessFlowSim (generic DSL flows) and QueueingFlowSim (M/M/c fast path)
// both implement this interface; the ProcessRuntime drives them without
// knowing the concrete engine type (no dynamic_cast).
#pragma once

#include <cstddef>

#include "logicpilot/devs/replication.h"

namespace logicpilot {

class RuntimeContext;

class FlowEngine : public ReplicationModel {
 public:
  ~FlowEngine() override = default;

  // Method Runtime Layer (Phase 3) lifecycle: reset() prepares one
  // replication, advance(until) dispatches events with timestamp <= until,
  // metrics() reports the accumulated statistics, attach() switches the
  // engine to kernel-owned facilities (shared clock/scheduler/handlers).
  virtual void reset(const ReplicationConfig& config) = 0;
  virtual std::size_t advance(SimTime until, TraceRecorder* trace) = 0;
  [[nodiscard]] virtual ReplicationMetrics metrics() const = 0;
  virtual void attach(RuntimeContext& context) = 0;
};

}  // namespace logicpilot

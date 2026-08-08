// Shared incremental-flow contract for the process method engines.
//
// ProcessFlowSim (generic DSL flows) and QueueingFlowSim (M/M/c fast path)
// both implement this interface; the ProcessRuntime drives them without
// knowing the concrete engine type (no dynamic_cast).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/devs/replication.h"

namespace logicpilot {

class RuntimeContext;

// Live per-block state for streaming process-flow telemetry. `buffered` is
// the block's waiting input size, `in_service` the occupied server/task
// slots; arrived/departed are cumulative so the client can animate tokens
// from the per-slice deltas.
struct BlockSnapshot {
  std::string name;
  std::string kind;
  std::int64_t buffered{0};
  std::int64_t in_service{0};
  std::uint64_t arrived{0};
  std::uint64_t departed{0};
};

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

  // Live telemetry for streamed runs (defaults keep non-flow engines on the
  // batch path).
  [[nodiscard]] virtual std::vector<BlockSnapshot> block_snapshots() const {
    return {};
  }
  [[nodiscard]] virtual bool has_pending_events() { return true; }
};

}  // namespace logicpilot

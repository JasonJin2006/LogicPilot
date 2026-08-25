// Shared incremental-flow contract for the process method engines.
//
// ProcessFlowSim (generic DSL flows) and QueueingFlowSim (M/M/c fast path)
// both implement this interface; the ProcessRuntime drives them without
// knowing the concrete engine type (no dynamic_cast).
#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

#include "logicpilot/runtime/replication.h"

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
  // Exact current simulation time in nanoseconds. The engine clock only
  // advances to real event times, never to slice boundaries, so final
  // telemetry frames must use this instead of converting
  // metrics().horizon_seconds back through double (which loses precision
  // and has range issues near the int64 limits).
  [[nodiscard]] virtual std::int64_t now_ns() const = 0;

  // Incremental runtimes expose scheduler-safety failures separately from
  // ordinary user cancellation. Older method engines keep these defaults;
  // event-driven flows override them for KR1017.
  [[nodiscard]] virtual bool failed() const { return false; }
  [[nodiscard]] virtual const std::string& failure_reason() const {
    static const std::string kNoFailure;
    return kNoFailure;
  }


  // Live telemetry for streamed runs (defaults keep non-flow engines on the
  // batch path).
  [[nodiscard]] virtual std::vector<BlockSnapshot> block_snapshots() const {
    return {};
  }
  [[nodiscard]] virtual bool has_pending_events() { return true; }

  // Optional versioned state bundle. Generic ProcessFlowSim remains
  // unsupported until entity/resource state is covered explicitly.
  [[nodiscard]] virtual bool checkpoint_save(
      std::vector<std::uint8_t>&) const { return false; }
  virtual bool checkpoint_restore(std::span<const std::uint8_t>) {
    return false;
  }
};

}  // namespace logicpilot

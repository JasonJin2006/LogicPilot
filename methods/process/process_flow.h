// Generic process-flow executor (AnyLogic PML semantics, event-driven),
// now part of the process method library (methods/process).
//
// Consumes a v2 process flow (stages + couplings from the model root or an
// agent body) and runs it with the kernel scheduler + xoshiro256++ (the
// same deterministic facilities as QueueingFlowSim). Blocks are modular
// ProcessBlock implementations (process_blocks.h); the engine only
// coordinates routing, scheduling and statistics.
//
// The engine is incremental since the Method Runtime Layer (Phase 3):
// reset() prepares one replication, advance(until) dispatches every event
// with timestamp <= until, metrics() reports the accumulated statistics.
// run() = reset() + advance(infinity) + metrics() and stays bit-identical
// to the legacy batch call.
//
// The specialized M/M/1 topology (single source/queue/service) keeps the
// QueueingFlowSim path for the theory acceptance suite; every other process
// flow uses this engine.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/replication.h"
#include "logicpilot/devs/flow_engine.h"

namespace logicpilot {
class RuntimeContext;
namespace ir::v2 {
struct Node;
struct Coupling;
}

class ProcessFlowSim : public FlowEngine {
 public:
  // `stages` are the flow's process-library block nodes and `couplings`
  // their connections (from the model root or an agent body); `root`
  // supplies the model-level process/resource nodes referenced by
  // service/seize/release.
  ProcessFlowSim(const std::vector<const ir::v2::Node*>& stages,
                 const std::vector<const ir::v2::Coupling*>& couplings,
                 const ir::v2::Node* root, std::string* error);
  ~ProcessFlowSim() override;

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  // Incremental execution (Method Runtime Layer, Phase 3).
  void reset(const ReplicationConfig& config);
  std::size_t advance(SimTime until, TraceRecorder* trace);
  [[nodiscard]] ReplicationMetrics metrics() const;

  // Kernel-driven mode (SimulationKernel driver): schedule into the kernel's
  // facilities instead of per-engine owned ones.
  void attach(RuntimeContext& context);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

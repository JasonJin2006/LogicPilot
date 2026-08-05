// Generic process-flow executor (AnyLogic PML semantics, event-driven).
//
// Consumes a v2 process flow (stages + couplings from the model root or an
// agent body) and runs it with the kernel scheduler + xoshiro256++ (the
// same deterministic facilities as QueueingFlowSim). Blocks register their
// behavior keyed by {library, block}: source / queue / delay / service /
// sink / split / selectOutput / count / hold / enter / exit have real
// semantics; the remaining PML blocks pass tokens through with their
// counters maintained (documented per block).
//
// The specialized M/M/1 topology (single source/queue/service) keeps the
// QueueingFlowSim path for the theory acceptance suite; every other process
// flow uses this engine.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/replication.h"

namespace logicpilot {
namespace ir::v2 {
struct Node;
struct Coupling;
}

class ProcessFlowSim : public ReplicationModel {
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

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

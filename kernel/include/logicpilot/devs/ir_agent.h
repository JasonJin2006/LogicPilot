// Executable interpretation of IR AgentModels (milestone 1c).
//
// v0.1 semantics: `count` agents (AgentModel.params), each with literal
// state variables (AgentModel.state) and on_tick behaviors that dispatch to
// a small kernel-built-in handler registry (must match the DSL semantic
// registry in dsl/compiler/src/semantic.cpp):
//   noop       - no-op
//   flip <var> - toggle the bool state variable <var> on every agent
//   bounce     - reflect positions into [0, 1]^2 after the kinematics update
// The tick loop is fixed-dt (1.0 s), bounded by ReplicationConfig.arrivals
// (the tick budget), fully deterministic (no RNG).
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/agent/components.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/replication.h"

namespace logicpilot {
namespace ir {
struct Model;
}  // namespace ir

// Per-agent model state attached as a cold EnTT component.
struct ModelAgentState {
  std::unordered_map<std::string, IrValue> values;
};

class AgentReplicationModel final : public ReplicationModel {
 public:
  AgentReplicationModel(std::vector<std::uint8_t> bytes,
                        const ir::Model* root);

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  // Final positions / state after the last run (test inspection).
  [[nodiscard]] std::size_t agent_count() const {
    return last_positions_.size();
  }
  [[nodiscard]] const std::vector<Position>& last_positions() const {
    return last_positions_;
  }
  [[nodiscard]] const ModelAgentState& agent_state(std::size_t index) const {
    return last_agents_state_.at(index);
  }

 private:
  std::vector<std::uint8_t> bytes_;
  const ir::Model* root_;
  std::vector<Position> last_positions_;
  std::vector<ModelAgentState> last_agents_state_;
};

}  // namespace logicpilot

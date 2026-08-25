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
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/agent/components.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/runtime/replication.h"

namespace logicpilot {
namespace ir::v2 {
struct Node;
}  // namespace ir::v2

// Per-agent model state attached as a cold EnTT component.
struct ModelAgentState {
  std::unordered_map<std::string, IrValue> values;
};

struct AgentSnapshot {
  std::uint64_t id{0};
  Position position{};
  AgentState state{};
};

class AgentReplicationModel final : public ReplicationModel {
public:
  AgentReplicationModel(std::vector<std::uint8_t> v2_bytes, const ir::v2::Node* v2_root);
  ~AgentReplicationModel() override;

  ReplicationMetrics run(const ReplicationConfig& config, TraceRecorder* trace) override;

  // Incremental lifecycle used by the shared SimulationKernel scheduler.
  // reset() creates the population, step() advances exactly one simulation
  // tick and returns false once the configured budget is exhausted.
  bool reset(const ReplicationConfig& config);
  bool step();
  [[nodiscard]] bool checkpoint_save(
      std::vector<std::uint8_t>& state) const;
  bool checkpoint_restore(std::span<const std::uint8_t> state);
  [[nodiscard]] bool done() const;
  [[nodiscard]] bool failed() const;
  [[nodiscard]] const std::string& failure_reason() const;
  [[nodiscard]] std::uint64_t tick_count() const;
  void snapshot_agents(std::vector<AgentSnapshot>& out) const;
  ReplicationMetrics finish(TraceRecorder* trace = nullptr);

  // Final positions / state after the last run (test inspection).
  [[nodiscard]] std::size_t agent_count() const { return last_positions_.size(); }
  [[nodiscard]] const std::vector<Position>& last_positions() const { return last_positions_; }
  [[nodiscard]] const ModelAgentState& agent_state(std::size_t index) const {
    return last_agents_state_.at(index);
  }

private:
  struct Session;
  std::vector<std::uint8_t> bytes_;
  const ir::v2::Node* v2_root_{nullptr};
  std::vector<Position> last_positions_;
  std::vector<ModelAgentState> last_agents_state_;
  std::unique_ptr<Session> session_;
  TraceRecorder* trace_{nullptr};
};

}  // namespace logicpilot

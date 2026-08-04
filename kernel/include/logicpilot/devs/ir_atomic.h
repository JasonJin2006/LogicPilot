// Executable interpretation of IR AtomicModels (milestone 1b).
//
// The IR carries the full DEVS atom description (state params, ta,
// TransitionSpec effects), so a generic interpreter can execute it on the
// DevsExecutor without generating code: state is a name->literal map, ta is
// constant / exponential (sampled once at construction, fixed seed =>
// deterministic) / infinite, delta_ext applies the trigger port's effects,
// delta_int applies its effects and stages the output port.
#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/atomic_model.h"
#include "logicpilot/devs/coupled_model.h"
#include "logicpilot/devs/replication.h"

namespace logicpilot {
namespace ir {
struct AtomicModel;
struct CoupledModel;
struct Model;
}  // namespace ir

// Runtime value of an IR atomic state variable.
using IrValue = std::variant<bool, std::int64_t, double>;

class IrAtomicModel final : public AtomicModel {
 public:
  explicit IrAtomicModel(const ir::AtomicModel& spec,
                         Xoshiro256PlusPlus& engine);

  SimTime time_advance() const override;
  void external_transition(SimTime now, PortId port,
                           std::uint64_t payload) override;
  void internal_transition(SimTime now) override;

  [[nodiscard]] std::optional<IrValue> state(const std::string& name) const;

 private:
  void apply_effects(
      const std::vector<std::pair<std::string, IrValue>>& effects);

  std::unordered_map<std::string, IrValue> state_;
  SimTime ta_{SimTime::infinity()};
  bool has_ext_{false};
  PortId ext_port_{0};
  std::vector<std::pair<std::string, IrValue>> ext_effects_;
  bool has_int_{false};
  std::vector<std::pair<std::string, IrValue>> int_effects_;
  bool emit_{false};
  PortId out_port_{0};
};

// Builds the executable atomic tree for DevsExecutor from an ir::CoupledModel
// whose children are AtomicModels (v1; mixed children return nullptr). Each
// atom samples distribution-based ta() from `engine` at construction.
std::unique_ptr<CoupledModel> build_atomic_tree(
    const ir::CoupledModel& spec, Xoshiro256PlusPlus& engine);

// ReplicationModel adapter that drives a generic DEVS atomic/coupled tree
// (from IR) through the DevsExecutor. ReplicationConfig.arrivals is the
// internal-transition budget, so perpetual emitters terminate
// deterministically. L/Lq/W/Wq are meaningless for generic atomics and stay 0;
// metrics.arrivals reports the internal firings and horizon the sim time.
class DevsReplicationModel final : public ReplicationModel {
 public:
  DevsReplicationModel(std::vector<std::uint8_t> bytes, const ir::Model* root);

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  // The most recently built atomic tree (for state inspection in tests).
  [[nodiscard]] const CoupledModel* last_tree() const { return last_tree_.get(); }

 private:
  std::vector<std::uint8_t> bytes_;
  const ir::Model* root_;
  std::unique_ptr<CoupledModel> last_tree_;
};

}  // namespace logicpilot

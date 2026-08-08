// IR atomic interpreter + DEVS replication adapter implementation.
#include "logicpilot/devs/ir_atomic.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <unordered_set>
#include <utility>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/executor.h"

#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

namespace v2 = logicpilot::ir::v2;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

std::optional<IrValue> v2_var_value(const v2::Var* var) {
  if (var == nullptr) {
    return std::nullopt;
  }
  switch (var->type()) {
    case v2::VarType_Bool:
      return IrValue{var->bool_value()};
    case v2::VarType_Int:
      return IrValue{var->int_value()};
    case v2::VarType_Float:
      return IrValue{var->float_value()};
    default:
      return std::nullopt;
  }
}

const char* v2_node_name(const v2::Node* node) {
  return node->metadata() != nullptr && node->metadata()->name() != nullptr
             ? node->metadata()->name()->c_str()
             : nullptr;
}

bool v2_node_is(const v2::Node* node, const char* block) {
  return node != nullptr && node->semantics() != nullptr && node->semantics()->block() != nullptr &&
         std::strcmp(node->semantics()->block()->c_str(), block) == 0;
}

}  // namespace

IrAtomicModelV2::IrAtomicModelV2(const v2::Node& spec, Xoshiro256PlusPlus& engine) {
  if (spec.ports() != nullptr) {
    for (const v2::Port* port : *spec.ports()) {
      if (port->name() != nullptr) {
        declare_port(port->name()->str());
      }
    }
  }
  if (spec.state() != nullptr) {
    for (const v2::Var* var : *spec.state()) {
      if (var->name() != nullptr) {
        if (const auto value = v2_var_value(var)) {
          state_.emplace(var->name()->str(), *value);
        }
      }
    }
  }
  if (spec.behavior() != nullptr && spec.behavior()->transitions() != nullptr) {
    for (const v2::Transition* transition : *spec.behavior()->transitions()) {
      if (transition->trigger() == v2::TriggerKind_Message &&
          transition->message_port() != nullptr) {
        has_ext_ = true;
        ext_port_ = resolve_port(transition->message_port()->str());
        if (transition->actions() != nullptr) {
          for (const v2::Action* action : *transition->actions()) {
            if (const auto value = v2_var_value(action->set_value())) {
              ext_effects_.emplace_back(action->set_value()->name()->str(), *value);
            }
          }
        }
      } else if (transition->trigger() == v2::TriggerKind_Timeout) {
        has_int_ = true;
        if (transition->actions() != nullptr) {
          for (const v2::Action* action : *transition->actions()) {
            if (action->emit_port() != nullptr) {
              emit_ = true;
              out_port_ = resolve_port(action->emit_port()->str());
            } else if (const auto value = v2_var_value(action->set_value())) {
              int_effects_.emplace_back(action->set_value()->name()->str(), *value);
            }
          }
        }
        if (transition->timeout_distribution() != nullptr) {
          const v2::Distribution* dist = transition->timeout_distribution();
          if (dist->params() != nullptr && dist->params()->size() > 0) {
            Exponential<Xoshiro256PlusPlus> sampler{dist->params()->Get(0)};
            ta_ = SimTime::from_ns(to_ns(sampler(engine)));
          }
        } else {
          ta_ = SimTime::from_ns(to_ns(transition->timeout_value()));
        }
      }
    }
  }
}

SimTime IrAtomicModelV2::time_advance() const {
  return ta_;
}

void IrAtomicModelV2::external_transition(SimTime, PortId port, std::uint64_t) {
  if (has_ext_ && port == ext_port_) {
    for (const auto& [name, value] : ext_effects_) {
      state_[name] = value;
    }
  }
}

void IrAtomicModelV2::internal_transition(SimTime) {
  if (has_int_) {
    for (const auto& [name, value] : int_effects_) {
      state_[name] = value;
    }
    if (emit_) {
      emit(out_port_);
    }
  }
}

std::optional<IrValue> IrAtomicModelV2::state(const std::string& name) const {
  const auto it = state_.find(name);
  if (it == state_.end()) {
    return std::nullopt;
  }
  return it->second;
}

std::unique_ptr<CoupledModel> build_atomic_tree_v2(const v2::Node& root,
                                                   Xoshiro256PlusPlus& engine) {
  auto tree = std::make_unique<CoupledModel>();
  const auto add_atom = [&](const v2::Node* node) {
    auto atom = std::make_unique<IrAtomicModelV2>(*node, engine);
    const char* name = v2_node_name(node);
    tree->add_atomic(name != nullptr ? name : "<unnamed>", std::move(atom));
  };

  if (v2_node_is(&root, "atomic")) {
    add_atom(&root);
  } else if (v2_node_is(&root, "model")) {
    if (root.children() == nullptr) {
      return nullptr;
    }
    std::unordered_set<std::string> atom_names;
    for (const v2::Node* child : *root.children()) {
      if (!v2_node_is(child, "atomic") || child->semantics() == nullptr ||
          child->semantics()->library() == nullptr ||
          child->semantics()->library()->str() != "devs") {
        continue;  // another method owns this child
      }
      add_atom(child);
      atom_names.insert(v2_node_name(child));
    }
    if (atom_names.empty()) {
      return nullptr;
    }
    if (root.couplings() != nullptr) {
      for (const v2::Coupling* coupling : *root.couplings()) {
        if (coupling->from_model() == nullptr || coupling->from_port() == nullptr ||
            coupling->to_model() == nullptr || coupling->to_port() == nullptr) {
          continue;
        }
        if (atom_names.count(coupling->from_model()->str()) == 0 ||
            atom_names.count(coupling->to_model()->str()) == 0) {
          continue;  // cross-method routing goes through the kernel bus
        }
        tree->couple(coupling->from_model()->str(), coupling->from_port()->str(),
                     coupling->to_model()->str(), coupling->to_port()->str());
      }
    }
  } else {
    return nullptr;
  }
  return tree;
}

DevsReplicationModel::DevsReplicationModel(std::vector<std::uint8_t> v2_bytes,
                                           const v2::Node* /*v2_root*/)
    : bytes_{std::move(v2_bytes)} {
  v2_root_ = ir::v2::GetModelFile(bytes_.data())->root();
}

ReplicationMetrics DevsReplicationModel::run(const ReplicationConfig& config,
                                             TraceRecorder* trace) {
  ReplicationMetrics metrics;
  metrics.arrivals = 0;

  Xoshiro256PlusPlus engine{config.seed};
  last_tree_ = build_atomic_tree_v2(*v2_root_, engine);
  if (last_tree_ == nullptr) {
    return metrics;
  }

  BinaryHeapScheduler scheduler{64};
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.set_internal_budget(config.arrivals);
  executor.load(*last_tree_);
  executor.run(SimTime::infinity());

  metrics.arrivals = executor.internal_transitions();
  const std::int64_t horizon_ns = clock.now().as_ns();
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(horizon_ns));
    trace->absorb(executor.internal_transitions());
  }
  return metrics;
}

}  // namespace logicpilot

// IR atomic interpreter + DEVS replication adapter implementation.
#include "logicpilot/devs/ir_atomic.h"

#include <cstdint>
#include <cstring>
#include <string>
#include <utility>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/executor.h"

#include "ir_generated.h"

namespace logicpilot {
namespace {

const char* ir_name(const ir::Metadata* metadata) {
  return metadata != nullptr && metadata->name() != nullptr
             ? metadata->name()->c_str()
             : nullptr;
}

// One ir::Param -> (name, runtime value). Unsupported value kinds (strings,
// distributions) are skipped.
std::optional<std::pair<std::string, IrValue>> param_to_value(
    const ir::Param* param) {
  if (param == nullptr || param->name() == nullptr) {
    return std::nullopt;
  }
  switch (param->value_type()) {
    case ir::ParamValue_BoolValue:
      return std::make_pair(param->name()->str(),
                            IrValue{param->value_as_BoolValue()->value()});
    case ir::ParamValue_IntValue:
      return std::make_pair(param->name()->str(),
                            IrValue{param->value_as_IntValue()->value()});
    case ir::ParamValue_FloatValue:
      return std::make_pair(param->name()->str(),
                            IrValue{param->value_as_FloatValue()->value()});
    default:
      return std::nullopt;
  }
}

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

IrAtomicModel::IrAtomicModel(const ir::AtomicModel& spec,
                             Xoshiro256PlusPlus& engine) {
  if (spec.input_ports() != nullptr) {
    for (const ir::Port* port : *spec.input_ports()) {
      if (port->name() != nullptr) {
        declare_port(port->name()->str());
      }
    }
  }
  if (spec.output_ports() != nullptr) {
    for (const ir::Port* port : *spec.output_ports()) {
      if (port->name() != nullptr) {
        declare_port(port->name()->str());
      }
    }
  }
  if (spec.state() != nullptr) {
    for (const ir::Param* param : *spec.state()) {
      if (const auto value = param_to_value(param)) {
        state_.insert(*value);
      }
    }
  }
  if (spec.ta() != nullptr) {
    switch (spec.ta()->kind()) {
      case ir::TimeAdvanceKind_Constant:
        ta_ = SimTime::from_ns(to_ns(spec.ta()->value()));
        break;
      case ir::TimeAdvanceKind_Distribution: {
        const ir::Distribution* dist = spec.ta()->distribution();
        if (dist != nullptr && dist->kind() == ir::DistributionKind_Exponential &&
            dist->params() != nullptr && dist->params()->size() > 0) {
          Exponential<Xoshiro256PlusPlus> sampler{dist->params()->Get(0)};
          ta_ = SimTime::from_ns(to_ns(sampler(engine)));
        }
        break;
      }
      default:
        break;  // Infinite (passive)
    }
  }
  if (spec.external_transition() != nullptr) {
    const ir::TransitionSpec* ext = spec.external_transition();
    if (ext->trigger_port() != nullptr) {
      has_ext_ = true;
      ext_port_ = resolve_port(ext->trigger_port()->str());
    }
    if (ext->effects() != nullptr) {
      for (const ir::Param* param : *ext->effects()) {
        if (const auto value = param_to_value(param)) {
          ext_effects_.push_back(*value);
        }
      }
    }
  }
  if (spec.internal_transition() != nullptr) {
    const ir::TransitionSpec* in = spec.internal_transition();
    has_int_ = true;
    if (in->output_port() != nullptr) {
      emit_ = true;
      out_port_ = resolve_port(in->output_port()->str());
    }
    if (in->effects() != nullptr) {
      for (const ir::Param* param : *in->effects()) {
        if (const auto value = param_to_value(param)) {
          int_effects_.push_back(*value);
        }
      }
    }
  }
}

SimTime IrAtomicModel::time_advance() const { return ta_; }

void IrAtomicModel::external_transition(SimTime, PortId port,
                                        std::uint64_t) {
  if (has_ext_ && port == ext_port_) {
    apply_effects(ext_effects_);
  }
}

void IrAtomicModel::internal_transition(SimTime) {
  if (has_int_) {
    apply_effects(int_effects_);
    if (emit_) {
      emit(out_port_);
    }
  }
}

std::optional<IrValue> IrAtomicModel::state(const std::string& name) const {
  const auto it = state_.find(name);
  if (it == state_.end()) {
    return std::nullopt;
  }
  return it->second;
}

void IrAtomicModel::apply_effects(
    const std::vector<std::pair<std::string, IrValue>>& effects) {
  for (const auto& [name, value] : effects) {
    state_[name] = value;
  }
}

std::unique_ptr<CoupledModel> build_atomic_tree(
    const ir::CoupledModel& spec, Xoshiro256PlusPlus& engine) {
  auto root = std::make_unique<CoupledModel>();
  if (spec.children() != nullptr) {
    for (const ir::Model* child : *spec.children()) {
      if (child->kind_type() != ir::ModelKind_AtomicModel) {
        return nullptr;  // mixed children are not executable in v1
      }
      const ir::AtomicModel* atomic = child->kind_as_AtomicModel();
      auto atom = std::make_unique<IrAtomicModel>(*atomic, engine);
      const char* name = ir_name(atomic->metadata());
      root->add_atomic(name != nullptr ? name : "<unnamed>", std::move(atom));
    }
  }
  if (spec.couplings() != nullptr) {
    for (const ir::Coupling* coupling : *spec.couplings()) {
      if (coupling->from_model() != nullptr &&
          coupling->from_port() != nullptr &&
          coupling->to_model() != nullptr &&
          coupling->to_port() != nullptr) {
        root->couple(coupling->from_model()->str(),
                     coupling->from_port()->str(),
                     coupling->to_model()->str(),
                     coupling->to_port()->str());
      }
    }
  }
  return root;
}

DevsReplicationModel::DevsReplicationModel(std::vector<std::uint8_t> bytes,
                                           const ir::Model* root)
    : bytes_{std::move(bytes)}, root_{root} {}

ReplicationMetrics DevsReplicationModel::run(const ReplicationConfig& config,
                                             TraceRecorder* trace) {
  ReplicationMetrics metrics;
  metrics.arrivals = 0;

  Xoshiro256PlusPlus engine{config.seed};
  if (root_->kind_type() == ir::ModelKind_AtomicModel) {
    auto root = std::make_unique<CoupledModel>();
    auto atom = std::make_unique<IrAtomicModel>(*root_->kind_as_AtomicModel(),
                                                engine);
    root->add_atomic("root", std::move(atom));
    last_tree_ = std::move(root);
  } else if (root_->kind_type() == ir::ModelKind_CoupledModel) {
    last_tree_ = build_atomic_tree(*root_->kind_as_CoupledModel(), engine);
  }
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

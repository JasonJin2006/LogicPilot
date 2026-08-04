// IR agent runtime: AgentReplicationModel tick loop (see ir_agent.h).
#include "logicpilot/devs/ir_agent.h"

#include <cmath>
#include <string>
#include <utility>

#include "logicpilot/agent/agent_runtime.h"

#include "ir_generated.h"

namespace logicpilot {
namespace {

constexpr float kDt = 1.0F;  // fixed sim-time per tick (v0.1)

const char* ir_name(const ir::Metadata* metadata) {
  return metadata != nullptr && metadata->name() != nullptr
             ? metadata->name()->c_str()
             : nullptr;
}

std::optional<IrValue> param_value(const ir::Param* param) {
  if (param == nullptr || param->name() == nullptr) {
    return std::nullopt;
  }
  switch (param->value_type()) {
    case ir::ParamValue_BoolValue:
      return IrValue{param->value_as_BoolValue()->value()};
    case ir::ParamValue_IntValue:
      return IrValue{param->value_as_IntValue()->value()};
    case ir::ParamValue_FloatValue:
      return IrValue{param->value_as_FloatValue()->value()};
    default:
      return std::nullopt;
  }
}

std::int64_t count_param(const ir::AgentModel* spec) {
  if (spec->params() != nullptr) {
    for (const ir::Param* param : *spec->params()) {
      if (param->name() != nullptr && param->name()->str() == "count" &&
          param->value_type() == ir::ParamValue_IntValue) {
        return param->value_as_IntValue()->value();
      }
    }
  }
  return 1;
}

}  // namespace

AgentReplicationModel::AgentReplicationModel(std::vector<std::uint8_t> bytes,
                                             const ir::Model* root)
    : bytes_{std::move(bytes)}, root_{root} {}

ReplicationMetrics AgentReplicationModel::run(const ReplicationConfig& config,
                                              TraceRecorder* trace) {
  ReplicationMetrics metrics;
  metrics.arrivals = 0;

  const ir::AgentModel* spec = nullptr;
  if (root_->kind_type() == ir::ModelKind_AgentModel) {
    spec = root_->kind_as_AgentModel();
  } else if (root_->kind_type() == ir::ModelKind_CoupledModel) {
    const ir::CoupledModel* coupled = root_->kind_as_CoupledModel();
    if (coupled->children() != nullptr) {
      for (const ir::Model* child : *coupled->children()) {
        if (child->kind_type() == ir::ModelKind_AgentModel) {
          spec = child->kind_as_AgentModel();
          break;
        }
      }
    }
  }
  if (spec == nullptr) {
    return metrics;
  }

  struct Behavior {
    std::string handler;
    std::string arg;
  };
  std::vector<Behavior> behaviors;
  if (spec->behaviors() != nullptr) {
    for (const ir::Behavior* behavior : *spec->behaviors()) {
      if (behavior->trigger() == nullptr ||
          behavior->trigger()->str() != "on_tick" ||
          behavior->handler_ref() == nullptr) {
        continue;
      }
      Behavior b;
      b.handler = behavior->handler_ref()->str();
      if (behavior->params() != nullptr && behavior->params()->size() > 0 &&
          behavior->params()->Get(0)->name() != nullptr) {
        b.arg = behavior->params()->Get(0)->name()->str();
      }
      behaviors.push_back(std::move(b));
    }
  }
  const bool bounce = [&] {
    for (const Behavior& b : behaviors) {
      if (b.handler == "bounce") {
        return true;
      }
    }
    return false;
  }();

  const std::int64_t count = count_param(spec);
  AgentRuntime runtime;
  std::vector<entt::entity> entities;
  entities.reserve(count);
  last_positions_.clear();
  last_agents_state_.clear();
  for (std::int64_t i = 0; i < count; ++i) {
    const float x = (static_cast<float>(i) + 0.5F) /
                    static_cast<float>(count);
    const float angle = static_cast<float>(i + 1) * 0.7F;
    const Position position{x, 0.5F};
    const Velocity velocity{0.1F * std::cos(angle), 0.1F * std::sin(angle)};
    const AgentHandle handle = runtime.create_agent(
        position, velocity, AgentState{AgentState::kActiveBit});
    ModelAgentState state;
    if (spec->state() != nullptr) {
      for (const ir::Param* param : *spec->state()) {
        if (const auto value = param_value(param)) {
          state.values.emplace(param->name()->str(), *value);
        }
      }
    }
    runtime.registry().emplace<ModelAgentState>(handle.entity,
                                                std::move(state));
    entities.push_back(handle.entity);
    last_positions_.push_back(position);
    last_agents_state_.push_back(state);
  }

  const std::uint64_t budget = config.arrivals;
  for (std::uint64_t tick = 0; tick < budget; ++tick) {
    for (const Behavior& behavior : behaviors) {
      if (behavior.handler == "flip") {
        for (const entt::entity entity : entities) {
          ModelAgentState& state = runtime.registry().get<ModelAgentState>(
              entity);
          const auto it = state.values.find(behavior.arg);
          if (it != state.values.end() && std::holds_alternative<bool>(it->second)) {
            it->second = !std::get<bool>(it->second);
          }
        }
      }
      // noop: nothing to do.
    }
    runtime.update_kinematics(kDt);
    if (bounce) {
      for (std::int64_t i = 0; i < count; ++i) {
        Position position = runtime.store().position(i);
        Velocity velocity = runtime.store().velocity(i);
        if (position.x < 0.0F) {
          position.x = -position.x;
          velocity.vx = -velocity.vx;
        } else if (position.x > 1.0F) {
          position.x = 2.0F - position.x;
          velocity.vx = -velocity.vx;
        }
        if (position.y < 0.0F) {
          position.y = -position.y;
          velocity.vy = -velocity.vy;
        } else if (position.y > 1.0F) {
          position.y = 2.0F - position.y;
          velocity.vy = -velocity.vy;
        }
        runtime.store().set_position(i, position);
        runtime.store().set_velocity(i, velocity);
      }
    }
  }

  for (std::int64_t i = 0; i < count; ++i) {
    last_positions_[static_cast<std::size_t>(i)] =
        runtime.store().position(i);
    last_agents_state_[static_cast<std::size_t>(i)] =
        runtime.registry().get<ModelAgentState>(entities[static_cast<std::size_t>(i)]);
  }

  metrics.arrivals = budget;
  metrics.departures = 0;
  const std::int64_t horizon_ns =
      static_cast<std::int64_t>(static_cast<double>(budget) * kDt * 1e9);
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(horizon_ns));
    trace->absorb(budget);
  }
  return metrics;
}

}  // namespace logicpilot

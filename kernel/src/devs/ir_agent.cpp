// IR agent runtime: AgentReplicationModel tick loop (see ir_agent.h).
#include "logicpilot/devs/ir_agent.h"

#include <cmath>
#include <string>
#include <utility>

#include "logicpilot/agent/agent_runtime.h"

#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

namespace v2 = logicpilot::ir::v2;

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

bool v2_node_is(const v2::Node* node, const char* block) {
  return node != nullptr && node->semantics() != nullptr &&
         node->semantics()->block() != nullptr &&
         std::strcmp(node->semantics()->block()->c_str(), block) == 0;
}

constexpr float kDt = 1.0F;  // fixed sim-time per tick (v0.1)

}  // namespace

AgentReplicationModel::AgentReplicationModel(
    std::vector<std::uint8_t> v2_bytes, const v2::Node* /*v2_root*/)
    : bytes_{std::move(v2_bytes)} {
  v2_root_ = ir::v2::GetModelFile(bytes_.data())->root();
}

ReplicationMetrics AgentReplicationModel::run(const ReplicationConfig& config,
                                              TraceRecorder* trace) {
  ReplicationMetrics metrics;
  metrics.arrivals = 0;

  // Parse count/state/behaviors from the v2 agent Node.
  const v2::Node* v2_agent = nullptr;
  if (v2_node_is(v2_root_, "agent")) {
    v2_agent = v2_root_;
  } else if (v2_node_is(v2_root_, "model") &&
             v2_root_->children() != nullptr &&
             v2_root_->children()->size() == 1) {
    const v2::Node* child = v2_root_->children()->Get(0);
    if (v2_node_is(child, "agent")) {
      v2_agent = child;
    }
  }
  if (v2_agent == nullptr) {
    return metrics;
  }

  struct Behavior {
    std::string handler;
    std::string arg;
  };
  std::vector<Behavior> behaviors;
  if (v2_agent->behaviors() != nullptr) {
    for (const v2::BehaviorBinding* binding : *v2_agent->behaviors()) {
      if (binding->trigger() == nullptr ||
          binding->trigger()->str() != "on_tick" ||
          binding->handler_ref() == nullptr) {
        continue;
      }
      Behavior b;
      b.handler = binding->handler_ref()->str();
      if (binding->params() != nullptr &&
          binding->params()->size() > 0 &&
          binding->params()->Get(0)->name() != nullptr) {
        b.arg = binding->params()->Get(0)->name()->str();
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

  std::int64_t count = 1;
  if (v2_agent->params() != nullptr) {
    for (const v2::Var* var : *v2_agent->params()) {
      if (var->name() != nullptr && var->name()->str() == "count" &&
          var->type() == v2::VarType_Int) {
        count = var->int_value();
        break;
      }
    }
  }
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
    const auto apply_state_vars = [&](const auto& list) {
      if (list == nullptr) {
        return;
      }
      for (const auto* item : *list) {
        const auto value = v2_var_value(item);
        if (value && item->name() != nullptr) {
          state.values.emplace(item->name()->str(), *value);
        }
      }
    };
    apply_state_vars(v2_agent->state());
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

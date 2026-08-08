// IR agent runtime: AgentReplicationModel tick loop (see ir_agent.h).
#include "logicpilot/devs/ir_agent.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <string>
#include <thread>
#include <utility>
#include <vector>

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

// Parallel per-entity pass (ADR-0009 Phase B): flip/bounce touch each
// entity independently, so partitioning the range preserves the exact
// per-entity computation and bit-exact results. Small populations and
// single-core hosts stay sequential.
template <typename Fn>
void parallel_for_entities(std::int64_t count, Fn&& fn) {
  const unsigned hw = std::thread::hardware_concurrency();
  const std::size_t threads =
      count < 65536 || hw <= 1 ? 1 : std::min<std::size_t>(static_cast<std::size_t>(hw), 8);
  if (threads == 1) {
    for (std::int64_t i = 0; i < count; ++i) {
      fn(i);
    }
    return;
  }
  std::atomic<std::int64_t> next{0};
  std::vector<std::thread> workers;
  workers.reserve(threads);
  for (std::size_t w = 0; w < threads; ++w) {
    workers.emplace_back([&] {
      for (;;) {
        const std::int64_t i = next.fetch_add(1);
        if (i >= count) {
          break;
        }
        fn(i);
      }
    });
  }
  for (std::thread& worker : workers) {
    worker.join();
  }
}

bool v2_node_is(const v2::Node* node, const char* block) {
  return node != nullptr && node->semantics() != nullptr && node->semantics()->block() != nullptr &&
         std::strcmp(node->semantics()->block()->c_str(), block) == 0;
}

const v2::Node* find_agent_node(const v2::Node* node) {
  if (node == nullptr) {
    return nullptr;
  }
  if (v2_node_is(node, "agent") && node->semantics()->library() != nullptr &&
      node->semantics()->library()->str() == "agent") {
    return node;
  }
  if (node->children() != nullptr) {
    for (const v2::Node* child : *node->children()) {
      if (const v2::Node* found = find_agent_node(child); found != nullptr) {
        return found;
      }
    }
  }
  return nullptr;
}

constexpr float kDt = 1.0F;  // fixed sim-time per tick (v0.1)

}  // namespace

struct AgentReplicationModel::Session {
  struct Behavior {
    std::string handler;
    std::string arg;
  };

  AgentRuntime runtime;
  std::vector<AgentHandle> handles;
  std::vector<Behavior> behaviors;
  std::int64_t count{0};
  std::uint64_t budget{0};
  std::uint64_t tick{0};
  bool bounce{false};
};

AgentReplicationModel::AgentReplicationModel(std::vector<std::uint8_t> v2_bytes,
                                             const v2::Node* /*v2_root*/)
    : bytes_{std::move(v2_bytes)} {
  v2_root_ = ir::v2::GetModelFile(bytes_.data())->root();
}

AgentReplicationModel::~AgentReplicationModel() = default;

ReplicationMetrics AgentReplicationModel::run(const ReplicationConfig& config,
                                              TraceRecorder* trace) {
  if (!reset(config)) {
    return ReplicationMetrics{};
  }
  while (step()) {
  }
  return finish(trace);
}

bool AgentReplicationModel::reset(const ReplicationConfig& config) {
  const v2::Node* v2_agent = find_agent_node(v2_root_);
  if (v2_agent == nullptr) {
    return false;
  }

  session_ = std::make_unique<Session>();
  if (v2_agent->behaviors() != nullptr) {
    for (const v2::BehaviorBinding* binding : *v2_agent->behaviors()) {
      if (binding->trigger() == nullptr || binding->trigger()->str() != "on_tick" ||
          binding->handler_ref() == nullptr) {
        continue;
      }
      Session::Behavior b;
      b.handler = binding->handler_ref()->str();
      if (binding->params() != nullptr && binding->params()->size() > 0 &&
          binding->params()->Get(0)->name() != nullptr) {
        b.arg = binding->params()->Get(0)->name()->str();
      }
      session_->behaviors.push_back(std::move(b));
    }
  }
  session_->bounce = [&] {
    for (const Session::Behavior& b : session_->behaviors) {
      if (b.handler == "bounce") {
        return true;
      }
    }
    return false;
  }();

  session_->count = 1;
  if (v2_agent->params() != nullptr) {
    for (const v2::Var* var : *v2_agent->params()) {
      if (var->name() != nullptr && var->name()->str() == "count" &&
          var->type() == v2::VarType_Int) {
        session_->count = var->int_value();
        break;
      }
    }
  }
  if (session_->count < 0) {
    session_.reset();
    return false;
  }
  session_->budget = config.arrivals;
  session_->handles.reserve(static_cast<std::size_t>(session_->count));
  last_positions_.clear();
  last_agents_state_.clear();
  for (std::int64_t i = 0; i < session_->count; ++i) {
    const float x = (static_cast<float>(i) + 0.5F) / static_cast<float>(session_->count);
    const float angle = static_cast<float>(i + 1) * 0.7F;
    const Position position{x, 0.5F};
    const Velocity velocity{0.1F * std::cos(angle), 0.1F * std::sin(angle)};
    const AgentHandle handle =
        session_->runtime.create_agent(position, velocity, AgentState{AgentState::kActiveBit});
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
    session_->runtime.registry().emplace<ModelAgentState>(handle.entity, std::move(state));
    session_->handles.push_back(handle);
    last_positions_.push_back(position);
    last_agents_state_.push_back(state);
  }
  return true;
}

bool AgentReplicationModel::step() {
  if (done()) {
    return false;
  }
  for (const Session::Behavior& behavior : session_->behaviors) {
    if (behavior.handler == "flip") {
      parallel_for_entities(session_->count, [&](std::int64_t i) {
        const AgentHandle handle = session_->handles[static_cast<std::size_t>(i)];
        ModelAgentState& state = session_->runtime.registry().get<ModelAgentState>(handle.entity);
        const auto it = state.values.find(behavior.arg);
        if (it != state.values.end() && std::holds_alternative<bool>(it->second)) {
          it->second = !std::get<bool>(it->second);
        }
      });
    }
    // noop: nothing to do.
  }
  session_->runtime.update_kinematics(kDt);
  if (session_->bounce) {
    parallel_for_entities(session_->count, [&](std::int64_t i) {
      const AgentSlot slot = session_->handles[static_cast<std::size_t>(i)].slot;
      Position position = session_->runtime.store().position(slot);
      Velocity velocity = session_->runtime.store().velocity(slot);
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
      session_->runtime.store().set_position(slot, position);
      session_->runtime.store().set_velocity(slot, velocity);
    });
  }
  ++session_->tick;
  return true;
}

bool AgentReplicationModel::done() const {
  return session_ == nullptr || session_->tick >= session_->budget;
}

ReplicationMetrics AgentReplicationModel::finish(TraceRecorder* trace) {
  ReplicationMetrics metrics;
  if (session_ == nullptr) {
    return metrics;
  }
  for (std::int64_t i = 0; i < session_->count; ++i) {
    const AgentHandle handle = session_->handles[static_cast<std::size_t>(i)];
    last_positions_[static_cast<std::size_t>(i)] = session_->runtime.store().position(handle.slot);
    last_agents_state_[static_cast<std::size_t>(i)] =
        session_->runtime.registry().get<ModelAgentState>(handle.entity);
  }

  metrics.arrivals = session_->tick;
  metrics.departures = 0;
  const std::int64_t horizon_ns =
      static_cast<std::int64_t>(static_cast<double>(session_->tick) * kDt * 1e9);
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(horizon_ns));
    trace->absorb(session_->tick);
  }
  session_.reset();
  return metrics;
}

}  // namespace logicpilot

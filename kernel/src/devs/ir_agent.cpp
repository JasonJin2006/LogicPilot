// IR agent runtime: AgentReplicationModel tick loop (see ir_agent.h).
#include "logicpilot/devs/ir_agent.h"

#include <algorithm>
#include <atomic>
#include <bit>
#include <cmath>
#include <limits>
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
constexpr EventType kAgentLogicalStep = 0xFFFF1001U;
constexpr std::uint32_t kAgentCheckpointMagic = 0x4C504147U;  // LPAG
constexpr std::uint8_t kAgentCheckpointVersion = 2;

std::string event_budget_error(std::uint64_t max_events) {
  return "KR1017: shared scheduler event budget exhausted (" +
         std::to_string(max_events) + " ticks)";
}

void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int byte = 0; byte < 4; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  for (int byte = 0; byte < 8; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int byte = 0; byte < 4; ++byte) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int byte = 0; byte < 8; ++byte) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

void append_string(std::vector<std::uint8_t>& out, const std::string& value) {
  append_u32(out, static_cast<std::uint32_t>(value.size()));
  out.insert(out.end(), value.begin(), value.end());
}

bool read_string(std::span<const std::uint8_t> bytes, std::size_t& offset,
                 std::string& value) {
  std::uint32_t size = 0;
  if (!read_u32(bytes, offset, size) || size > bytes.size() - offset) {
    return false;
  }
  value.assign(reinterpret_cast<const char*>(bytes.data() + offset), size);
  offset += size;
  return true;
}

void append_value(std::vector<std::uint8_t>& out, const IrValue& value) {
  if (std::holds_alternative<bool>(value)) {
    out.push_back(0);
    out.push_back(std::get<bool>(value) ? 1 : 0);
  } else if (std::holds_alternative<std::int64_t>(value)) {
    out.push_back(1);
    append_u64(out, static_cast<std::uint64_t>(std::get<std::int64_t>(value)));
  } else {
    out.push_back(2);
    append_u64(out, std::bit_cast<std::uint64_t>(std::get<double>(value)));
  }
}

bool read_value(std::span<const std::uint8_t> bytes, std::size_t& offset,
                IrValue& value) {
  if (offset >= bytes.size()) return false;
  const std::uint8_t type = bytes[offset++];
  if (type == 0) {
    if (offset >= bytes.size()) return false;
    value = bytes[offset++] != 0;
    return true;
  }
  std::uint64_t raw = 0;
  if (!read_u64(bytes, offset, raw)) return false;
  if (type == 1) {
    value = static_cast<std::int64_t>(raw);
    return true;
  }
  if (type == 2) {
    value = std::bit_cast<double>(raw);
    return true;
  }
  return false;
}

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
  std::uint64_t requested_budget{0};
  std::uint64_t tick{0};
  bool bounce{false};
  bool budget_exhausted{false};
  std::string failure_reason;
};

AgentReplicationModel::AgentReplicationModel(std::vector<std::uint8_t> v2_bytes,
                                             const v2::Node* /*v2_root*/)
    : bytes_{std::move(v2_bytes)} {
  v2_root_ = ir::v2::GetModelFile(bytes_.data())->root();
}

AgentReplicationModel::~AgentReplicationModel() = default;

ReplicationMetrics AgentReplicationModel::run(const ReplicationConfig& config,
                                              TraceRecorder* trace) {
  trace_ = trace;
  if (!reset(config)) {
    trace_ = nullptr;
    return ReplicationMetrics{};
  }
  while (step()) {
  }
  ReplicationMetrics result = finish(trace);
  trace_ = nullptr;
  return result;
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
  session_->requested_budget = config.arrivals;
  session_->budget = std::min(config.arrivals, config.max_events);
  session_->budget_exhausted = false;
  session_->failure_reason.clear();
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

bool AgentReplicationModel::checkpoint_save(
    std::vector<std::uint8_t>& state) const {
  if (session_ == nullptr || session_->count < 0 ||
      static_cast<std::uint64_t>(session_->count) >
          std::numeric_limits<std::uint32_t>::max()) {
    return false;
  }
  state.clear();
  append_u32(state, kAgentCheckpointMagic);
  state.push_back(kAgentCheckpointVersion);
  append_u64(state, static_cast<std::uint64_t>(session_->count));
  append_u64(state, session_->budget);
  append_u64(state, session_->requested_budget);
  append_u64(state, session_->tick);
  state.push_back(session_->bounce ? 1 : 0);
  state.push_back(session_->budget_exhausted ? 1 : 0);
  for (std::size_t index = 0; index < session_->handles.size(); ++index) {
    const AgentHandle handle = session_->handles[index];
    const Position position = session_->runtime.store().position(handle.slot);
    const Velocity velocity = session_->runtime.store().velocity(handle.slot);
    const AgentState agent_state = session_->runtime.store().state(handle.slot);
    append_u32(state, std::bit_cast<std::uint32_t>(position.x));
    append_u32(state, std::bit_cast<std::uint32_t>(position.y));
    append_u32(state, std::bit_cast<std::uint32_t>(velocity.vx));
    append_u32(state, std::bit_cast<std::uint32_t>(velocity.vy));
    append_u32(state, agent_state.bits);

    const ModelAgentState& model_state =
        session_->runtime.registry().get<ModelAgentState>(handle.entity);
    if (model_state.values.size() > std::numeric_limits<std::uint32_t>::max()) {
      return false;
    }
    append_u32(state, static_cast<std::uint32_t>(model_state.values.size()));
    std::vector<std::pair<std::string, IrValue>> values(
        model_state.values.begin(), model_state.values.end());
    std::sort(values.begin(), values.end(),
              [](const auto& left, const auto& right) {
                return left.first < right.first;
              });
    for (const auto& [name, value] : values) {
      append_string(state, name);
      append_value(state, value);
    }
  }
  return true;
}

bool AgentReplicationModel::checkpoint_restore(
    std::span<const std::uint8_t> state) {
  if (session_ == nullptr) return false;
  std::size_t offset = 0;
  std::uint32_t magic = 0;
  std::uint64_t count = 0;
  std::uint64_t budget = 0, requested_budget = 0, tick = 0;
  if (!read_u32(state, offset, magic) || magic != kAgentCheckpointMagic ||
      offset >= state.size() || state[offset++] != kAgentCheckpointVersion ||
      !read_u64(state, offset, count) || !read_u64(state, offset, budget) ||
      !read_u64(state, offset, requested_budget) ||
      !read_u64(state, offset, tick) || offset >= state.size()) {
    return false;
  }
  if (count > static_cast<std::uint64_t>(
                   std::numeric_limits<std::int64_t>::max())) {
    return false;
  }
  const bool bounce = state[offset++] != 0;
  if (offset >= state.size()) return false;
  const bool budget_exhausted = state[offset++] != 0;
  struct RestoredAgent {
    Position position;
    Velocity velocity;
    AgentState state;
    ModelAgentState model_state;
  };
  std::vector<RestoredAgent> restored;
  restored.reserve(static_cast<std::size_t>(count));
  for (std::uint64_t index = 0; index < count; ++index) {
    std::uint32_t raw = 0;
    RestoredAgent agent;
    if (!read_u32(state, offset, raw)) return false;
    agent.position.x = std::bit_cast<float>(raw);
    if (!read_u32(state, offset, raw)) return false;
    agent.position.y = std::bit_cast<float>(raw);
    if (!read_u32(state, offset, raw)) return false;
    agent.velocity.vx = std::bit_cast<float>(raw);
    if (!read_u32(state, offset, raw)) return false;
    agent.velocity.vy = std::bit_cast<float>(raw);
    if (!read_u32(state, offset, agent.state.bits)) return false;
    std::uint32_t values = 0;
    if (!read_u32(state, offset, values)) return false;
    for (std::uint32_t value_index = 0; value_index < values; ++value_index) {
      std::string name;
      IrValue value;
      if (!read_string(state, offset, name) ||
          !read_value(state, offset, value) ||
          !agent.model_state.values.emplace(std::move(name), value).second) {
        return false;
      }
    }
    restored.push_back(std::move(agent));
  }
  if (offset != state.size()) return false;

  session_->runtime.clear();
  session_->handles.clear();
  session_->count = static_cast<std::int64_t>(count);
  session_->budget = budget;
  session_->requested_budget = requested_budget;
  session_->tick = tick;
  session_->bounce = bounce;
  session_->budget_exhausted = budget_exhausted;
  session_->failure_reason = budget_exhausted
                                 ? event_budget_error(session_->budget)
                                 : std::string{};
  session_->handles.reserve(restored.size());
  last_positions_.clear();
  last_agents_state_.clear();
  for (RestoredAgent& agent : restored) {
    const AgentHandle handle = session_->runtime.create_agent(
        agent.position, agent.velocity, agent.state);
    session_->runtime.registry().emplace<ModelAgentState>(
        handle.entity, std::move(agent.model_state));
    session_->handles.push_back(handle);
    last_positions_.push_back(agent.position);
    last_agents_state_.push_back(
        session_->runtime.registry().get<ModelAgentState>(handle.entity));
  }
  return true;
}

bool AgentReplicationModel::step() {
  if (done()) {
    if (session_ != nullptr && session_->tick >= session_->budget &&
        session_->budget < session_->requested_budget) {
      session_->budget_exhausted = true;
      session_->failure_reason = event_budget_error(session_->budget);
    }
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
  if (trace_ != nullptr) {
    trace_->record_logical_step(
        SimTime::from_ns(static_cast<std::int64_t>(session_->tick) *
                         1'000'000'000LL),
        kAgentLogicalStep, session_->tick);
  }
  return true;
}

bool AgentReplicationModel::done() const {
  return session_ == nullptr || session_->budget_exhausted ||
         session_->tick >= session_->budget;
}

bool AgentReplicationModel::failed() const {
  return session_ != nullptr && session_->budget_exhausted;
}

const std::string& AgentReplicationModel::failure_reason() const {
  static const std::string kNoFailure;
  return session_ != nullptr ? session_->failure_reason : kNoFailure;
}

std::uint64_t AgentReplicationModel::tick_count() const {
  return session_ != nullptr ? session_->tick : 0;
}

void AgentReplicationModel::snapshot_agents(std::vector<AgentSnapshot>& out) const {
  out.clear();
  if (session_ == nullptr) return;
  out.reserve(session_->handles.size());
  for (std::size_t index = 0; index < session_->handles.size(); ++index) {
    const AgentHandle handle = session_->handles[index];
    out.push_back(AgentSnapshot{
        static_cast<std::uint64_t>(index),
        session_->runtime.store().position(handle.slot),
        session_->runtime.store().state(handle.slot),
    });
  }
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

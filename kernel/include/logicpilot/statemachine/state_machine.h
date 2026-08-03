// Table-driven finite state machine engine (self-contained, ~200 lines).
//
// Design: a StateMachineDefinition is an immutable table of states and
// transitions built once (cold path). Cheap StateMachine instances hang off
// it and dispatch events against the table. Instances are trivially copyable
// POD (current state id + user data pointer), so they can live directly in
// ECS component columns and be advanced in bulk via dispatch_all().
#pragma once

#include <cassert>
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace logicpilot {

using StateId = std::uint32_t;
using FsmEventId = std::uint32_t;

inline constexpr StateId kInvalidState = ~StateId{0};

// Optional user context threaded through guards/actions.
struct FsmContext {
  void* user{nullptr};
};

class StateMachineDefinition {
 public:
  using Guard = std::function<bool(FsmContext&)>;
  using Action = std::function<void(FsmContext&)>;

  struct Transition {
    StateId from{kInvalidState};
    FsmEventId event{0};
    StateId to{kInvalidState};
    Guard guard;    // optional; nullptr = always taken
    Action action;  // optional; runs after the state change
  };

  // States -------------------------------------------------------------------
  StateId add_state(const std::string& name) {
    const auto id = static_cast<StateId>(names_.size());
    names_.push_back(name);
    by_name_.emplace(name, id);
    return id;
  }

  [[nodiscard]] StateId state_count() const {
    return static_cast<StateId>(names_.size());
  }
  [[nodiscard]] const std::string& state_name(StateId s) const {
    assert(s < names_.size());
    return names_[s];
  }
  [[nodiscard]] StateId find_state(const std::string& name) const {
    const auto it = by_name_.find(name);
    return it == by_name_.end() ? kInvalidState : it->second;
  }

  // Transitions ---------------------------------------------------------------
  // First matching (from, event) row wins; later duplicates are ignored.
  void add_transition(StateId from, FsmEventId event, StateId to,
                      Guard guard = nullptr, Action action = nullptr) {
    assert(from < names_.size() && to < names_.size());
    if (find_transition(from, event) != nullptr) {
      return;
    }
    transitions_.push_back(Transition{from, event, to, std::move(guard),
                                      std::move(action)});
  }

  [[nodiscard]] const Transition* find_transition(StateId from,
                                                  FsmEventId event) const {
    for (const Transition& t : transitions_) {
      if (t.from == from && t.event == event) {
        return &t;
      }
    }
    return nullptr;
  }

  [[nodiscard]] std::size_t transition_count() const {
    return transitions_.size();
  }

 private:
  std::vector<std::string> names_;
  std::unordered_map<std::string, StateId> by_name_;
  std::vector<Transition> transitions_;
};

// One machine instance. POD-ish on purpose: fits in an ECS component column.
class StateMachine {
 public:
  StateMachine() = default;
  explicit StateMachine(StateId initial) : current_{initial} {}

  [[nodiscard]] StateId current() const { return current_; }
  void reset(StateId s) { current_ = s; }

  // Dispatch `event`. Returns true iff a transition fired. Unknown events
  // and rejected guards leave the machine untouched.
  bool dispatch(const StateMachineDefinition& def, FsmEventId event,
                FsmContext& ctx) {
    const auto* t = def.find_transition(current_, event);
    if (t == nullptr) {
      return false;
    }
    if (t->guard && !t->guard(ctx)) {
      return false;
    }
    current_ = t->to;
    if (t->action) {
      t->action(ctx);
    }
    return true;
  }

 private:
  StateId current_{kInvalidState};
};

// ECS-friendly per-entity instance column (works with entt::registry or any
// owning container): one current-state word per entity.
struct FsmStateComponent {
  StateId current{kInvalidState};
};

// Batch advance: dispatch the same event across a range of instances.
// Returns the number of transitions that fired. `Range` must iterate into
// FsmStateComponent& (e.g. std::span<FsmStateComponent>, an entt view).
template <typename Range>
std::size_t dispatch_all(const StateMachineDefinition& def, Range&& machines,
                         FsmEventId event, FsmContext& ctx) {
  std::size_t fired = 0;
  for (auto&& m : machines) {
    StateMachine instance{m.current};
    if (instance.dispatch(def, event, ctx)) {
      ++fired;
    }
    m.current = instance.current();
  }
  return fired;
}

}  // namespace logicpilot

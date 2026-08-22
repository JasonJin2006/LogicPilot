// StatechartReplicationModel implementation.
//
// A standalone statechart model is a root node carrying
// SemanticsRef{library: "statechart", block: "statechart"} plus a
// `behavior` Statechart table (states / transitions / initial). This model
// lowers that table onto the kernel's table-driven StateMachineDefinition
// engine and drives it in simulation time:
//   * Timeout transitions schedule the next internal event (timeout_value
//     or a sampled timeout_distribution); firing advances the machine.
//   * Rate transitions behave like timeouts drawn from Exponential(rate).
//   * Condition transitions whose condition is empty / "true" fire
//     immediately on state entry (AnyLogic-style guards-after-triggers is
//     a later phase; arbitrary boolean expressions are not evaluated yet).
//   * Message transitions are registered under their message port (dispatch
//     targets for future cross-machine coupling); a self-contained run is
//     timer-driven.
//   * Final states stop the machine; history states return to the most
//     recently visited state; branches resolve their first enabled exit.
// ReplicationConfig.arrivals bounds the number of transition steps so
// cyclic statecharts terminate deterministically (like the DEVS internal
// budget). metrics.final_value reports the final state id.
#include "statechart_replication.h"

#include <cmath>
#include <cstdint>
#include <exception>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/continuous.h"  // ExpressionEvaluator
#include "logicpilot/devs/mm1.h"  // TimeSampler
#include "logicpilot/runtime/runtime_context.h"

namespace logicpilot {
namespace {

using ir::v2::Node;
using ir::v2::Action;
using ir::v2::Statechart;
using ir::v2::Transition;
using ir::v2::TriggerKind_Condition;
using ir::v2::TriggerKind_Message;
using ir::v2::TriggerKind_Rate;
using ir::v2::TriggerKind_Timeout;

constexpr EventType kTimerEventType = 30;
constexpr EventType kConditionPollType = 31;
// Condition transitions are polled on a fixed cadence (AnyLogic monitors
// conditions continuously; v1 uses a 50 ms step). The poll count is capped
// so a condition that never becomes true still terminates the run instead
// of looping forever.
constexpr double kConditionPollDt = 0.05;
constexpr std::uint64_t kMaxConditionPolls = 20000;
// Every IR transition gets its own FSM event id. A trigger kind (timeout,
// rate, message) is not an event identity: two transitions from the same state
// may have the same trigger kind but different targets, guards or actions.
constexpr FsmEventId kFirstDynamicFsmEvent = 0;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

struct StatechartReplicationModel::Impl {
  StateMachineDefinition definition;

  struct TimedTrigger {
    FsmEventId event{0};
    TimeSampler sampler;
  };

  struct BranchExit {
    StateId target{kInvalidState};
    std::string condition;
    bool is_default{false};
  };

  // Per "from" state: active timed triggers (timeout + rate).
  std::unordered_map<StateId, std::vector<TimedTrigger>> timed_triggers;
  // Condition transitions that fire immediately on entry (empty/"true").
  std::unordered_map<StateId, std::vector<FsmEventId>> immediate_conditions;
  // Non-trivial condition transitions (text is not empty/"true"): polled
  // while the source state is current; first true condition fires.
  std::unordered_map<StateId, std::vector<std::pair<FsmEventId, std::string>>>
      condition_triggers;
  std::unordered_set<StateId> final_states;
  std::unordered_set<StateId> history_states;
  std::unordered_map<StateId, std::vector<BranchExit>> branch_targets;
  std::unordered_map<std::string, std::vector<FsmEventId>> message_events;
  std::unordered_map<FsmEventId, std::vector<std::string>> emitted_ports;
  std::unordered_map<FsmEventId, std::string> guard_text;
  std::vector<std::string> emitted_messages;
  std::function<void()> emission_callback;
  StateId initial{kInvalidState};

  // Per-replication runtime state.
  Xoshiro256PlusPlus engine_{0};
  RuntimeContext* external_{nullptr};
  std::unique_ptr<BinaryHeapScheduler> owned_scheduler_;
  SimulationClock owned_clock_;
  EventHandlerRegistry owned_handlers_;
  HandlerId timer_handler_{0};
  HandlerId condition_handler_{0};
  std::vector<EventToken> timer_tokens;
  EventToken condition_token{};
  StateMachine machine;
  ReplicationConfig config_;
  std::uint64_t steps_{0};
  std::uint64_t condition_polls_{0};
  StateId last_visited{kInvalidState};
  bool done_{false};

  [[nodiscard]] IEventScheduler& scheduler() {
    return external_ != nullptr ? external_->scheduler() : *owned_scheduler_;
  }
  [[nodiscard]] SimulationClock& clock() {
    return external_ != nullptr ? external_->clock() : owned_clock_;
  }
  [[nodiscard]] const SimulationClock& clock() const {
    return external_ != nullptr ? external_->clock() : owned_clock_;
  }
  [[nodiscard]] EventHandlerRegistry& handlers() {
    return external_ != nullptr ? external_->handlers() : owned_handlers_;
  }

  // Resolve final / history / branch pseudo-states after a state change.
  // History and branches forward control without waiting for a trigger, so
  // this loops until the machine settles in a regular state.
  void settle() {
    for (;;) {
      const StateId state = machine.current();
      if (final_states.count(state) != 0) {
        done_ = true;
        return;
      }
      if (history_states.count(state) != 0) {
        const StateId target =
            last_visited != kInvalidState ? last_visited : initial;
        if (target == kInvalidState || target == state) {
          return;  // no history yet: stay in the history state
        }
        machine.reset(target);
        ++steps_;
        continue;
      }
      const auto branch = branch_targets.find(state);
      if (branch != branch_targets.end()) {
        StateId target = kInvalidState;
        for (const BranchExit& exit : branch->second) {
          if (exit.is_default || exit.condition.empty() ||
              exit.condition == "true") {
            target = exit.target;
            break;
          }
        }
        if (target == kInvalidState && !branch->second.empty()) {
          target = branch->second.back().target;  // default exit
        }
        if (target == kInvalidState || target == state) {
          return;
        }
        machine.reset(target);
        ++steps_;
        continue;
      }
      return;
    }
  }

  void on_timer(const Event& event) {
    if (done_) {
      return;
    }
    const FsmEventId fsm_event = static_cast<FsmEventId>(event.payload);
    const StateId from = machine.current();
    FsmContext ctx;
    if (guard_allows(fsm_event) && machine.dispatch(definition, fsm_event, ctx)) {
      last_visited = from;
      ++steps_;
      emit_for(fsm_event);
      settle();
    }
    reschedule_triggers(machine.current());
  }

  void on_condition_poll() {
    if (done_) {
      return;
    }
    if (++condition_polls_ > kMaxConditionPolls) {
      done_ = true;
      return;
    }
    const StateId state = machine.current();
    bool transitioned = false;
    const auto triggers = condition_triggers.find(state);
    if (triggers != condition_triggers.end()) {
      const double now_seconds =
          static_cast<double>(clock().now().as_ns()) * 1e-9;
      const auto lookup = [now_seconds](const std::string& name) {
        if (name == "t" || name == "time") {
          return now_seconds;
        }
        return 0.0;
      };
      FsmEventId fired = kInvalidState;
      for (const auto& [event, condition] : triggers->second) {
        const ExpressionEvaluator evaluator{condition};
        if (evaluator.ok() && evaluator.eval(lookup) != 0.0 &&
            guard_allows(event)) {
          fired = event;
          break;
        }
      }
      if (fired != kInvalidState) {
        const StateId from = machine.current();
        FsmContext ctx;
        if (machine.dispatch(definition, fired, ctx)) {
          transitioned = true;
          last_visited = from;
          ++steps_;
          emit_for(fired);
          settle();
        }
      }
    }
    if (transitioned) reschedule_triggers(machine.current());
    else schedule_condition_poll(machine.current());
  }

  void schedule_condition_poll(StateId state) {
    if (done_) {
      return;
    }
    if (condition_triggers.count(state) == 0) {
      return;
    }
    if (condition_token.valid()) scheduler().cancel(condition_token);
    condition_token = scheduler().schedule(
        clock().now() + SimTime::from_ns(to_ns(kConditionPollDt)),
        kConditionPollType, condition_handler_, 0);
  }

  void cancel_scheduled_triggers() {
    for (const EventToken token : timer_tokens) scheduler().cancel(token);
    timer_tokens.clear();
    if (condition_token.valid()) scheduler().cancel(condition_token);
    condition_token = EventToken{};
  }

  void reschedule_triggers(StateId state) {
    cancel_scheduled_triggers();
    schedule_triggers(state);
  }

  void schedule_triggers(StateId state) {
    if (done_) {
      return;
    }
    if (config_.arrivals > 0 && steps_ >= config_.arrivals) {
      done_ = true;
      return;
    }
    const auto timed = timed_triggers.find(state);
    if (timed != timed_triggers.end()) {
      for (const TimedTrigger& trigger : timed->second) {
        const double seconds = trigger.sampler(engine_);
        timer_tokens.push_back(scheduler().schedule(
            clock().now() + SimTime::from_ns(to_ns(seconds)),
            kTimerEventType, timer_handler_, trigger.event));
      }
    }
    const auto immediate = immediate_conditions.find(state);
    if (immediate != immediate_conditions.end()) {
      for (const FsmEventId event : immediate->second) {
        timer_tokens.push_back(scheduler().schedule(
            clock().now(), kTimerEventType, timer_handler_, event));
      }
    }
    schedule_condition_poll(state);
  }

  void emit_for(FsmEventId event) {
    const auto it = emitted_ports.find(event);
    if (it == emitted_ports.end()) return;
    emitted_messages.insert(emitted_messages.end(), it->second.begin(), it->second.end());
    if (emission_callback) emission_callback();
  }

  bool guard_allows(FsmEventId event) const {
    const auto it = guard_text.find(event);
    if (it == guard_text.end() || it->second.empty() || it->second == "true") {
      return true;
    }
    if (it->second == "false") return false;
    const ExpressionEvaluator evaluator{it->second};
    if (!evaluator.ok()) return false;
    const double now_seconds =
        static_cast<double>(clock().now().as_ns()) * 1e-9;
    return evaluator.eval([now_seconds](const std::string& name) {
             if (name == "t" || name == "time") return now_seconds;
             return 0.0;
           }) != 0.0;
  }

  void record_emits(const Transition* transition, FsmEventId event) {
    if (transition == nullptr || transition->actions() == nullptr) return;
    for (const Action* action : *transition->actions()) {
      if (action != nullptr && action->emit_port() != nullptr) {
        emitted_ports[event].push_back(action->emit_port()->str());
      }
    }
  }

  // Register one transition on the FSM definition; returns false when the
  // transition references an undeclared state.
  bool register_transition(const Transition* transition,
                           const std::unordered_map<std::string, StateId>&
                               by_name,
                            std::unordered_map<std::string, std::vector<FsmEventId>>&
                                message_events,
                           FsmEventId& next_dynamic_event,
                           const std::string& guard) {
    const auto from_it = by_name.find(transition->from()->str());
    const auto to_it = by_name.find(transition->to()->str());
    if (from_it == by_name.end() || to_it == by_name.end()) {
      return false;
    }
    const StateId from = from_it->second;
    const StateId to = to_it->second;

    if (transition->trigger() == TriggerKind_Timeout) {
      TimeSampler sampler;
      if (transition->timeout_distribution() != nullptr &&
          transition->timeout_distribution()->params() != nullptr &&
          transition->timeout_distribution()->params()->size() > 0) {
        const double rate =
            transition->timeout_distribution()->params()->Get(0);
        sampler = [rate](Xoshiro256PlusPlus& engine) {
          Exponential<Xoshiro256PlusPlus> dist{rate};
          return dist(engine);
        };
      } else {
        const double value = transition->timeout_value();
        sampler = [value](Xoshiro256PlusPlus&) { return value; };
      }
      const FsmEventId event = next_dynamic_event++;
      timed_triggers[from].push_back(TimedTrigger{event, std::move(sampler)});
      definition.add_transition(from, event, to);
      record_emits(transition, event);
      if (!guard.empty()) guard_text[event] = guard;
      return true;
    }
    if (transition->trigger() == TriggerKind_Rate) {
      const double rate = transition->rate() > 0.0 ? transition->rate() : 1.0;
      TimeSampler sampler = [rate](Xoshiro256PlusPlus& engine) {
        Exponential<Xoshiro256PlusPlus> dist{rate};
        return dist(engine);
      };
      const FsmEventId event = next_dynamic_event++;
      timed_triggers[from].push_back(TimedTrigger{event, std::move(sampler)});
      definition.add_transition(from, event, to);
      record_emits(transition, event);
      if (!guard.empty()) guard_text[event] = guard;
      return true;
    }
    if (transition->trigger() == TriggerKind_Message) {
      const std::string port =
          transition->message_port() != nullptr
              ? transition->message_port()->str()
              : "";
      const FsmEventId event = next_dynamic_event++;
      message_events[port].push_back(event);
      definition.add_transition(from, event, to);
      record_emits(transition, event);
      if (!guard.empty()) guard_text[event] = guard;
      return true;
    }
    if (transition->trigger() == TriggerKind_Condition) {
      const std::string condition =
          transition->condition_text() != nullptr
              ? transition->condition_text()->str()
              : "";
      const FsmEventId event = next_dynamic_event++;
      definition.add_transition(from, event, to);
      record_emits(transition, event);
      if (!guard.empty()) guard_text[event] = guard;
      if (condition.empty() || condition == "true") {
        immediate_conditions[from].push_back(event);
      } else {
        condition_triggers[from].push_back({event, condition});
      }
      return true;
    }
    return true;  // unknown trigger kinds stay inert, never block lowering
  }
};

// Helper: read a statechart semantics param by name (final/history/branch).
StatechartReplicationModel::StatechartReplicationModel(const Node* root,
                                                       std::string* error)
    : impl_(std::make_unique<Impl>()) {
  const auto fail = [&](const std::string& message) {
    if (error != nullptr) {
      *error = message;
    }
    impl_.reset();
  };
  if (root == nullptr || root->behavior() == nullptr) {
    fail("statechart model has no behavior table");
    return;
  }
  const Statechart* chart = root->behavior();
  if (chart->states() == nullptr || chart->states()->size() == 0) {
    fail("statechart has no states");
    return;
  }

  // States (ids follow declaration order).
  std::unordered_map<std::string, StateId> by_name;
  for (const auto* state : *chart->states()) {
    if (state == nullptr || state->name() == nullptr) {
      fail("statechart contains an unnamed state");
      return;
    }
    const std::string name = state->name()->str();
    by_name.emplace(name, impl_->definition.add_state(name));
  }

  // Element markers travel as semantics params: final/history/branch name
  // the special states; historyType selects shallow/deep (v1: one level).
  std::unordered_set<std::string> branch_names;
  std::unordered_map<std::size_t, std::string> indexed_guards;
  if (root->params() != nullptr) {
    for (const auto* param : *root->params()) {
      if (param == nullptr || param->name() == nullptr ||
          param->string_value() == nullptr) {
        continue;
      }
      const std::string key = param->name()->str();
      const std::string value = param->string_value()->str();
      if (key.rfind("guard:", 0) == 0 && key.size() > 6) {
        try {
          indexed_guards.emplace(std::stoull(key.substr(6)), value);
        } catch (const std::exception&) {
          // Malformed auxiliary metadata is ignored; the transition remains
          // executable without a guard.
        }
        continue;
      }
      const auto it = by_name.find(value);
      if (it == by_name.end()) {
        continue;
      }
      if (key == "final") {
        impl_->final_states.insert(it->second);
      } else if (key == "history") {
        impl_->history_states.insert(it->second);
      } else if (key == "branch") {
        branch_names.insert(value);
      }
    }
  }

  // Transitions. Branch exits carry no trigger and are resolved on entry;
  // everything else goes onto the FSM table.
  std::unordered_map<std::string, std::vector<FsmEventId>> message_events;
  FsmEventId next_dynamic_event = kFirstDynamicFsmEvent;
  std::size_t transition_index = 0;
  if (chart->transitions() != nullptr) {
    for (const Transition* transition : *chart->transitions()) {
      if (transition == nullptr || transition->from() == nullptr ||
          transition->to() == nullptr) {
        continue;
      }
      const auto from_it = by_name.find(transition->from()->str());
      const auto to_it = by_name.find(transition->to()->str());
      if (from_it == by_name.end() || to_it == by_name.end()) {
        fail("statechart transition references an unknown state");
        return;
      }
      const StateId from = from_it->second;
      const StateId to = to_it->second;
      const bool is_branch = branch_names.count(transition->from()->str()) != 0;
      if (is_branch) {
        Impl::BranchExit exit;
        exit.target = to;
        exit.condition =
            transition->condition_text() != nullptr
                ? transition->condition_text()->str()
                : "";
        exit.is_default =
            exit.condition == "default" || exit.condition == "else";
        impl_->branch_targets[from].push_back(std::move(exit));
        ++transition_index;
        continue;
      }
      const auto guard = indexed_guards.find(transition_index);
      const std::string guard_text =
          guard == indexed_guards.end() ? std::string{} : guard->second;
      if (!impl_->register_transition(
              transition, by_name, message_events, next_dynamic_event,
              guard_text)) {
        fail("statechart transition references an unknown state");
        return;
      }
      ++transition_index;
    }
  }

  if (chart->initial() == nullptr) {
    fail("statechart has no initial state");
    return;
  }
  const auto initial_it = by_name.find(chart->initial()->str());
  if (initial_it == by_name.end()) {
    fail("statechart initial state is not declared");
    return;
  }
  impl_->initial = initial_it->second;
  impl_->message_events = std::move(message_events);
  impl_->machine = StateMachine{impl_->initial};
}

StatechartReplicationModel::~StatechartReplicationModel() = default;

void StatechartReplicationModel::attach(RuntimeContext& context) {
  impl_->external_ = &context;
}

void StatechartReplicationModel::cancel_pending_events() {
  if (impl_ != nullptr) impl_->cancel_scheduled_triggers();
}

void StatechartReplicationModel::reset(const ReplicationConfig& config) {
  if (impl_ == nullptr) {
    return;
  }
  impl_->config_ = config;
  if (impl_->external_ != nullptr) impl_->cancel_scheduled_triggers();
  else {
    impl_->timer_tokens.clear();
    impl_->condition_token = EventToken{};
  }
  impl_->steps_ = 0;
  impl_->condition_polls_ = 0;
  impl_->done_ = false;
  impl_->last_visited = kInvalidState;
  impl_->emitted_messages.clear();
  impl_->machine = StateMachine{impl_->initial};
  impl_->engine_ = Xoshiro256PlusPlus{config.seed};
  if (impl_->external_ == nullptr) {
    impl_->owned_scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
    impl_->owned_clock_ = SimulationClock{};
    impl_->owned_handlers_ = EventHandlerRegistry{};
  }
  impl_->timer_handler_ = impl_->handlers().add([this](const Event& event) {
    impl_->on_timer(event);
  });
  impl_->condition_handler_ = impl_->handlers().add([this](const Event&) {
    impl_->on_condition_poll();
  });
  impl_->settle();
  impl_->reschedule_triggers(impl_->machine.current());
}

ReplicationMetrics StatechartReplicationModel::run(
    const ReplicationConfig& config, TraceRecorder* trace) {
  ReplicationMetrics metrics;
  if (impl_ == nullptr) {
    return metrics;
  }
  reset(config);
  advance(SimTime::infinity(), trace);

  metrics = this->metrics();
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(impl_->steps_));
    trace->absorb(static_cast<std::uint64_t>(impl_->machine.current()));
  }
  return metrics;
}

std::size_t StatechartReplicationModel::advance(SimTime until,
                                                TraceRecorder* trace) {
  if (impl_ == nullptr) {
    return 0;
  }
  return run_until(impl_->scheduler(), impl_->clock(), until,
                   [&](const Event& event) {
                     if (trace != nullptr) {
                       trace->record(event.at, event.type, event.payload);
                     }
                     impl_->handlers().dispatch(event);
                   });
}

ReplicationMetrics StatechartReplicationModel::metrics() const {
  ReplicationMetrics metrics;
  if (impl_ == nullptr) {
    return metrics;
  }
  metrics.arrivals = impl_->steps_;
  metrics.departures = impl_->steps_;
  metrics.horizon_seconds =
      static_cast<double>(impl_->clock().now().as_ns()) * 1e-9;
  metrics.final_value = static_cast<double>(impl_->machine.current());
  return metrics;
}

std::string StatechartReplicationModel::current_state_name() const {
  if (impl_ == nullptr || impl_->machine.current() == kInvalidState) return {};
  return impl_->definition.state_name(impl_->machine.current());
}

std::uint64_t StatechartReplicationModel::step_count() const {
  return impl_ == nullptr ? 0 : impl_->steps_;
}

bool StatechartReplicationModel::done() const {
  return impl_ == nullptr || impl_->done_;
}

bool StatechartReplicationModel::has_pending_events() {
  return impl_ != nullptr && !impl_->scheduler().empty();
}

bool StatechartReplicationModel::dispatch_message(const std::string& port) {
  if (impl_ == nullptr || impl_->done_) return false;
  const auto events = impl_->message_events.find(port);
  if (events == impl_->message_events.end()) return false;
  for (const FsmEventId event : events->second) {
    const StateId from = impl_->machine.current();
    FsmContext context;
    if (!impl_->guard_allows(event) ||
        !impl_->machine.dispatch(impl_->definition, event, context)) {
      continue;
    }
    impl_->last_visited = from;
    ++impl_->steps_;
    impl_->emit_for(event);
    impl_->settle();
    impl_->reschedule_triggers(impl_->machine.current());
    return true;
  }
  return false;
}

std::vector<std::string> StatechartReplicationModel::take_emitted_messages() {
  if (impl_ == nullptr) return {};
  std::vector<std::string> messages;
  messages.swap(impl_->emitted_messages);
  return messages;
}

void StatechartReplicationModel::set_emission_callback(
    std::function<void()> callback) {
  if (impl_ != nullptr) impl_->emission_callback = std::move(callback);
}

StateId StatechartReplicationModel::last_state() const {
  return impl_ == nullptr ? kInvalidState : impl_->machine.current();
}

std::size_t StatechartReplicationModel::last_steps() const {
  return impl_ == nullptr ? 0 : static_cast<std::size_t>(impl_->steps_);
}

}  // namespace logicpilot

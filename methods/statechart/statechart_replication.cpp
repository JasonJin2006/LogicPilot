// StatechartReplicationModel implementation.
#include "statechart_replication.h"

#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/mm1.h"  // TimeSampler

namespace logicpilot {
namespace {

using ir::v2::Node;
using ir::v2::Statechart;
using ir::v2::Transition;
using ir::v2::TriggerKind_Message;
using ir::v2::TriggerKind_Timeout;

constexpr EventType kTimeoutEventType = 30;
constexpr FsmEventId kTimeoutFsmEvent = 0;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

struct StatechartReplicationModel::Impl {
  StateMachineDefinition definition;
  // Timeout duration per "from" state (only for timeout transitions).
  std::unordered_map<StateId, TimeSampler> timeout_after;
  StateId initial{kInvalidState};

  // Per-replication runtime state.
  Xoshiro256PlusPlus engine_{0};
  std::unique_ptr<BinaryHeapScheduler> scheduler_;
  SimulationClock clock_;
  EventHandlerRegistry handlers_;
  HandlerId timeout_handler_{0};
  StateMachine machine;
  ReplicationConfig config_;
  std::uint64_t steps_{0};
  bool done_{false};

  void on_timeout(const Event&) {
    FsmContext ctx;
    if (machine.dispatch(definition, kTimeoutFsmEvent, ctx)) {
      ++steps_;
    }
    schedule_next_timeout();
  }

  void schedule_next_timeout() {
    if (done_) {
      return;
    }
    if (config_.arrivals > 0 && steps_ >= config_.arrivals) {
      done_ = true;
      return;
    }
    const auto* transition =
        definition.find_transition(machine.current(), kTimeoutFsmEvent);
    if (transition == nullptr) {
      done_ = true;
      return;
    }
    const auto ta = timeout_after.find(machine.current());
    if (ta == timeout_after.end()) {
      done_ = true;
      return;
    }
    const double seconds = ta->second(engine_);
    scheduler_->schedule(clock_.now() + SimTime::from_ns(to_ns(seconds)),
                         kTimeoutEventType, timeout_handler_,
                         machine.current());
  }
};

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

  // Transitions: timeout -> fsm event 0, message -> per-port event id.
  std::unordered_map<std::string, FsmEventId> message_events;
  FsmEventId next_message_event = 1;
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
      FsmEventId event = kTimeoutFsmEvent;
      if (transition->trigger() == TriggerKind_Timeout) {
        // Carry the timeout duration for the "from" state. A distribution
        // takes precedence over the constant timeout_value (mirrors the
        // DEVS atomic path).
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
        impl_->timeout_after.emplace(from_it->second, std::move(sampler));
      } else if (transition->trigger() == TriggerKind_Message) {
        const std::string port =
            transition->message_port() != nullptr
                ? transition->message_port()->str()
                : "";
        auto it = message_events.find(port);
        if (it == message_events.end()) {
          it = message_events.emplace(port, next_message_event++).first;
        }
        event = it->second;
      } else {
        fail("statechart trigger kind is not supported yet "
             "(only Timeout and Message)");
        return;
      }
      impl_->definition.add_transition(from_it->second, event, to_it->second);
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
  impl_->machine = StateMachine{impl_->initial};
}

StatechartReplicationModel::~StatechartReplicationModel() = default;

ReplicationMetrics StatechartReplicationModel::run(
    const ReplicationConfig& config, TraceRecorder* trace) {
  ReplicationMetrics metrics;
  if (impl_ == nullptr) {
    return metrics;
  }

  impl_->config_ = config;
  impl_->steps_ = 0;
  impl_->done_ = false;
  impl_->machine = StateMachine{impl_->initial};
  impl_->engine_ = Xoshiro256PlusPlus{config.seed};
  impl_->scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  impl_->clock_ = SimulationClock{};
  impl_->handlers_ = EventHandlerRegistry{};
  impl_->timeout_handler_ =
      impl_->handlers_.add([this](const Event& event) {
        impl_->on_timeout(event);
      });
  impl_->schedule_next_timeout();

  run_until(*impl_->scheduler_, impl_->clock_, SimTime::infinity(),
            [&](const Event& event) {
              if (trace != nullptr) {
                trace->record(event.at, event.type, event.payload);
              }
              impl_->handlers_.dispatch(event);
            });

  metrics.arrivals = impl_->steps_;
  metrics.departures = impl_->steps_;
  metrics.horizon_seconds =
      static_cast<double>(impl_->clock_.now().as_ns()) * 1e-9;
  metrics.final_value =
      static_cast<double>(impl_->machine.current());
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(impl_->steps_));
    trace->absorb(static_cast<std::uint64_t>(impl_->machine.current()));
  }
  return metrics;
}

StateId StatechartReplicationModel::last_state() const {
  return impl_ == nullptr ? kInvalidState : impl_->machine.current();
}

std::size_t StatechartReplicationModel::last_steps() const {
  return impl_ == nullptr ? 0 : static_cast<std::size_t>(impl_->steps_);
}

}  // namespace logicpilot

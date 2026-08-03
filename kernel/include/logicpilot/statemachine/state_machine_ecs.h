// EnTT adapter for the table-driven state machine engine.
//
// state_machine.h stays dependency-free; this header bridges it to
// entt::registry so per-entity FsmStateComponent columns can be advanced in
// bulk with one call.
#pragma once

#include <cstddef>

#include <entt/entt.hpp>

#include "logicpilot/statemachine/state_machine.h"

namespace logicpilot {

// Dispatch `event` on every FsmStateComponent in the registry. Returns the
// number of transitions fired.
inline std::size_t dispatch_all(const StateMachineDefinition& def,
                                entt::registry& registry, FsmEventId event,
                                FsmContext& ctx) {
  std::size_t fired = 0;
  auto view = registry.view<FsmStateComponent>();
  view.each([&](FsmStateComponent& component) {
    StateMachine instance{component.current};
    if (instance.dispatch(def, event, ctx)) {
      ++fired;
    }
    component.current = instance.current();
  });
  return fired;
}

}  // namespace logicpilot

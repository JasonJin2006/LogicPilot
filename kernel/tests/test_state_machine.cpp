// Table-driven state machine tests: transition correctness + ECS batch.
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <entt/entt.hpp>

#include "logicpilot/statemachine/state_machine.h"
#include "logicpilot/statemachine/state_machine_ecs.h"

using namespace logicpilot;

namespace {

enum Events : FsmEventId {
  kSpawn = 1,
  kStartService = 2,
  kFinish = 3,
  kCancel = 4,
};

// Idle -> Active -> Served; Cancel anywhere -> Idle.
struct TrafficCounts {
  int started = 0;
  int finished = 0;
};

StateMachineDefinition make_definition() {
  StateMachineDefinition def;
  const StateId idle = def.add_state("idle");
  const StateId active = def.add_state("active");
  const StateId served = def.add_state("served");

  def.add_transition(idle, kSpawn, active, nullptr, [](FsmContext& ctx) {
    static_cast<TrafficCounts*>(ctx.user)->started++;
  });
  def.add_transition(active, kStartService, served, nullptr,
                     [](FsmContext& ctx) {
                       static_cast<TrafficCounts*>(ctx.user)->finished++;
                     });
  def.add_transition(active, kCancel, idle);
  def.add_transition(served, kCancel, idle);
  return def;
}

}  // namespace

TEST_CASE("StateMachine follows the transition table", "[statemachine]") {
  const StateMachineDefinition def = make_definition();
  TrafficCounts counts;
  FsmContext ctx{&counts};

  StateMachine machine{def.find_state("idle")};
  REQUIRE(machine.current() == def.find_state("idle"));

  REQUIRE(machine.dispatch(def, kSpawn, ctx));
  REQUIRE(machine.current() == def.find_state("active"));
  REQUIRE(counts.started == 1);

  REQUIRE(machine.dispatch(def, kStartService, ctx));
  REQUIRE(machine.current() == def.find_state("served"));
  REQUIRE(counts.finished == 1);

  REQUIRE(machine.dispatch(def, kCancel, ctx));
  REQUIRE(machine.current() == def.find_state("idle"));
}

TEST_CASE("Unknown events leave the machine untouched", "[statemachine]") {
  const StateMachineDefinition def = make_definition();
  FsmContext ctx;
  StateMachine machine{def.find_state("idle")};

  REQUIRE(!machine.dispatch(def, kFinish, ctx));  // no idle+finish row
  REQUIRE(machine.current() == def.find_state("idle"));
}

TEST_CASE("Guards can veto transitions", "[statemachine]") {
  StateMachineDefinition def;
  const StateId a = def.add_state("a");
  const StateId b = def.add_state("b");
  bool allowed = false;
  def.add_transition(a, 1, b, [&allowed](FsmContext&) { return allowed; });

  FsmContext ctx;
  StateMachine machine{a};
  REQUIRE(!machine.dispatch(def, 1, ctx));
  REQUIRE(machine.current() == a);

  allowed = true;
  REQUIRE(machine.dispatch(def, 1, ctx));
  REQUIRE(machine.current() == b);
}

TEST_CASE("Duplicate (state, event) rows keep the first entry",
          "[statemachine]") {
  StateMachineDefinition def;
  const StateId a = def.add_state("a");
  const StateId b = def.add_state("b");
  const StateId c = def.add_state("c");
  def.add_transition(a, 1, b);
  def.add_transition(a, 1, c);  // ignored
  REQUIRE(def.transition_count() == 1);

  FsmContext ctx;
  StateMachine machine{a};
  REQUIRE(machine.dispatch(def, 1, ctx));
  REQUIRE(machine.current() == b);
}

TEST_CASE("dispatch_all batch-advances a column of instances",
          "[statemachine]") {
  const StateMachineDefinition def = make_definition();
  TrafficCounts counts;
  FsmContext ctx{&counts};

  std::vector<FsmStateComponent> machines(5);
  for (FsmStateComponent& m : machines) {
    m.current = def.find_state("idle");
  }

  REQUIRE(dispatch_all(def, machines, kSpawn, ctx) == 5);
  REQUIRE(counts.started == 5);
  for (const FsmStateComponent& m : machines) {
    REQUIRE(m.current == def.find_state("active"));
  }
  REQUIRE(dispatch_all(def, machines, kFinish, ctx) == 0);  // no row
  REQUIRE(dispatch_all(def, machines, kStartService, ctx) == 5);
  REQUIRE(counts.finished == 5);
}

TEST_CASE("State machines hang off ECS entities and advance in bulk",
          "[statemachine][ecs]") {
  const StateMachineDefinition def = make_definition();
  TrafficCounts counts;
  FsmContext ctx{&counts};

  entt::registry registry;
  for (int i = 0; i < 4; ++i) {
    const entt::entity entity = registry.create();
    registry.emplace<FsmStateComponent>(entity, def.find_state("idle"));
  }

  REQUIRE(dispatch_all(def, registry, kSpawn, ctx) == 4);
  REQUIRE(counts.started == 4);
  auto view = registry.view<FsmStateComponent>();
  for (const auto& [entity, fsm] : view.each()) {
    (void)entity;
    REQUIRE(fsm.current == def.find_state("active"));
  }
}

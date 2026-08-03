// Agent runtime acceptance tests: EnTT lifecycle + SoA hot components.
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "logicpilot/agent/agent_runtime.h"
#include "logicpilot/agent/soa_agent_store.h"

using namespace logicpilot;
using Catch::Matchers::WithinAbs;

TEST_CASE("AgentRuntime creates and destroys entities", "[agent]") {
  AgentRuntime runtime;
  REQUIRE(runtime.agent_count() == 0);

  const AgentHandle a =
      runtime.create_agent(Position{1.0F, 2.0F}, Velocity{0.5F, -0.5F},
                           AgentState{AgentState::kActiveBit});
  const AgentHandle b = runtime.create_agent();
  REQUIRE(runtime.alive(a));
  REQUIRE(runtime.alive(b));
  REQUIRE(runtime.agent_count() == 2);

  // Hot components round-trip through the SoA store.
  REQUIRE_THAT(runtime.store().position(a.slot).x, WithinAbs(1.0, 1e-6));
  REQUIRE_THAT(runtime.store().position(a.slot).y, WithinAbs(2.0, 1e-6));
  REQUIRE(runtime.store().state(a.slot).has(AgentState::kActiveBit));

  runtime.destroy_agent(a);
  REQUIRE(!runtime.alive(a));
  REQUIRE(runtime.alive(b));
  REQUIRE(runtime.agent_count() == 1);

  // Destroying a stale handle twice is a safe no-op.
  runtime.destroy_agent(a);
  REQUIRE(runtime.agent_count() == 1);
}

TEST_CASE("SoA store recycles slots and keeps columns consistent",
          "[agent]") {
  SoaAgentStore store;
  const AgentSlot s0 = store.create({0, 0}, {1, 0}, {});
  const AgentSlot s1 = store.create({0, 0}, {0, 1}, {});
  store.destroy(s0);
  const AgentSlot s2 = store.create({5, 5}, {2, 2}, {});
  REQUIRE(s2 == s0);  // free-list recycle
  REQUIRE(store.alive(s1));
  REQUIRE(store.alive(s2));
  REQUIRE(store.size() == 2);

  store.set_position(s2, Position{7.0F, 8.0F});
  REQUIRE_THAT(store.position(s2).x, WithinAbs(7.0, 1e-6));
  REQUIRE_THAT(store.position(s2).y, WithinAbs(8.0, 1e-6));
}

TEST_CASE("Batch kinematics update streams SoA columns", "[agent]") {
  AgentRuntime runtime;
  const AgentHandle a =
      runtime.create_agent(Position{0.0F, 0.0F}, Velocity{2.0F, 1.0F});
  const AgentHandle b =
      runtime.create_agent(Position{10.0F, 5.0F}, Velocity{-1.0F, 0.5F});

  runtime.update_kinematics(1.5F);

  REQUIRE_THAT(runtime.store().position(a.slot).x, WithinAbs(3.0, 1e-5));
  REQUIRE_THAT(runtime.store().position(a.slot).y, WithinAbs(1.5, 1e-5));
  REQUIRE_THAT(runtime.store().position(b.slot).x, WithinAbs(8.5, 1e-5));
  REQUIRE_THAT(runtime.store().position(b.slot).y, WithinAbs(5.75, 1e-5));
}

namespace {
// Counting store proving the runtime only depends on IAgentStore.
class CountingStore final : public SoaAgentStore {
 public:
  AgentSlot create(Position pos, Velocity vel, AgentState state) override {
    ++creates_;
    return SoaAgentStore::create(pos, vel, state);
  }
  void destroy(AgentSlot slot) override {
    ++destroys_;
    SoaAgentStore::destroy(slot);
  }
  int creates_{0};
  int destroys_{0};
};
}  // namespace

TEST_CASE("AgentRuntime works through an injected IAgentStore", "[agent]") {
  auto store = std::make_unique<CountingStore>();
  CountingStore* observer = store.get();
  AgentRuntime runtime{std::move(store)};

  const AgentHandle a = runtime.create_agent();
  runtime.destroy_agent(a);
  REQUIRE(observer->creates_ == 1);
  REQUIRE(observer->destroys_ == 1);
}

TEST_CASE("EnTT registry carries cold components alongside SoA hot data",
          "[agent]") {
  struct Health {
    int value;
  };

  AgentRuntime runtime;
  const AgentHandle a = runtime.create_agent(Position{1, 1}, Velocity{1, 0});
  runtime.registry().emplace<Health>(a.entity, 42);

  REQUIRE(runtime.registry().get<Health>(a.entity).value == 42);
  REQUIRE(runtime.registry().valid(a.entity));

  // The AgentLink component ties entity -> SoA slot.
  REQUIRE(runtime.registry().get<AgentLink>(a.entity).slot == a.slot);
}

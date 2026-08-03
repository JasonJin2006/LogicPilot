// AgentRuntime - EnTT-backed entity lifecycle + SoA hot components.
//
// Split-brain layout by design:
//   * EnTT registry owns entity identity and cold/rarely-touched components
//     (behaviors, tags, state-machine instances, ...).
//   * The hot kinematic components (Position/Velocity/AgentState) live in the
//     IAgentStore column layout for batch updates (SIMD/GPU ready).
// AgentHandle ties the two halves together; the store is injectable so the
// whole hot layout can be replaced (IAgentStore keeps that option open).
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

#include <entt/entt.hpp>

#include "logicpilot/agent/components.h"
#include "logicpilot/agent/i_agent_store.h"
#include "logicpilot/agent/soa_agent_store.h"

namespace logicpilot {

// Links an EnTT entity to its SoA hot-component slot.
struct AgentLink {
  AgentSlot slot{kInvalidAgentSlot};
};

// Stable handle returned to model code. The version tag detects stale handles
// after destroy() (EnTT recycles entity slots with a version bump).
struct AgentHandle {
  entt::entity entity{entt::null};
  AgentSlot slot{kInvalidAgentSlot};

  [[nodiscard]] bool valid() const {
    return entity != entt::null && slot != kInvalidAgentSlot;
  }
};

class AgentRuntime {
 public:
  // Default construction uses the built-in SoA store.
  AgentRuntime() : store_{std::make_unique<SoaAgentStore>()} {}

  // Inject a custom hot-component store (keeps the whole-store replacement
  // option; the runtime only talks to the IAgentStore interface).
  explicit AgentRuntime(std::unique_ptr<IAgentStore> store)
      : store_{std::move(store)} {}

  AgentRuntime(const AgentRuntime&) = delete;
  AgentRuntime& operator=(const AgentRuntime&) = delete;

  // Entity lifecycle ---------------------------------------------------------
  AgentHandle create_agent(Position pos = {}, Velocity vel = {},
                           AgentState state = {}) {
    const entt::entity entity = registry_.create();
    const AgentSlot slot = store_->create(pos, vel, state);
    registry_.emplace<AgentLink>(entity, slot);
    ++agent_count_;
    return AgentHandle{entity, slot};
  }

  void destroy_agent(AgentHandle handle) {
    if (!alive(handle)) {
      return;
    }
    store_->destroy(handle.slot);
    registry_.destroy(handle.entity);
    --agent_count_;
  }

  [[nodiscard]] bool alive(const AgentHandle& handle) const {
    return handle.valid() && registry_.valid(handle.entity) &&
           store_->alive(handle.slot);
  }

  [[nodiscard]] std::size_t agent_count() const { return agent_count_; }

  // Accessors ----------------------------------------------------------------
  [[nodiscard]] entt::registry& registry() { return registry_; }
  [[nodiscard]] const entt::registry& registry() const { return registry_; }
  [[nodiscard]] IAgentStore& store() { return *store_; }
  [[nodiscard]] const IAgentStore& store() const { return *store_; }

  // Hot-path batch update: pos += vel * dt across all live agents. Runs over
  // raw SoA columns (no EnTT iteration, no virtual per-agent dispatch).
  void update_kinematics(float dt) { store_->integrate(agent_count_, dt); }

  // Tear everything down (registry + store stay usable afterwards).
  void clear() {
    registry_.clear();
    store_ = std::make_unique<SoaAgentStore>();
    agent_count_ = 0;
  }

 private:
  entt::registry registry_;
  std::unique_ptr<IAgentStore> store_;
  std::size_t agent_count_{0};
};

}  // namespace logicpilot

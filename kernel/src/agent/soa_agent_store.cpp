// SoaAgentStore implementation.
#include "logicpilot/agent/soa_agent_store.h"

#include <cassert>

namespace logicpilot {

void SoaAgentStore::reserve(std::size_t n) {
  xs_.reserve(n);
  ys_.reserve(n);
  vxs_.reserve(n);
  vys_.reserve(n);
  states_.reserve(n);
  alive_.reserve(n);
  next_free_.reserve(n);
}

AgentSlot SoaAgentStore::create(Position pos, Velocity vel, AgentState state) {
  AgentSlot slot;
  if (free_head_ != kInvalidAgentSlot) {
    slot = free_head_;
    free_head_ = next_free_[slot];
  } else {
    slot = static_cast<AgentSlot>(xs_.size());
    xs_.push_back(0.0F);
    ys_.push_back(0.0F);
    vxs_.push_back(0.0F);
    vys_.push_back(0.0F);
    states_.push_back(0u);
    alive_.push_back(0);
    next_free_.push_back(kInvalidAgentSlot);
  }
  xs_[slot] = pos.x;
  ys_[slot] = pos.y;
  vxs_[slot] = vel.vx;
  vys_[slot] = vel.vy;
  states_[slot] = state.bits;
  alive_[slot] = 1;
  ++size_;
  return slot;
}

void SoaAgentStore::destroy(AgentSlot slot) {
  assert(slot < xs_.size() && "slot out of range");
  assert(alive_[slot] != 0 && "double destroy");
  alive_[slot] = 0;
  next_free_[slot] = free_head_;
  free_head_ = slot;
  --size_;
}

bool SoaAgentStore::alive(AgentSlot slot) const {
  return slot < xs_.size() && alive_[slot] != 0;
}

void SoaAgentStore::set_position(AgentSlot slot, Position pos) {
  assert(alive(slot));
  xs_[slot] = pos.x;
  ys_[slot] = pos.y;
}

void SoaAgentStore::set_velocity(AgentSlot slot, Velocity vel) {
  assert(alive(slot));
  vxs_[slot] = vel.vx;
  vys_[slot] = vel.vy;
}

void SoaAgentStore::set_state(AgentSlot slot, AgentState state) {
  assert(alive(slot));
  states_[slot] = state.bits;
}

Position SoaAgentStore::position(AgentSlot slot) const {
  assert(alive(slot));
  return Position{xs_[slot], ys_[slot]};
}

Velocity SoaAgentStore::velocity(AgentSlot slot) const {
  assert(alive(slot));
  return Velocity{vxs_[slot], vys_[slot]};
}

AgentState SoaAgentStore::state(AgentSlot slot) const {
  assert(alive(slot));
  return AgentState{states_[slot]};
}

void SoaAgentStore::integrate(std::size_t count_hint, float dt) {
  (void)count_hint;
  const std::size_t n = xs_.size();
  float* x = xs_.data();
  float* y = ys_.data();
  const float* vx = vxs_.data();
  const float* vy = vys_.data();
  const std::uint8_t* live = alive_.data();
  // Compiler auto-vectorizes this unit-stride column loop.
  for (std::size_t s = 0; s < n; ++s) {
    if (live[s] != 0) {
      x[s] += vx[s] * dt;
      y[s] += vy[s] * dt;
    }
  }
}

}  // namespace logicpilot

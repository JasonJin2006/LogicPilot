// SoaAgentStore - structure-of-arrays hot component store.
//
// One contiguous std::vector per component field (x, y, vx, vy, state).
// Slot indices are dense and stable; destroyed slots join a free list and
// are recycled by the next create(). The layout is deliberately SIMD/GPU
// friendly: batch kernels stream one column at a time with unit stride.
#pragma once

#include <cstdint>
#include <vector>

#include "logicpilot/agent/i_agent_store.h"

namespace logicpilot {

class SoaAgentStore : public IAgentStore {
 public:
  SoaAgentStore() = default;
  explicit SoaAgentStore(std::size_t reserve_slots) { reserve(reserve_slots); }

  AgentSlot create(Position pos, Velocity vel, AgentState state) override;
  void destroy(AgentSlot slot) override;
  [[nodiscard]] bool alive(AgentSlot slot) const override;
  [[nodiscard]] std::size_t size() const override { return size_; }
  [[nodiscard]] std::size_t capacity() const override { return xs_.size(); }

  void set_position(AgentSlot slot, Position pos) override;
  void set_velocity(AgentSlot slot, Velocity vel) override;
  void set_state(AgentSlot slot, AgentState state) override;
  [[nodiscard]] Position position(AgentSlot slot) const override;
  [[nodiscard]] Velocity velocity(AgentSlot slot) const override;
  [[nodiscard]] AgentState state(AgentSlot slot) const override;

  [[nodiscard]] float* xs() override { return xs_.data(); }
  [[nodiscard]] float* ys() override { return ys_.data(); }
  [[nodiscard]] float* vxs() override { return vxs_.data(); }
  [[nodiscard]] float* vys() override { return vys_.data(); }
  [[nodiscard]] std::uint32_t* states() override { return states_.data(); }

  // Tight column loop without virtual alive() dispatch.
  void integrate(std::size_t count_hint, float dt) override;

  // Pre-provision storage so steady-state create/destroy never allocates.
  void reserve(std::size_t n);

 private:
  // Column data.
  std::vector<float> xs_;
  std::vector<float> ys_;
  std::vector<float> vxs_;
  std::vector<float> vys_;
  std::vector<std::uint32_t> states_;
  // Per-slot liveness flags (1 = live). Separate from data columns so batch
  // kernels never touch them on the hot loop.
  std::vector<std::uint8_t> alive_;
  // Free-list links for dead slots (valid only when !alive_[slot]).
  std::vector<std::uint32_t> next_free_;

  std::uint32_t free_head_{kInvalidAgentSlot};
  std::size_t size_{0};
};

}  // namespace logicpilot

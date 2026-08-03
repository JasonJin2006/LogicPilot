// IAgentStore - hot-component storage abstraction.
//
// The agent runtime keeps its hot components (Position / Velocity /
// AgentState) outside the EnTT registry in a column store tuned for batch
// updates. IAgentStore isolates the runtime from the concrete layout so the
// store can be swapped wholesale later (GPU-backed buffer, sparse set, ...)
// without touching AgentRuntime or model code.
#pragma once

#include <cstddef>
#include <cstdint>

#include "logicpilot/agent/components.h"

namespace logicpilot {

// Dense slot index into the column store. Stable until destroy().
using AgentSlot = std::uint32_t;
inline constexpr AgentSlot kInvalidAgentSlot = ~AgentSlot{0};

class IAgentStore {
 public:
  virtual ~IAgentStore() = default;

  // Slot lifecycle. create() reuses freed slots via an internal free list.
  virtual AgentSlot create(Position pos, Velocity vel, AgentState state) = 0;
  virtual void destroy(AgentSlot slot) = 0;
  [[nodiscard]] virtual bool alive(AgentSlot slot) const = 0;
  [[nodiscard]] virtual std::size_t size() const = 0;
  [[nodiscard]] virtual std::size_t capacity() const = 0;

  // Element access (bounds-checked in debug).
  virtual void set_position(AgentSlot slot, Position pos) = 0;
  virtual void set_velocity(AgentSlot slot, Velocity vel) = 0;
  virtual void set_state(AgentSlot slot, AgentState state) = 0;
  [[nodiscard]] virtual Position position(AgentSlot slot) const = 0;
  [[nodiscard]] virtual Velocity velocity(AgentSlot slot) const = 0;
  [[nodiscard]] virtual AgentState state(AgentSlot slot) const = 0;

  // Raw column access for SIMD / batch kernels. Columns are contiguous and
  // indexed by slot; slots beyond capacity() are invalid. Callers must not
  // reallocate (any mutating call may grow the columns).
  [[nodiscard]] virtual float* xs() = 0;
  [[nodiscard]] virtual float* ys() = 0;
  [[nodiscard]] virtual float* vxs() = 0;
  [[nodiscard]] virtual float* vys() = 0;
  [[nodiscard]] virtual std::uint32_t* states() = 0;

  // Batch Euler step: pos += vel * dt for every live slot. Implementations
  // may vectorize; semantics must match the scalar loop bit-for-bit.
  virtual void integrate(std::size_t count_hint, float dt) {
    // Default scalar fallback (count_hint unused by the base).
    (void)count_hint;
    float* x = xs();
    float* y = ys();
    const float* vx = vxs();
    const float* vy = vys();
    for (AgentSlot s = 0; s < capacity(); ++s) {
      if (alive(s)) {
        x[s] += vx[s] * dt;
        y[s] += vy[s] * dt;
      }
    }
  }
};

}  // namespace logicpilot

// Hot-path agent components (SoA column store payload).
//
// All components are plain-old-data: trivially copyable, no padding
// surprises, stable layout. Floats (not doubles) keep columns SIMD/GPU
// friendly - 4x f32 per position+velocity pair maps onto a single 128-bit
// register. The SoA store (soa_agent_store.h) holds one contiguous column
// per field, never an array of these structs.
#pragma once

#include <cstdint>

namespace logicpilot {

struct Position {
  float x{0.0F};
  float y{0.0F};
};

struct Velocity {
  float vx{0.0F};
  float vy{0.0F};
};

// Compact per-agent flag word. Individual bits are model-defined; the kernel
// reserves the top byte for runtime bookkeeping.
struct AgentState {
  std::uint32_t bits{0};

  static constexpr std::uint32_t kActiveBit = 1u << 0;
  static constexpr std::uint32_t kVisibleBit = 1u << 1;
  static constexpr std::uint32_t kRuntimeReservedMask = 0xFF000000u;

  constexpr bool has(std::uint32_t mask) const { return (bits & mask) != 0; }
  constexpr void set(std::uint32_t mask) { bits |= mask; }
  constexpr void clear(std::uint32_t mask) { bits &= ~mask; }

  constexpr bool operator==(const AgentState&) const = default;
};

static_assert(sizeof(Position) == 8, "Position must stay 2x f32");
static_assert(sizeof(Velocity) == 8, "Velocity must stay 2x f32");
static_assert(sizeof(AgentState) == 4, "AgentState must stay one u32 word");

}  // namespace logicpilot

// DEVS-lite port / event vocabulary.
//
// Ports are interned to 32-bit ids by the executor (cold path); the hot path
// only moves PortEvent values. Payload stays an inline u64 so port events fit
// the kernel Event without heap allocation.
#pragma once

#include <cstdint>

namespace logicpilot {

using PortId = std::uint32_t;
inline constexpr PortId kInvalidPort = ~PortId{0};

struct PortEvent {
  PortId port{kInvalidPort};
  std::uint64_t payload{0};

  constexpr bool operator==(const PortEvent&) const = default;
};

}  // namespace logicpilot

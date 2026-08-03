// Event representation for the discrete-event scheduler.
//
// Design note (hot-path cost): events do NOT carry std::function. Each event
// holds a `handler` index into an EventHandlerRegistry that is populated once
// at model-setup time (cold path). Dispatch on the hot path is a single
// indirect call through a contiguous table - no per-event heap closure, no
// type-erasure vtable chase, and the Event itself is a cheap 32-byte value
// that moves by copy.
#pragma once

#include <cstdint>

#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

using EventType = std::uint32_t;   // Model-defined tag (e.g. "timer fired").
using HandlerId = std::uint32_t;   // Index into the handler registry.
using EventId = std::uint64_t;     // Slot identity for cancellation tokens.

inline constexpr EventId kInvalidEventId = ~EventId{0};

// Opaque handle returned by schedule(); used for lazy cancellation.
struct EventToken {
  EventId id{kInvalidEventId};
  std::uint32_t generation{0};

  [[nodiscard]] constexpr bool valid() const { return id != kInvalidEventId; }

  constexpr bool operator==(const EventToken&) const = default;
};

struct Event {
  SimTime at{};          // Delivery timestamp (simulation time).
  EventType type{0};     // Model-defined tag, free to use by handlers.
  HandlerId handler{0};  // Registry index that consumes this event.
  std::uint64_t payload{0};  // Inline scalar payload (entity id, index, ...).

  constexpr bool operator==(const Event&) const = default;
};

static_assert(sizeof(Event) <= 32, "Event must stay a compact value type");

}  // namespace logicpilot

// IEventScheduler - event queue abstraction.
//
// Implementations must provide deterministic ordering: events pop in
// (timestamp, arrival-sequence) order so that equal-timestamp events are
// delivered FIFO. Calendar-queue implementations are reserved for a later
// phase; the interface is intentionally implementation-neutral.
#pragma once

#include <cstddef>

#include "logicpilot/core/scheduler/event.h"

namespace logicpilot {

class IEventScheduler {
 public:
  virtual ~IEventScheduler() = default;

  // Insert an event; returns a token usable for cancel().
  virtual EventToken schedule(SimTime at, EventType type, HandlerId handler,
                              std::uint64_t payload = 0) = 0;

  // Remove and return the earliest live event. `pop_next` requires the queue
  // to be non-empty; `try_pop_next` reports emptiness instead of throwing.
  virtual Event pop_next() = 0;
  virtual bool try_pop_next(Event& out) = 0;

  // Mark a pending event cancelled (lazy removal). Returns true iff the token
  // identified a still-pending event. Double-cancel and stale tokens are safe
  // and return false.
  virtual bool cancel(EventToken token) = 0;

  // Number of live (non-cancelled) pending events.
  [[nodiscard]] virtual std::size_t size() const = 0;
  [[nodiscard]] virtual bool empty() const = 0;

  // Timestamp of the earliest live event; SimTime::infinity() when empty.
  // May physically evict cancelled heap tops (lazy deletion).
  virtual SimTime peek_time() = 0;

  // Pre-provision storage for `n` concurrently pending events so that the
  // schedule/pop hot path performs no dynamic allocation.
  virtual void reserve(std::size_t n) = 0;
};

}  // namespace logicpilot

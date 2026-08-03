// BinaryHeapScheduler - the Phase 1 reference event queue.
//
// Implementation notes:
//  * Ordering: binary min-heap keyed on (timestamp, arrival-sequence), giving
//    deterministic FIFO delivery for equal timestamps (ADR-0007 replay).
//  * Storage: event slots live in a SlabPool. After reserve() the
//    schedule/pop/cancel hot path performs zero system allocations.
//  * Cancellation: lazy deletion. cancel() only flips a liveness flag; dead
//    slots are physically evicted when they surface at the heap root
//    (pop/peek). Tokens carry a per-slot generation so stale handles are
//    detected safely.
//  * Calendar queues: intentionally NOT implemented in Phase 1a (interface is
//    ready; a CalendarQueueScheduler will implement IEventScheduler later).
#pragma once

#include <cstdint>
#include <vector>

#include "logicpilot/core/memory/slab.h"
#include "logicpilot/core/scheduler/i_event_scheduler.h"

namespace logicpilot {

class BinaryHeapScheduler final : public IEventScheduler {
 public:
  BinaryHeapScheduler() = default;
  explicit BinaryHeapScheduler(std::size_t reserve_slots) {
    reserve(reserve_slots);
  }

  EventToken schedule(SimTime at, EventType type, HandlerId handler,
                      std::uint64_t payload = 0) override;
  Event pop_next() override;
  bool try_pop_next(Event& out) override;
  bool cancel(EventToken token) override;

  [[nodiscard]] std::size_t size() const override { return live_count_; }
  [[nodiscard]] bool empty() const override { return live_count_ == 0; }

  SimTime peek_time() override;
  void reserve(std::size_t n) override;

  // Diagnostics (tests / profiling): raw heap entries including dead ones.
  [[nodiscard]] std::size_t heap_entries() const { return heap_.size(); }
  // Slab chunks backing the slot pool; stable once reserve() covers the
  // working set (zero-allocation hot-path evidence).
  [[nodiscard]] std::size_t pool_chunks() const { return pool_.chunk_count(); }

 private:
  struct Slot {
    Event event{};
    std::uint64_t seq{0};
    std::uint32_t generation{0};
    bool alive{false};
  };

  static bool before(const Slot* a, const Slot* b);
  void sift_up(std::size_t i);
  void sift_down(std::size_t i);
  Slot* evict_root();  // physically remove the root slot from the heap
  void cleanup_top();  // evict dead roots until root is live or heap empty

  SlabPool<Slot> pool_;
  std::vector<Slot*> heap_;
  std::size_t live_count_{0};
  std::uint64_t seq_counter_{0};
};

}  // namespace logicpilot

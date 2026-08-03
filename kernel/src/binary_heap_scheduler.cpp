// BinaryHeapScheduler implementation - see the header for design notes.
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"

#include <cassert>
#include <new>
#include <stdexcept>
#include <utility>

namespace logicpilot {

EventToken BinaryHeapScheduler::schedule(SimTime at, EventType type,
                                         HandlerId handler,
                                         std::uint64_t payload) {
  // Grab a slot without losing the persisted generation counter: the slab
  // keeps block bytes intact across reuse, so the counter survives.
  void* mem = pool_.allocate();
  auto* slot = static_cast<Slot*>(mem);
  const std::uint32_t generation = slot->generation + 1;
  new (slot) Slot{};
  slot->generation = generation;

  slot->event = Event{.at = at, .type = type, .handler = handler, .payload = payload};
  slot->seq = seq_counter_++;
  slot->alive = true;

  heap_.push_back(slot);
  sift_up(heap_.size() - 1);
  ++live_count_;

  return EventToken{.id = reinterpret_cast<EventId>(slot),
                    .generation = generation};
}

Event BinaryHeapScheduler::pop_next() {
  Event out{};
  if (!try_pop_next(out)) {
    throw std::logic_error("BinaryHeapScheduler::pop_next on empty queue");
  }
  return out;
}

bool BinaryHeapScheduler::try_pop_next(Event& out) {
  cleanup_top();
  if (heap_.empty()) {
    return false;
  }
  Slot* slot = evict_root();
  assert(slot->alive);

  out = slot->event;
  --live_count_;
  // Invalidate outstanding tokens for this slot: bumping the persisted
  // generation counter now (the slab keeps block bytes across reuse) makes
  // every pre-pop token stale the moment the slot returns to the pool.
  ++slot->generation;
  pool_.deallocate(slot);
  return true;
}

bool BinaryHeapScheduler::cancel(EventToken token) {
  if (!token.valid()) {
    return false;
  }
  auto* slot = reinterpret_cast<Slot*>(static_cast<std::uintptr_t>(token.id));
  // Stale generation => the slot was already recycled by a newer schedule().
  if (slot->generation != token.generation || !slot->alive) {
    return false;
  }
  slot->alive = false;  // lazy deletion: the heap entry stays until it pops
  --live_count_;
  return true;
}

SimTime BinaryHeapScheduler::peek_time() {
  cleanup_top();
  if (heap_.empty()) {
    return SimTime::infinity();
  }
  return heap_.front()->event.at;
}

void BinaryHeapScheduler::reserve(std::size_t n) {
  pool_.reserve(n);
  heap_.reserve(n);
}

// ---------------------------------------------------------------------------
// Heap mechanics (min-heap on (at, seq)).
// ---------------------------------------------------------------------------

bool BinaryHeapScheduler::before(const Slot* a, const Slot* b) {
  if (a->event.at != b->event.at) {
    return a->event.at < b->event.at;
  }
  return a->seq < b->seq;  // deterministic FIFO tie-break
}

void BinaryHeapScheduler::sift_up(std::size_t i) {
  while (i > 0) {
    const std::size_t parent = (i - 1) / 2;
    if (!before(heap_[i], heap_[parent])) {
      break;
    }
    std::swap(heap_[i], heap_[parent]);
    i = parent;
  }
}

void BinaryHeapScheduler::sift_down(std::size_t i) {
  const std::size_t n = heap_.size();
  for (;;) {
    std::size_t best = i;
    const std::size_t left = 2 * i + 1;
    const std::size_t right = 2 * i + 2;
    if (left < n && before(heap_[left], heap_[best])) {
      best = left;
    }
    if (right < n && before(heap_[right], heap_[best])) {
      best = right;
    }
    if (best == i) {
      break;
    }
    std::swap(heap_[i], heap_[best]);
    i = best;
  }
}

BinaryHeapScheduler::Slot* BinaryHeapScheduler::evict_root() {
  assert(!heap_.empty());
  Slot* root = heap_.front();
  Slot* last = heap_.back();
  heap_.pop_back();
  if (!heap_.empty()) {
    heap_.front() = last;
    sift_down(0);
  }
  return root;
}

void BinaryHeapScheduler::cleanup_top() {
  // Cancelled events are physically removed only when they reach the root
  // (lazy deletion); live_count_ was already decremented by cancel().
  while (!heap_.empty() && !heap_.front()->alive) {
    pool_.deallocate(evict_root());
  }
}

}  // namespace logicpilot

// Arena - monotonic (bump) allocator.
//
// A single backing block is allocated up front; individual allocations are
// pointer bumps and never touch the system allocator. This is the backbone of
// the "zero new/malloc on hot paths" rule: scratch buffers, temporary frames
// and per-run state come from an arena and are released in one shot.
#pragma once

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <utility>

namespace logicpilot {

class Arena {
 public:
  explicit Arena(std::size_t capacity)
      : block_{std::make_unique<std::byte[]>(capacity)},
        capacity_{capacity},
        backing_allocations_{capacity > 0 ? std::size_t{1} : std::size_t{0}} {}

  Arena(const Arena&) = delete;
  Arena& operator=(const Arena&) = delete;

  // Bump-allocate `bytes` with `align`. Returns nullptr only when the arena
  // is exhausted (allocation failure is a caller bug in hot paths).
  [[nodiscard]] std::byte* allocate(std::size_t bytes,
                                    std::size_t align = alignof(std::max_align_t)) {
    // The rounding trick below requires a power-of-two alignment (all
    // callers pass alignof(T), which always is one).
    assert((align & (align - 1)) == 0 && "alignment must be a power of two");
    const std::uintptr_t base = reinterpret_cast<std::uintptr_t>(block_.get());
    const std::uintptr_t raw = base + offset_;
    const std::uintptr_t aligned = (raw + align - 1) & ~(align - 1);
    const std::size_t new_offset = (aligned - base) + bytes;
    if (new_offset > capacity_) {
      return nullptr;
    }
    offset_ = new_offset;
    return reinterpret_cast<std::byte*>(aligned);
  }

  template <typename T, typename... Args>
  [[nodiscard]] T* construct(Args&&... args) {
    std::byte* mem = allocate(sizeof(T), alignof(T));
    if (mem == nullptr) {
      return nullptr;
    }
    return new (mem) T{std::forward<Args>(args)...};
  }

  // Rewind the arena; every byte becomes reusable. O(1).
  void reset() { offset_ = 0; }

  [[nodiscard]] std::size_t used() const { return offset_; }
  [[nodiscard]] std::size_t capacity() const { return capacity_; }
  [[nodiscard]] std::size_t remaining() const { return capacity_ - offset_; }

  // How many times a backing block was obtained from the system allocator.
  // After construction this is 1 forever: the observable proof that steady
  // state allocations are allocation-free.
  [[nodiscard]] std::size_t backing_allocation_count() const {
    return backing_allocations_;
  }

 private:
  std::unique_ptr<std::byte[]> block_;
  std::size_t capacity_{0};
  std::size_t offset_{0};
  std::size_t backing_allocations_{0};
};

}  // namespace logicpilot

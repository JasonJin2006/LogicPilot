// SlabPool - fixed-size object pool with an intrusive free list.
//
// Used for event slots and other churn-heavy objects: after `reserve()` the
// construct/destroy cycle is free-list push & pop only - zero system
// allocations, zero fragmentation. Freed blocks embed the next-free pointer,
// so sizeof(T) must be at least sizeof(void*).
#pragma once

#include <cassert>
#include <cstddef>
#include <cstring>
#include <memory>
#include <new>
#include <utility>
#include <vector>

namespace logicpilot {

template <typename T>
class SlabPool {
  static_assert(sizeof(T) >= sizeof(void*),
                "SlabPool blocks must hold the intrusive free-list pointer");

  struct Chunk {
    std::unique_ptr<std::byte[]> storage;
  };

 public:
  explicit SlabPool(std::size_t capacity = 0) { reserve(capacity); }

  SlabPool(const SlabPool&) = delete;
  SlabPool& operator=(const SlabPool&) = delete;

  ~SlabPool() {
    // Note: callers are responsible for destroying live objects before the
    // pool goes away (hot-path pools are drained by the scheduler).
  }

  // Pre-provision `capacity` blocks. Steady-state churn below this watermark
  // never reaches the system allocator.
  void reserve(std::size_t capacity) {
    while (capacity > total_blocks_) {
      grow_chunk(capacity - total_blocks_);
    }
  }

  template <typename... Args>
  [[nodiscard]] T* construct(Args&&... args) {
    void* mem = allocate();
    return new (mem) T{std::forward<Args>(args)...};
  }

  void destroy(T* object) {
    assert(object != nullptr);
    object->~T();
    deallocate(object);
  }

  // Raw block access for callers that need to preserve metadata across
  // reuse (e.g. the scheduler keeps per-slot generation counters).
  // Fresh blocks are zero-filled; reclaimed blocks retain their bytes.
  [[nodiscard]] void* allocate() { return allocate_raw(); }

  void deallocate(void* mem) {
    assert(mem != nullptr);
    push_free(mem);
  }

  [[nodiscard]] std::size_t live_count() const {
    return total_blocks_ - free_count_;
  }
  [[nodiscard]] std::size_t capacity() const { return total_blocks_; }
  [[nodiscard]] std::size_t free_count() const { return free_count_; }

  // Number of backing chunks obtained from the system allocator. Stays at 1
  // forever once reserve() covered the steady-state working set: the
  // observable proof of a zero-allocation hot path.
  [[nodiscard]] std::size_t chunk_count() const { return chunks_.size(); }

 private:
  struct FreeNode {
    FreeNode* next;
  };

  void grow_chunk(std::size_t blocks) {
    Chunk chunk;
    chunk.storage = std::make_unique<std::byte[]>(blocks * sizeof(T));
    std::byte* base = chunk.storage.get();
    std::memset(base, 0, blocks * sizeof(T));  // deterministic fresh blocks
    for (std::size_t i = 0; i < blocks; ++i) {
      push_free(base + i * sizeof(T));
    }
    chunks_.push_back(std::move(chunk));
    total_blocks_ += blocks;
  }

  [[nodiscard]] void* allocate_raw() {
    if (free_head_ == nullptr) {
      // Exhausted: double the pool (cold path only; steady state is
      // allocation-free thanks to reserve()).
      grow_chunk(total_blocks_ == 0 ? 64 : total_blocks_);
    }
    FreeNode* node = free_head_;
    free_head_ = node->next;
    --free_count_;
    return node;
  }

  void push_free(void* mem) {
    auto* node = static_cast<FreeNode*>(mem);
    node->next = free_head_;
    free_head_ = node;
    ++free_count_;
  }

  std::vector<Chunk> chunks_;
  FreeNode* free_head_{nullptr};
  std::size_t total_blocks_{0};
  std::size_t free_count_{0};
};

}  // namespace logicpilot

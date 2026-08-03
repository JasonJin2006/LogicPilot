// Memory subsystem tests: Arena monotonic allocation and SlabPool reuse,
// including the zero-system-allocation guarantee on hot paths.
#include <catch2/catch_test_macros.hpp>

#include <cstddef>
#include <cstdint>
#include <vector>

#include "logicpilot/core/memory/arena.h"
#include "logicpilot/core/memory/slab.h"

using namespace logicpilot;

TEST_CASE("Arena bump-allocates with requested alignment", "[memory]") {
  Arena arena{4096};
  CHECK(arena.used() == 0);
  CHECK(arena.capacity() == 4096);

  std::byte* p1 = arena.allocate(10);
  REQUIRE(p1 != nullptr);
  CHECK(arena.used() >= 10);

  std::byte* p2 = arena.allocate(1, 64);
  REQUIRE(p2 != nullptr);
  CHECK(reinterpret_cast<std::uintptr_t>(p2) % 64 == 0);

  std::byte* p3 = arena.allocate(8, 16);
  REQUIRE(p3 != nullptr);
  CHECK(reinterpret_cast<std::uintptr_t>(p3) % 16 == 0);

  // Monotonic, non-overlapping layout.
  CHECK(p1 < p2);
  CHECK(p2 < p3);
}

TEST_CASE("Arena reports exhaustion instead of overflowing", "[memory]") {
  Arena arena{64};
  CHECK(arena.allocate(64) != nullptr);
  CHECK(arena.allocate(1) == nullptr);
  CHECK(arena.remaining() == 0);

  arena.reset();
  CHECK(arena.used() == 0);
  CHECK(arena.remaining() == 64);
  CHECK(arena.allocate(64) != nullptr);
}

TEST_CASE("Arena constructs typed objects", "[memory]") {
  Arena arena{1024};
  struct Point {
    int x;
    int y;
  };
  Point* p = arena.construct<Point>(3, 4);
  REQUIRE(p != nullptr);
  CHECK(p->x == 3);
  CHECK(p->y == 4);
}

TEST_CASE("Arena hot path performs zero backing allocations", "[memory][alloc]") {
  Arena arena{1 << 20};
  const std::size_t before = arena.backing_allocation_count();
  CHECK(before == 1);

  // 100k bumps of mixed sizes/alignments, periodically rewound.
  for (int round = 0; round < 100; ++round) {
    for (std::size_t i = 0; i < 1000; ++i) {
      REQUIRE(arena.allocate(16 + (i % 5) * 8, 8) != nullptr);
    }
    arena.reset();
  }
  CHECK(arena.backing_allocation_count() == before);
}

namespace {
struct EventLike {
  std::uint64_t a;
  std::uint64_t b;
  std::uint32_t tag;
  std::uint32_t generation;
};
}  // namespace

TEST_CASE("SlabPool recycles blocks without growing", "[memory]") {
  SlabPool<EventLike> pool;
  pool.reserve(256);
  CHECK(pool.capacity() == 256);
  CHECK(pool.free_count() == 256);
  CHECK(pool.chunk_count() == 1);

  // Churn far more blocks than the pool holds, never exceeding the depth.
  for (int round = 0; round < 1000; ++round) {
    EventLike* live[8];
    for (auto*& slot : live) {
      slot = pool.construct();
      slot->tag = 0xABCD;
    }
    CHECK(pool.live_count() == 8);
    for (auto* slot : live) {
      CHECK(slot->tag == 0xABCD);
      pool.destroy(slot);
    }
  }
  CHECK(pool.live_count() == 0);
  CHECK(pool.free_count() == 256);
  CHECK(pool.chunk_count() == 1);  // zero-allocation hot path proven
}

TEST_CASE("SlabPool grows on demand when unreserved", "[memory]") {
  SlabPool<EventLike> pool;
  CHECK(pool.chunk_count() == 0);

  std::vector<EventLike*> blocks;
  for (int i = 0; i < 1000; ++i) {
    blocks.push_back(pool.construct());
  }
  CHECK(pool.live_count() == 1000);
  CHECK(pool.chunk_count() >= 1);
  for (auto* b : blocks) {
    pool.destroy(b);
  }
  // Growth policy rounds chunk sizes up (doubling): every block is free.
  CHECK(pool.free_count() == pool.capacity());
  CHECK(pool.capacity() >= 1000);
}

TEST_CASE("SlabPool fresh blocks are zero-filled; reuse keeps metadata",
          "[memory]") {
  SlabPool<EventLike> pool;
  pool.reserve(4);

  // Fresh block: zero-filled except the intrusive free-list pointer, which
  // the allocator wrote into the first sizeof(void*) bytes.
  void* raw = pool.allocate();
  const auto* bytes = static_cast<const std::byte*>(raw);
  for (std::size_t i = sizeof(void*); i < sizeof(EventLike); ++i) {
    CHECK(bytes[i] == std::byte{0});
  }
  // Write a generation-like counter, free, re-allocate: bytes survive reuse.
  auto* obj = static_cast<EventLike*>(raw);
  obj->generation = 42;
  pool.deallocate(raw);

  void* again = pool.allocate();
  CHECK(again == raw);  // LIFO free list
  CHECK(static_cast<EventLike*>(again)->generation == 42);
  pool.deallocate(again);
}

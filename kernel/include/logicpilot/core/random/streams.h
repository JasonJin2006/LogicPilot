// SeedStreams - deterministic RNG stream sharding.
//
// A single run seed is split into independent per-stream engines keyed by a
// 64-bit stream_id (e.g. one stream per worker partition or agent shard).
// Derivation is a pure function of (seed, stream_id):
//   * identical pair -> identical engine (replay guarantee, ADR-0007)
//   * distinct stream_ids -> decorrelated states (SplitMix64 avalanche),
//     which reserves the parallel-execution path without committing to a
//     threading model yet.
#pragma once

#include <array>
#include <cstdint>

#include "logicpilot/core/random/splitmix64.h"
#include "logicpilot/core/random/xoshiro256pp.h"

namespace logicpilot {

class SeedStreams {
 public:
  explicit constexpr SeedStreams(std::uint64_t seed) : seed_{seed} {}

  // Derive the 256-bit state for `stream_id`.
  [[nodiscard]] std::array<std::uint64_t, 4> derive_state(
      std::uint64_t stream_id) const {
    // Fold stream_id into the seed domain, then chain SplitMix64 to expand
    // one 64-bit key into four well-mixed state words.
    const std::uint64_t key =
        SplitMix64::mix(seed_ ^ SplitMix64::mix(stream_id ^ kStreamSalt));
    SplitMix64 mixer{key};
    return {mixer.next(), mixer.next(), mixer.next(), mixer.next()};
  }

  // Independent engine for `stream_id`.
  [[nodiscard]] Xoshiro256PlusPlus stream(std::uint64_t stream_id) const {
    const auto s = derive_state(stream_id);
    return Xoshiro256PlusPlus{s[0], s[1], s[2], s[3]};
  }

  [[nodiscard]] constexpr std::uint64_t seed() const { return seed_; }

 private:
  // Arbitrary odd constant separating the stream-id domain from raw seeds.
  static constexpr std::uint64_t kStreamSalt = 0xA53C9E274BF16D53ULL;

  std::uint64_t seed_;
};

}  // namespace logicpilot

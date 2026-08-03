// SplitMix64 - seed mixer and stream derivation primitive.
//
// Reference: Sebastiano Vigna, "Further scramblings" (2015). Used only for
// seeding / key derivation in LogicPilot - simulation sampling uses
// Xoshiro256PlusPlus. Fully deterministic, no table lookups.
#pragma once

#include <cstdint>

namespace logicpilot {

class SplitMix64 {
 public:
  using result_type = std::uint64_t;

  explicit constexpr SplitMix64(std::uint64_t seed) : state_{seed} {}

  // One-shot mixer: pure function of `z`, handy for hashing ids into seeds.
  [[nodiscard]] static constexpr std::uint64_t mix(std::uint64_t z) {
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
  }

  constexpr std::uint64_t next() {
    state_ += 0x9E3779B97F4A7C15ULL;
    return mix(state_);
  }

  // std::uniform_int_distribution-compatible accessors.
  static constexpr std::uint64_t min() { return 0; }
  static constexpr std::uint64_t max() { return ~std::uint64_t{0}; }
  constexpr std::uint64_t operator()() { return next(); }

  [[nodiscard]] constexpr std::uint64_t state() const { return state_; }

 private:
  std::uint64_t state_;
};

}  // namespace logicpilot

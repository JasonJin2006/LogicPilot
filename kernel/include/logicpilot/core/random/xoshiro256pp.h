// Xoshiro256PlusPlus - the kernel's simulation RNG.
//
// Reference: David Blackman & Sebastiano Vigna, "Scrambled Linear
// Pseudorandom Number Generators" (2021). 256-bit state, period 2^256 - 1.
// Bit-exact across compilers/platforms: only 64-bit add/shift/rotate are
// used. Seeding goes through SplitMix64 (never feed a bare scalar into the
// state directly).
#pragma once

#include <cstdint>

#include "logicpilot/core/random/splitmix64.h"

namespace logicpilot {

class Xoshiro256PlusPlus {
 public:
  using result_type = std::uint64_t;

  // Derive the full 256-bit state from a single scalar seed.
  explicit Xoshiro256PlusPlus(std::uint64_t seed) {
    SplitMix64 mixer{seed};
    s_[0] = mixer.next();
    s_[1] = mixer.next();
    s_[2] = mixer.next();
    s_[3] = mixer.next();
  }

  // Raw-state constructor (golden vectors, stream sharding).
  Xoshiro256PlusPlus(std::uint64_t s0, std::uint64_t s1, std::uint64_t s2,
                     std::uint64_t s3)
      : s_{s0, s1, s2, s3} {}

  std::uint64_t next() {
    const std::uint64_t result = rotl(s_[0] + s_[3], 23) + s_[0];

    const std::uint64_t t = s_[1] << 17;
    s_[2] ^= s_[0];
    s_[3] ^= s_[1];
    s_[1] ^= s_[2];
    s_[0] ^= s_[3];
    s_[2] ^= t;
    s_[3] = rotl(s_[3], 45);

    return result;
  }

  // std::uniform_int_distribution-compatible accessors.
  static constexpr std::uint64_t min() { return 0; }
  static constexpr std::uint64_t max() { return ~std::uint64_t{0}; }
  std::uint64_t operator()() { return next(); }

  // Uniform double in [0, 1): top 53 bits, exact spacing of 2^-53.
  double next_double() {
    return static_cast<double>(next() >> 11) * 0x1.0p-53;
  }

  [[nodiscard]] const std::uint64_t* state() const { return s_; }

 private:
  static std::uint64_t rotl(std::uint64_t x, int k) {
    return (x << k) | (x >> (64 - k));
  }

  std::uint64_t s_[4];
};

}  // namespace logicpilot

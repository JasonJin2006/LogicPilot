// Sampling distributions over any 64-bit engine (operator() -> uint64_t).
//
// Every distribution is a pure state machine over the engine: fixed seed =>
// identical sample sequence within a single build (ADR-0007). Exponential /
// Normal / Poisson call libm transcendentals (log/sqrt/sin/cos/exp), whose
// implementations are not guaranteed bit-identical across toolchains, so
// cross-toolchain reproducibility is NOT implied; the surrounding
// xoshiro256++/SeedStreams/int64-fixed-point pipeline is bit-exact.
//   Uniform<T>     - real [a, b) or integer [a, b] (Lemire, unbiased)
//   Exponential    - inverse transform, rate lambda
//   Normal         - Box-Muller with cached mate (deterministic pairing)
//   Poisson        - Knuth for small mean, rounded-normal approximation for
//                    large mean (MVP; exact-rejection variant may follow)
//   Constant       - degenerate distribution (delays, fixed service times)
#pragma once

#include <cmath>
#include <cstdint>

namespace logicpilot {

namespace detail {

// Uniform double in [0, 1) from the top 53 bits of a 64-bit draw.
template <typename Engine>
inline double uniform01(Engine& engine) {
  return static_cast<double>(engine() >> 11) * 0x1.0p-53;
}

// Unbiased bounded integer via Lemire's multiplication method (2019).
// Returns a value in [0, range). Requires range > 0.
template <typename Engine>
inline std::uint64_t uniform_bounded(Engine& engine, std::uint64_t range) {
#if defined(__SIZEOF_INT128__)
  std::uint64_t x = engine();
  __uint128_t m = static_cast<__uint128_t>(x) * range;
  std::uint64_t l = static_cast<std::uint64_t>(m);
  if (l < range) {
    const std::uint64_t threshold = (-range) % range;
    while (l < threshold) {
      x = engine();
      m = static_cast<__uint128_t>(x) * range;
      l = static_cast<std::uint64_t>(m);
    }
  }
  return static_cast<std::uint64_t>(m >> 64);
#else
  // Portable fallback (slight bias < 2^-11 for huge ranges - MVP acceptable).
  return static_cast<std::uint64_t>(uniform01(engine) *
                                    static_cast<double>(range));
#endif
}

}  // namespace detail

template <typename Engine>
struct Uniform {
  double a{0.0};
  double b{1.0};

  double operator()(Engine& engine) const {
    return a + (b - a) * detail::uniform01(engine);
  }
};

template <typename Engine>
struct UniformInt {
  std::int64_t a{0};
  std::int64_t b{0};  // inclusive bounds, requires a <= b

  std::int64_t operator()(Engine& engine) const {
    const std::uint64_t range =
        static_cast<std::uint64_t>(b - a) + std::uint64_t{1};
    return a + static_cast<std::int64_t>(detail::uniform_bounded(engine, range));
  }
};

template <typename Engine>
struct Exponential {
  double rate{1.0};  // lambda > 0

  double operator()(Engine& engine) const {
    // 1 - u keeps u == 0 (log(0)) unreachable while preserving uniformity.
    return -std::log(1.0 - detail::uniform01(engine)) / rate;
  }
};

template <typename Engine>
struct Normal {
  double mean{0.0};
  double stddev{1.0};

  Normal() = default;
  Normal(double m, double s) : mean{m}, stddev{s} {}

  // Box-Muller: two uniforms -> two normals; the second is cached so the
  // amortized cost is one uniform per sample. The cache is part of the
  // distribution state, keeping the sequence deterministic.
  double operator()(Engine& engine) {
    if (has_cached_) {
      has_cached_ = false;
      return mean + stddev * cached_;
    }
    double u1 = detail::uniform01(engine);
    if (u1 <= 0.0) {
      u1 = 0x1.0p-53;  // smallest positive 53-bit double; avoids log(0)
    }
    const double u2 = detail::uniform01(engine);
    const double r = std::sqrt(-2.0 * std::log(u1));
    const double theta = 2.0 * kPi * u2;
    cached_ = r * std::sin(theta);
    has_cached_ = true;
    return mean + stddev * (r * std::cos(theta));
  }

 private:
  static constexpr double kPi = 3.14159265358979323846;
  double cached_{0.0};
  bool has_cached_{false};
};

template <typename Engine>
struct Poisson {
  double mean{1.0};  // lambda > 0

  std::int64_t operator()(Engine& engine) const {
    if (mean < kKnuthLimit) {
      // Knuth: count unit-exponential arrivals fitting into `mean`.
      const double limit = std::exp(-mean);
      std::int64_t k = 0;
      double product = 1.0;
      for (;;) {
        product *= 1.0 - detail::uniform01(engine);
        if (product <= limit) {
          return k;
        }
        ++k;
      }
    }
    // Large-mean path: rounded normal approximation (variance == mean).
    // Deterministic under fixed seed; statistical sanity tests cover it.
    Normal<Engine> approx{mean, std::sqrt(mean)};
    const double sample = approx(engine);
    return sample <= 0.0 ? 0 : static_cast<std::int64_t>(sample + 0.5);
  }

 private:
  static constexpr double kKnuthLimit = 50.0;
};

template <typename Engine>
struct Constant {
  double value{0.0};

  double operator()(Engine&) const { return value; }
};

}  // namespace logicpilot

// LogicPilot simulation time representation.
//
// SimTime is a strong type over int64_t with a fixed 1 ns resolution. A fixed
// point representation (instead of double) keeps event ordering exact and
// reproducible across runs and platforms - a hard requirement for
// deterministic replay (ADR-0007).
#pragma once

#include <compare>
#include <cstdint>

namespace logicpilot {

class SimTime {
 public:
  constexpr SimTime() = default;

  static constexpr SimTime from_ns(std::int64_t ns) { return SimTime{ns}; }

  static constexpr SimTime zero() { return SimTime{0}; }

  // Sentinel that compares greater than any reachable simulation time.
  static constexpr SimTime infinity() { return SimTime{kInfinityNs}; }

  [[nodiscard]] constexpr std::int64_t as_ns() const { return ns_; }
  [[nodiscard]] constexpr double as_seconds() const {
    return static_cast<double>(ns_) * 1e-9;
  }
  [[nodiscard]] constexpr bool is_infinity() const {
    return ns_ == kInfinityNs;
  }

  constexpr SimTime operator+(SimTime other) const {
    return SimTime{ns_ + other.ns_};
  }
  constexpr SimTime operator-(SimTime other) const {
    return SimTime{ns_ - other.ns_};
  }
  constexpr SimTime& operator+=(SimTime other) {
    ns_ += other.ns_;
    return *this;
  }
  constexpr SimTime& operator-=(SimTime other) {
    ns_ -= other.ns_;
    return *this;
  }
  constexpr SimTime operator-() const { return SimTime{-ns_}; }

  constexpr auto operator<=>(const SimTime&) const = default;

 private:
  static constexpr std::int64_t kInfinityNs = 0x7FFFFFFFFFFFFFFFLL;

  explicit constexpr SimTime(std::int64_t ns) : ns_{ns} {}

  std::int64_t ns_{0};
};

// ---------------------------------------------------------------------------
// User defined literals (1 ns resolution base).
// ---------------------------------------------------------------------------
constexpr SimTime operator""_ns(unsigned long long v) {
  return SimTime::from_ns(static_cast<std::int64_t>(v));
}
constexpr SimTime operator""_us(unsigned long long v) {
  return SimTime::from_ns(static_cast<std::int64_t>(v) * 1'000LL);
}
constexpr SimTime operator""_ms(unsigned long long v) {
  return SimTime::from_ns(static_cast<std::int64_t>(v) * 1'000'000LL);
}
constexpr SimTime operator""_s(unsigned long long v) {
  return SimTime::from_ns(static_cast<std::int64_t>(v) * 1'000'000'000LL);
}

}  // namespace logicpilot

// RNG tests: known vectors, determinism, stream sharding, distribution
// statistics (fixed seed; tolerances centralized in tolerances.h).
#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <cstdint>
#include <set>
#include <vector>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/splitmix64.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "tolerances.h"

using namespace logicpilot;

namespace {

struct Moments {
  double mean{0.0};
  double variance{0.0};
};

Moments compute_moments(const std::vector<double>& samples) {
  double sum = 0.0;
  for (const double s : samples) {
    sum += s;
  }
  const double mean = sum / static_cast<double>(samples.size());
  double sq = 0.0;
  for (const double s : samples) {
    const double d = s - mean;
    sq += d * d;
  }
  return Moments{mean, sq / static_cast<double>(samples.size())};
}

constexpr std::uint64_t kTestSeed = 0x4C6F67696350696CULL;  // "LogicPil"

}  // namespace

TEST_CASE("SplitMix64 matches published test vectors", "[random][golden]") {
  // Canonical vectors: splitmix64 seeded with 0.
  SplitMix64 mixer{0};
  CHECK(mixer.next() == 0xE220A8397B1DCDAFULL);
  CHECK(mixer.next() == 0x6E789E6AA1B965F4ULL);
}

TEST_CASE("xoshiro256++ matches hand-verified golden vectors", "[random][golden]") {
  // Raw state {1, 0, 0, 0}: the update rules are pure integer arithmetic, so
  // these outputs are exact invariants of the reference algorithm
  // (Blackman & Vigna 2021), independent of compiler/platform.
  Xoshiro256PlusPlus rng{1, 0, 0, 0};
  CHECK(rng.next() == 0x00800001ULL);  // rotl(1+0, 23) + 1
  CHECK(rng.next() == 0x00800001ULL);  // state {1,1,1,0}
  CHECK(rng.next() == 0x10ULL);        // rotl(2^45, 23) = 2^4
}

TEST_CASE("Identical seeds produce identical sequences", "[random][determinism]") {
  Xoshiro256PlusPlus a{kTestSeed};
  Xoshiro256PlusPlus b{kTestSeed};
  for (int i = 0; i < 100'000; ++i) {
    REQUIRE(a.next() == b.next());
  }
}

TEST_CASE("Different seeds produce different sequences", "[random]") {
  Xoshiro256PlusPlus a{kTestSeed};
  Xoshiro256PlusPlus b{kTestSeed + 1};
  int mismatches = 0;
  for (int i = 0; i < 64; ++i) {
    if (a.next() != b.next()) {
      ++mismatches;
    }
  }
  CHECK(mismatches > 60);
}

TEST_CASE("next_double stays in [0, 1)", "[random]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  for (int i = 0; i < 100'000; ++i) {
    const double u = rng.next_double();
    REQUIRE(u >= 0.0);
    REQUIRE(u < 1.0);
  }
}

TEST_CASE("SeedStreams: same (seed, stream_id) -> same engine", "[random][streams]") {
  const SeedStreams streams{kTestSeed};
  auto a = streams.stream(7);
  auto b = streams.stream(7);
  for (int i = 0; i < 10'000; ++i) {
    REQUIRE(a.next() == b.next());
  }
}

TEST_CASE("SeedStreams: distinct stream_ids decorrelate", "[random][streams]") {
  const SeedStreams streams{kTestSeed};
  const auto s0 = streams.derive_state(0);
  const auto s1 = streams.derive_state(1);
  CHECK(s0 != s1);

  auto a = streams.stream(0);
  auto b = streams.stream(1);
  int mismatches = 0;
  for (int i = 0; i < 64; ++i) {
    if (a.next() != b.next()) {
      ++mismatches;
    }
  }
  CHECK(mismatches > 60);

  // Same stream_id under a different seed differs too.
  const SeedStreams other{kTestSeed ^ 1};
  CHECK(other.derive_state(7) != streams.derive_state(7));
}

TEST_CASE("Uniform real: range, mean, variance", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  Uniform<Xoshiro256PlusPlus> dist{0.0, 1.0};

  std::vector<double> samples;
  samples.reserve(test::kDistributionSamples);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    const double s = dist(rng);
    REQUIRE(s >= test::kUniformHardMin);
    REQUIRE(s < test::kUniformHardMax);
    samples.push_back(s);
  }
  const Moments m = compute_moments(samples);
  CHECK(std::abs(m.mean - 0.5) <= test::kMeanRelativeTolerance * 0.5);
  CHECK(std::abs(m.variance - 1.0 / 12.0) <=
        test::kVarianceRelativeTolerance * (1.0 / 12.0));
}

TEST_CASE("UniformInt covers [a, b] inclusively and without bias", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  UniformInt<Xoshiro256PlusPlus> dist{3, 12};  // 10 buckets

  std::vector<std::size_t> counts(10, 0);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    const std::int64_t s = dist(rng);
    REQUIRE(s >= 3);
    REQUIRE(s <= 12);
    counts[static_cast<std::size_t>(s - 3)]++;
  }
  const double expected =
      static_cast<double>(test::kDistributionSamples) / 10.0;
  for (const std::size_t c : counts) {
    // Every bucket must be populated and within 10 % of expectation.
    REQUIRE(static_cast<double>(c) > expected * 0.90);
    REQUIRE(static_cast<double>(c) < expected * 1.10);
  }
}

TEST_CASE("Exponential: mean and variance match the rate", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  const double rate = 2.0;
  Exponential<Xoshiro256PlusPlus> dist{rate};

  std::vector<double> samples;
  samples.reserve(test::kDistributionSamples);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    const double s = dist(rng);
    REQUIRE(s >= 0.0);
    samples.push_back(s);
  }
  const Moments m = compute_moments(samples);
  const double expected_mean = 1.0 / rate;
  const double expected_var = 1.0 / (rate * rate);
  CHECK(std::abs(m.mean - expected_mean) <=
        test::kMeanRelativeTolerance * expected_mean);
  CHECK(std::abs(m.variance - expected_var) <=
        test::kVarianceRelativeTolerance * expected_var);
}

TEST_CASE("Normal: Box-Muller moments", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  Normal<Xoshiro256PlusPlus> dist{5.0, 2.0};

  std::vector<double> samples;
  samples.reserve(test::kDistributionSamples);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    samples.push_back(dist(rng));
  }
  const Moments m = compute_moments(samples);
  CHECK(std::abs(m.mean - 5.0) <= test::kMeanRelativeTolerance * 5.0);
  CHECK(std::abs(m.variance - 4.0) <= test::kVarianceRelativeTolerance * 4.0);
}

TEST_CASE("Normal sampling is deterministic including its cache", "[random][dist]") {
  Xoshiro256PlusPlus rng_a{kTestSeed};
  Xoshiro256PlusPlus rng_b{kTestSeed};
  Normal<Xoshiro256PlusPlus> a{0.0, 1.0};
  Normal<Xoshiro256PlusPlus> b{0.0, 1.0};
  for (int i = 0; i < 10'001; ++i) {  // odd count exercises the cached mate
    REQUIRE(a(rng_a) == b(rng_b));
  }
}

TEST_CASE("Poisson (Knuth path): mean and variance ~= lambda", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  Poisson<Xoshiro256PlusPlus> dist{4.0};

  std::vector<double> samples;
  samples.reserve(test::kDistributionSamples);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    const std::int64_t s = dist(rng);
    REQUIRE(s >= 0);
    samples.push_back(static_cast<double>(s));
  }
  const Moments m = compute_moments(samples);
  CHECK(std::abs(m.mean - 4.0) <= test::kMeanRelativeTolerance * 4.0);
  CHECK(std::abs(m.variance - 4.0) <= test::kVarianceRelativeTolerance * 4.0);
}

TEST_CASE("Poisson (large-mean path): moments stay sane", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  Poisson<Xoshiro256PlusPlus> dist{120.0};

  std::vector<double> samples;
  samples.reserve(test::kDistributionSamples);
  for (std::size_t i = 0; i < test::kDistributionSamples; ++i) {
    const std::int64_t s = dist(rng);
    REQUIRE(s >= 0);
    samples.push_back(static_cast<double>(s));
  }
  const Moments m = compute_moments(samples);
  CHECK(std::abs(m.mean - 120.0) <= test::kMeanRelativeTolerance * 120.0);
  CHECK(std::abs(m.variance - 120.0) <= test::kVarianceRelativeTolerance * 120.0);
}

TEST_CASE("Constant always returns its value", "[random][dist]") {
  Xoshiro256PlusPlus rng{kTestSeed};
  Constant<Xoshiro256PlusPlus> dist{12.5};
  for (int i = 0; i < 100; ++i) {
    CHECK(dist(rng) == 12.5);
  }
}

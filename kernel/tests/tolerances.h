// Central tolerance constants for statistical and numerical tests.
//
// All probabilistic tests run with a FIXED seed, so assertions are about the
// concrete deterministic sequence - the tolerances below absorb only floating
// point noise and the intrinsic estimator spread of the chosen sample size.
// Bumping a tolerance requires a comment explaining why.
#pragma once

#include <cstddef>

namespace logicpilot::test {

// Sample counts ---------------------------------------------------------------
inline constexpr std::size_t kDistributionSamples = 100'000;

// Relative tolerances on distribution moments ----------------------------------
// Mean tolerance: ~13 sigma at N = kDistributionSamples for unit-variance
// distributions, leaving headroom without hiding real regressions.
inline constexpr double kMeanRelativeTolerance = 0.02;      // 2 %
inline constexpr double kVarianceRelativeTolerance = 0.08;  // 8 %

// Range sanity for uniform samplers.
inline constexpr double kUniformHardMin = 0.0;
inline constexpr double kUniformHardMax = 1.0;

}  // namespace logicpilot::test

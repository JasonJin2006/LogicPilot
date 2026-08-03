// lpcli `run` subcommand - replication runner + summary report.
//
// Usage:
//   lpcli run --model built-in:mm1 --seed=42 --reps=30 --lambda=0.8 --mu=1.0
//   lpcli run --model-file model.lpir --seed=42 --reps=30
#pragma once

#include <cstdint>
#include <span>
#include <string>

namespace logicpilot::cli {

struct RunOptions {
  std::string model{"built-in:mm1"};  // built-in:<name> or (with --model-file)
  std::string model_file;             // .lpir IR file; overrides --model
  std::uint64_t seed{42};
  std::uint64_t reps{30};
  std::uint64_t arrivals{20000};
  std::uint64_t warmup{2000};
  double lambda{0.8};
  double mu{1.0};
  double confidence{0.95};
};

// Execute the run subcommand. Returns the process exit code.
int run_command(std::span<const std::string> args);

}  // namespace logicpilot::cli

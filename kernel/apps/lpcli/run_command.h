// lpcli `run` subcommand - replication runner + summary report.
//
// Usage:
//   lpcli run --model built-in:mm1 --seed=42 --reps=30 --lambda=0.8 --mu=1.0
//   lpcli run --model-file model.lpir --seed=42 --reps=30
//   lpcli run --project model.lpproj --results-dir out  (DSL-enabled builds)
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
  std::string trajectory;  // write continuous-model trajectory JSON here
  std::string project;     // *.lpproj bundle (DSL-enabled builds)
  std::string results_dir; // write run.json + metrics.json here
  std::string output_ir;   // write the compiled IR to this path (with --project)
};

// Execute the run subcommand. Returns the process exit code.
int run_command(std::span<const std::string> args);

}  // namespace logicpilot::cli

// lpcli `serve` subcommand - compile DSL -> IR and run the lp-server
// WebSocket gateway in-process (Phase 2c, task #7).
//
// Usage:
//   lpcli serve examples/mm1.lp --port 8089 --seed 42 [--trace]
//   lpcli serve --model-file model.ir.bin --port 8089
#pragma once

#include <span>
#include <string>

namespace logicpilot::cli {

// Execute the serve subcommand. Returns the process exit code.
int serve_command(std::span<const std::string> args);

}  // namespace logicpilot::cli

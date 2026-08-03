// lpcli `compile` subcommand (Phase 2b, task #6): DSL source -> IR file.
#pragma once

#include <span>
#include <string>

namespace logicpilot::cli {

// Exit codes: 0 compiled + written, 1 compile/io failure, 2 usage error.
int compile_command(std::span<const std::string> args);

}  // namespace logicpilot::cli

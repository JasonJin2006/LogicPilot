#pragma once

#include <span>
#include <string>

namespace logicpilot::cli {

int trace_compare_command(std::span<const std::string> args);

}  // namespace logicpilot::cli

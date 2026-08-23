#include "trace_compare_command.h"

#include <vector>

#include <fmt/format.h>

#include "logicpilot/devs/trace_diff.h"
#include "logicpilot/devs/trace_store.h"

namespace logicpilot::cli {

int trace_compare_command(std::span<const std::string> args) {
  if (args.size() == 1 && (args[0] == "--help" || args[0] == "-h")) {
    fmt::print("usage: lpcli trace-compare <expected.lplt> <actual.lplt>\n");
    return 0;
  }
  if (args.size() != 2) {
    fmt::print(stderr,
               "usage: lpcli trace-compare <expected.lplt> <actual.lplt>\n");
    return 2;
  }
  std::vector<LogicalStepRecord> expected;
  std::vector<LogicalStepRecord> actual;
  std::string error;
  FileLogicalTraceArchiveStore expected_store{args[0]};
  if (!expected_store.load(expected, &error)) {
    fmt::print(stderr, "error: cannot load '{}': {}\n", args[0], error);
    return 2;
  }
  FileLogicalTraceArchiveStore actual_store{args[1]};
  if (!actual_store.load(actual, &error)) {
    fmt::print(stderr, "error: cannot load '{}': {}\n", args[1], error);
    return 2;
  }
  const auto difference =
      LogicalTraceComparator::first_difference(expected, actual);
  if (!difference.has_value()) {
    fmt::print("identical: {} logical steps\n", expected.size());
    return 0;
  }
  fmt::print("divergence: index={} field={} expected={} actual={}\n",
             difference->index, difference->field, difference->expected,
             difference->actual);
  return 1;
}

}  // namespace logicpilot::cli

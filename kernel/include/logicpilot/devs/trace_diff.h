// First-divergence diagnostics for bounded cross-method logical traces.
#pragma once

#include <optional>
#include <span>
#include <string>

#include "logicpilot/runtime/replication.h"

namespace logicpilot {

struct LogicalTraceDivergence {
  std::size_t index{0};
  std::string field;
  std::string expected;
  std::string actual;
};

class LogicalTraceComparator {
 public:
  [[nodiscard]] static std::optional<LogicalTraceDivergence> first_difference(
      std::span<const LogicalStepRecord> expected,
      std::span<const LogicalStepRecord> actual) {
    if (expected.size() != actual.size()) {
      return LogicalTraceDivergence{
          expected.size() < actual.size() ? expected.size() : actual.size(),
          "record_count", std::to_string(expected.size()),
          std::to_string(actual.size())};
    }
    for (std::size_t index = 0; index < expected.size(); ++index) {
      const auto& left = expected[index];
      const auto& right = actual[index];
      if (left.at != right.at) {
        return LogicalTraceDivergence{index, "at_ns",
                                      std::to_string(left.at.as_ns()),
                                      std::to_string(right.at.as_ns())};
      }
      if (left.type != right.type) {
        return LogicalTraceDivergence{index, "type",
                                      std::to_string(left.type),
                                      std::to_string(right.type)};
      }
      if (left.payload != right.payload) {
        return LogicalTraceDivergence{index, "payload",
                                      std::to_string(left.payload),
                                      std::to_string(right.payload)};
      }
    }
    return std::nullopt;
  }
};

}  // namespace logicpilot

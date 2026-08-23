// First-divergence diagnostics for deterministic DEVS evidence comparison.
#pragma once

#include <algorithm>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <utility>

#include "logicpilot/devs/evidence.h"

namespace logicpilot {

struct DevsEvidenceDivergence {
  std::size_t record_index{0};
  std::string field;
  std::string expected;
  std::string actual;
};

class DevsEvidenceComparator {
 public:
  [[nodiscard]] static std::optional<DevsEvidenceDivergence> first_difference(
      std::span<const DevsEvidenceRecord> expected,
      std::span<const DevsEvidenceRecord> actual) {
    if (expected.size() != actual.size()) {
      return DevsEvidenceDivergence{std::min(expected.size(), actual.size()),
                                    "record_count", std::to_string(expected.size()),
                                    std::to_string(actual.size())};
    }
    for (std::size_t index = 0; index < expected.size(); ++index) {
      const auto& left = expected[index];
      const auto& right = actual[index];
      const auto scalar = [index](std::string field, std::string left_value,
                                  std::string right_value)
          -> std::optional<DevsEvidenceDivergence> {
        return DevsEvidenceDivergence{index, std::move(field), std::move(left_value),
                                      std::move(right_value)};
      };
      if (left.sequence != right.sequence)
        return scalar("sequence", std::to_string(left.sequence), std::to_string(right.sequence));
      if (left.at != right.at)
        return scalar("at_ns", std::to_string(left.at.as_ns()), std::to_string(right.at.as_ns()));
      if (left.atom != right.atom)
        return scalar("atom", std::to_string(left.atom), std::to_string(right.atom));
      if (left.atom_path != right.atom_path)
        return scalar("atom_path", left.atom_path, right.atom_path);
      if (left.kind != right.kind)
        return scalar("kind", std::to_string(static_cast<unsigned>(left.kind)),
                      std::to_string(static_cast<unsigned>(right.kind)));
      if (left.elapsed != right.elapsed)
        return scalar("elapsed_ns", std::to_string(left.elapsed.as_ns()),
                      std::to_string(right.elapsed.as_ns()));
      if (left.inputs.size() != right.inputs.size())
        return scalar("inputs.count", std::to_string(left.inputs.size()),
                      std::to_string(right.inputs.size()));
      for (std::size_t event = 0; event < left.inputs.size(); ++event) {
        if (left.inputs[event].port != right.inputs[event].port)
          return scalar("inputs[" + std::to_string(event) + "].port",
                        std::to_string(left.inputs[event].port),
                        std::to_string(right.inputs[event].port));
        if (left.inputs[event].payload != right.inputs[event].payload)
          return scalar("inputs[" + std::to_string(event) + "].payload",
                        std::to_string(left.inputs[event].payload),
                        std::to_string(right.inputs[event].payload));
      }
      if (left.input_sources.size() != right.input_sources.size())
        return scalar("input_sources.count", std::to_string(left.input_sources.size()),
                      std::to_string(right.input_sources.size()));
      for (std::size_t source = 0; source < left.input_sources.size(); ++source) {
        if (left.input_sources[source] != right.input_sources[source])
          return scalar("input_sources[" + std::to_string(source) + "]",
                        std::to_string(left.input_sources[source]),
                        std::to_string(right.input_sources[source]));
      }
      if (left.outputs.size() != right.outputs.size())
        return scalar("outputs.count", std::to_string(left.outputs.size()),
                      std::to_string(right.outputs.size()));
      for (std::size_t event = 0; event < left.outputs.size(); ++event) {
        if (left.outputs[event].port != right.outputs[event].port)
          return scalar("outputs[" + std::to_string(event) + "].port",
                        std::to_string(left.outputs[event].port),
                        std::to_string(right.outputs[event].port));
        if (left.outputs[event].payload != right.outputs[event].payload)
          return scalar("outputs[" + std::to_string(event) + "].payload",
                        std::to_string(left.outputs[event].payload),
                        std::to_string(right.outputs[event].payload));
      }
    }
    return std::nullopt;
  }
};

}  // namespace logicpilot

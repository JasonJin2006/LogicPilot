// Compiled runtime representation for a DEVS coupling tree.
//
// CoupledModel is intentionally a readable, hierarchical description. The
// executor should not repeatedly walk that tree or resolve model/port names on
// the hot path, so DevsRuntimePlan lowers it once into stable atom ids and
// compact route spans. The plan borrows AtomicModel instances from the source
// tree; the tree must outlive the plan and its executor.
#pragma once

#include <cstdint>
#include <limits>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "logicpilot/devs/coupled_model.h"

namespace logicpilot {

class DevsRuntimePlan {
 public:
  struct RouteTarget {
    std::uint32_t atom{0};
    PortId port{kInvalidPort};

    constexpr bool operator==(const RouteTarget&) const = default;
  };

  static constexpr std::uint32_t kInvalidRoute =
      std::numeric_limits<std::uint32_t>::max();

  // Compile a hierarchical coupling tree into a flat runtime plan. Throws
  // std::logic_error for malformed child/port references and
  // std::overflow_error for pathological nesting or route-table sizes.
  [[nodiscard]] static DevsRuntimePlan compile(CoupledModel& root);

  [[nodiscard]] std::size_t atom_count() const { return atoms_.size(); }
  [[nodiscard]] AtomicModel* atom(std::size_t index) const {
    return index < atoms_.size() ? atoms_[index] : nullptr;
  }
  [[nodiscard]] const std::vector<AtomicModel*>& atoms() const {
    return atoms_;
  }

  [[nodiscard]] std::string_view atom_path(std::size_t index) const {
    return index < atom_paths_.size() ? atom_paths_[index] : std::string_view{};
  }

  // The returned spans are empty for an unconnected output/root port. Port ids
  // are model-local for atom outputs and plan-local for root input ports.
  [[nodiscard]] std::span<const RouteTarget> output_targets(
      std::uint32_t atom, PortId port) const;
  [[nodiscard]] std::span<const RouteTarget> root_targets(PortId port) const;

  [[nodiscard]] std::optional<PortId> root_port_id(
      std::string_view name) const;

 private:
  struct RouteSpan {
    std::uint32_t begin{kInvalidRoute};
    std::uint32_t count{0};

    [[nodiscard]] bool valid() const { return begin != kInvalidRoute; }
  };

  std::vector<AtomicModel*> atoms_;
  std::vector<std::string> atom_paths_;
  std::vector<std::vector<RouteSpan>> output_index_;
  std::vector<RouteSpan> root_index_;
  std::vector<RouteTarget> output_targets_;
  std::vector<RouteTarget> root_targets_;
  std::vector<std::string> root_port_names_;
};

}  // namespace logicpilot

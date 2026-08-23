// Deterministic conservative partition metadata for DEVS execution.
//
// The plan deliberately contains no worker threads or mutable scheduler
// state. It is a compiled description of fixed atom ranges and the routing
// edges that cross those ranges. A PDEVS timestamp barrier can use it to run
// atom-local output/transition work concurrently, then merge bags and event
// scheduling in stable atom order.
#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <vector>

#include "logicpilot/devs/runtime_plan.h"

namespace logicpilot {

class DevsPartitionPlan {
 public:
  struct Partition {
    std::uint32_t id{0};
    std::uint32_t begin{0};
    std::uint32_t end{0};  // half-open atom range
  };

  struct CrossPartitionRoute {
    std::uint32_t from_atom{0};
    std::uint32_t from_port{0};
    std::uint32_t to_atom{0};
    std::uint32_t to_port{0};
    std::uint32_t from_partition{0};
    std::uint32_t to_partition{0};
  };

  [[nodiscard]] static DevsPartitionPlan compile(
      const DevsRuntimePlan& runtime, std::size_t requested_partitions,
      std::span<const std::uint32_t> weights = {});

  [[nodiscard]] std::size_t atom_count() const { return atom_partition_.size(); }
  [[nodiscard]] std::size_t partition_count() const { return partitions_.size(); }
  [[nodiscard]] std::uint32_t partition_of(std::uint32_t atom) const {
    return atom < atom_partition_.size() ? atom_partition_[atom]
                                         : kInvalidPartition;
  }
  [[nodiscard]] std::span<const Partition> partitions() const {
    return partitions_;
  }
  [[nodiscard]] std::span<const CrossPartitionRoute> cross_routes() const {
    return cross_routes_;
  }
  [[nodiscard]] bool has_cross_partition_routes() const {
    return !cross_routes_.empty();
  }

  static constexpr std::uint32_t kInvalidPartition =
      std::numeric_limits<std::uint32_t>::max();

 private:
  std::vector<std::uint32_t> atom_partition_;
  std::vector<Partition> partitions_;
  std::vector<CrossPartitionRoute> cross_routes_;
};

}  // namespace logicpilot

// Deterministic partition compiler (see partition_plan.h).
#include "logicpilot/devs/partition_plan.h"

#include <algorithm>
#include <limits>
#include <stdexcept>
#include <numeric>

namespace logicpilot {

DevsPartitionPlan DevsPartitionPlan::compile(
    const DevsRuntimePlan& runtime, std::size_t requested_partitions,
    std::span<const std::uint32_t> weights) {
  DevsPartitionPlan plan;
  const std::size_t atoms = runtime.atom_count();
  if (atoms == 0) {
    return plan;
  }
  const std::size_t count = std::max<std::size_t>(
      1, std::min<std::size_t>(requested_partitions == 0 ? 1
                                                          : requested_partitions,
                               atoms));
  if (count > std::numeric_limits<std::uint32_t>::max()) {
    throw std::overflow_error("DevsPartitionPlan: too many partitions");
  }
  if (!weights.empty() && weights.size() != atoms) {
    throw std::invalid_argument(
        "DevsPartitionPlan: weight count does not match atom count");
  }
  std::vector<std::uint64_t> prefix(atoms + 1, 0);
  for (std::size_t atom = 0; atom < atoms; ++atom) {
    const std::uint32_t weight = weights.empty() ? 1 : weights[atom];
    prefix[atom + 1] = prefix[atom] + std::max<std::uint32_t>(weight, 1);
  }
  plan.atom_partition_.resize(atoms);
  plan.partitions_.reserve(count);
  std::size_t begin_index = 0;
  for (std::size_t partition = 0; partition < count; ++partition) {
    std::size_t end_index = atoms;
    if (partition + 1 < count) {
      const std::size_t remaining_partitions = count - partition;
      const std::uint64_t total_weight = prefix.back();
      const std::uint64_t target =
          prefix[begin_index] +
          (total_weight - prefix[begin_index]) / remaining_partitions;
      const std::size_t min_end = begin_index + 1;
      const std::size_t max_end = atoms - (remaining_partitions - 1);
      end_index = min_end;
      auto distance = [&](std::size_t candidate) {
        const std::uint64_t value = prefix[candidate];
        return value > target ? value - target : target - value;
      };
      for (std::size_t candidate = min_end + 1; candidate <= max_end;
           ++candidate) {
        if (distance(candidate) < distance(end_index)) {
          end_index = candidate;
        }
      }
    }
    const std::uint32_t begin = static_cast<std::uint32_t>(begin_index);
    const std::uint32_t end = static_cast<std::uint32_t>(end_index);
    plan.partitions_.push_back(
        Partition{static_cast<std::uint32_t>(partition), begin, end});
    for (std::uint32_t atom = begin; atom < end; ++atom) {
      plan.atom_partition_[atom] = static_cast<std::uint32_t>(partition);
    }
    begin_index = end_index;
  }

  for (std::uint32_t from = 0; from < atoms; ++from) {
    const AtomicModel* model = runtime.atom(from);
    if (model == nullptr) {
      continue;
    }
    for (std::uint32_t port = 0; port < model->port_count(); ++port) {
      for (const DevsRuntimePlan::RouteTarget& target :
           runtime.output_targets(from, port)) {
        if (target.atom >= plan.atom_partition_.size()) {
          continue;
        }
        const std::uint32_t source_partition =
            plan.atom_partition_[from];
        const std::uint32_t target_partition =
            plan.atom_partition_[target.atom];
        if (source_partition != target_partition) {
          plan.cross_routes_.push_back(CrossPartitionRoute{
              from, port, target.atom, target.port, source_partition,
              target_partition});
        }
      }
    }
  }
  return plan;
}

}  // namespace logicpilot

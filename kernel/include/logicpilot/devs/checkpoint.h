// Explicit DEVS checkpoint contract.
//
// The executor never guesses how to copy user-defined model state. An atom
// must opt into checkpointing and provide a deterministic byte representation.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

struct DevsAtomCheckpoint {
  std::string atom_path;
  SimTime last_transition{SimTime::zero()};
  std::vector<std::uint8_t> state;
};

struct DevsCheckpoint {
  std::vector<std::string> atom_paths;
  std::vector<DevsAtomCheckpoint> atoms;
  SimTime now{SimTime::zero()};
  std::size_t dispatched{0};
  std::size_t internal_transitions{0};
  std::size_t internal_budget{0};
  // Recovery epoch supplied by the session/partition coordinator. Zero keeps
  // compatibility with checkpoints produced before epoch validation existed.
  std::uint64_t recovery_epoch{0};
  // Last accepted sequence watermark per source/partition stream.
  std::vector<std::uint64_t> replay_watermarks;
};

}  // namespace logicpilot

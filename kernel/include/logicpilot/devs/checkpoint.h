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

// Narrow capability extension (ADR-0068 Phase A): implemented by DEVS method
// runtimes that own the legacy structured checkpoint. Discovered from a
// neutral SimulationMethod* via dynamic_cast by devs-side helpers (see
// session_checkpoint.h); never part of the neutral interface itself.
class CheckpointedDevRuntime {
 public:
  virtual ~CheckpointedDevRuntime() = default;
  [[nodiscard]] virtual bool save_checkpoint(DevsCheckpoint& checkpoint,
                                             std::string* error = nullptr) const = 0;
  virtual bool restore_checkpoint(const DevsCheckpoint& checkpoint,
                                  std::string* error = nullptr) = 0;
};

}  // namespace logicpilot

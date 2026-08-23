// Optional causal evidence for one DEVS replication.
//
// This is intentionally separate from TraceRecorder: TraceRecorder is a
// compact hash used by determinism tests, while DevsEvidenceRecorder keeps
// inspectable model/port information for debugging and result explanations.
#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/port_event.h"

namespace logicpilot {

inline constexpr std::uint32_t kExternalEvidenceSource =
    std::numeric_limits<std::uint32_t>::max();

enum class DevsTransitionKind : std::uint8_t {
  kInternal,
  kExternal,
  kConfluent,
};

struct DevsEvidenceRecord {
  std::uint64_t sequence{0};
  SimTime at{SimTime::zero()};
  std::uint32_t atom{0};
  std::string atom_path;
  DevsTransitionKind kind{DevsTransitionKind::kInternal};
  SimTime elapsed{SimTime::zero()};
  std::vector<PortEvent> inputs;
  std::vector<std::uint32_t> input_sources;
  std::vector<PortEvent> outputs;
};

class DevsEvidenceRecorder {
 public:
  void record(SimTime at, std::uint32_t atom, std::string_view atom_path,
              DevsTransitionKind kind, SimTime elapsed,
              std::span<const PortEvent> inputs,
              std::span<const std::uint32_t> input_sources,
              std::span<const PortEvent> outputs);

  [[nodiscard]] const std::vector<DevsEvidenceRecord>& records() const {
    return records_;
  }
  [[nodiscard]] std::size_t event_count() const { return records_.size(); }
  // Stable FNV-1a digest over all scalar, path, port, payload and source data.
  [[nodiscard]] std::uint64_t hash() const;
  // Replace the in-memory trace after validating it was decoded from a
  // portable archive. Sequence numbers are preserved for causal replay.
  bool restore(std::vector<DevsEvidenceRecord> records,
               std::string* error = nullptr);
  void clear() {
    records_.clear();
    next_sequence_ = 0;
  }

 private:
  std::vector<DevsEvidenceRecord> records_;
  std::uint64_t next_sequence_{0};
};

}  // namespace logicpilot

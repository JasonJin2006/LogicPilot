// DEVS causal evidence recorder (see evidence.h).
#include "logicpilot/devs/evidence.h"

#include <limits>
#include <utility>

namespace logicpilot {
namespace {

constexpr std::uint64_t kFnvOffset = 0xCBF29CE484222325ULL;
constexpr std::uint64_t kFnvPrime = 0x100000001B3ULL;

void absorb(std::uint64_t& hash, std::uint64_t value) {
  for (int byte = 0; byte < 8; ++byte) {
    hash ^= (value >> (8 * byte)) & 0xFFU;
    hash *= kFnvPrime;
  }
}

void absorb_bytes(std::uint64_t& hash, std::string_view value) {
  absorb(hash, value.size());
  for (const unsigned char byte : value) {
    hash ^= byte;
    hash *= kFnvPrime;
  }
}

void absorb_port_events(std::uint64_t& hash,
                        std::span<const PortEvent> events) {
  absorb(hash, events.size());
  for (const PortEvent& event : events) {
    absorb(hash, event.port);
    absorb(hash, event.payload);
  }
}

}  // namespace

void DevsEvidenceRecorder::record(
    SimTime at, std::uint32_t atom, std::string_view atom_path,
    DevsTransitionKind kind, SimTime elapsed,
    std::span<const PortEvent> inputs,
    std::span<const std::uint32_t> input_sources,
    std::span<const PortEvent> outputs) {
  DevsEvidenceRecord record;
  record.sequence = next_sequence_++;
  record.at = at;
  record.atom = atom;
  record.atom_path.assign(atom_path);
  record.kind = kind;
  record.elapsed = elapsed;
  record.inputs.assign(inputs.begin(), inputs.end());
  record.input_sources.assign(input_sources.begin(), input_sources.end());
  record.outputs.assign(outputs.begin(), outputs.end());
  records_.push_back(std::move(record));
}

std::uint64_t DevsEvidenceRecorder::hash() const {
  std::uint64_t hash = kFnvOffset;
  absorb(hash, records_.size());
  for (const DevsEvidenceRecord& record : records_) {
    absorb(hash, record.sequence);
    absorb(hash, static_cast<std::uint64_t>(record.at.as_ns()));
    absorb(hash, record.atom);
    absorb_bytes(hash, record.atom_path);
    absorb(hash, static_cast<std::uint8_t>(record.kind));
    absorb(hash, static_cast<std::uint64_t>(record.elapsed.as_ns()));
    absorb_port_events(hash, record.inputs);
    absorb(hash, record.input_sources.size());
    for (const std::uint32_t source : record.input_sources) {
      absorb(hash, source);
    }
    absorb_port_events(hash, record.outputs);
  }
  return hash;
}

bool DevsEvidenceRecorder::restore(std::vector<DevsEvidenceRecord> records,
                                   std::string* error) {
  if (error != nullptr) error->clear();
  std::uint64_t next = 0;
  for (const DevsEvidenceRecord& record : records) {
    if (record.sequence != next) {
      if (error != nullptr) *error = "evidence sequence is not contiguous";
      return false;
    }
    if (record.inputs.size() != record.input_sources.size()) {
      if (error != nullptr) *error = "evidence input/source cardinality mismatch";
      return false;
    }
    if (next == std::numeric_limits<std::uint64_t>::max()) {
      if (error != nullptr) *error = "evidence sequence exceeds uint64 range";
      return false;
    }
    ++next;
  }
  records_ = std::move(records);
  next_sequence_ = next;
  return true;
}

}  // namespace logicpilot

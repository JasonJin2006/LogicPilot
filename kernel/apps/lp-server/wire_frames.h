// lp-server wire frame construction (contract F2, schemas/wire.fbs).
//
// Every frame is a size-prefixed FlatBuffer with file_identifier "LPWR":
// FrameHeader{version=1, seq, sim_time_ns, kind} + FramePayload union.
// The trace_* helpers render the same content as human-readable JSON
// (--trace mode; also used by the integration tests).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace logicpilot::server {

inline constexpr std::uint32_t kWireVersion = 1;

// --- RunStarted -------------------------------------------------------------

struct RunStartedFrame {
  std::uint64_t seq{0};
  std::string run_id;
  std::string model_name;
  std::uint64_t seed{0};
};

std::vector<std::uint8_t> build_run_started_frame(const RunStartedFrame& frame);
std::string trace_run_started(const RunStartedFrame& frame);

// --- Tick -------------------------------------------------------------------

// Per-agent delta as emitted in Tick frames. MM1 mapping (task #7):
//   id         customer id - stable for the lifetime of the run
//   flags      0x3 (pos_x/pos_y + state_bits valid)
//   pos_x/y    layout position (queue position; service slot at origin)
//   state_bits bit0: 1 = in service, 0 = waiting in queue
struct TickAgent {
  std::uint64_t id{0};
  float pos_x{0.0f};
  float pos_y{0.0f};
  std::uint64_t state_bits{0};
};

struct TickFrame {
  std::uint64_t seq{0};
  std::int64_t sim_time_ns{0};
  std::vector<TickAgent> deltas;
};

std::vector<std::uint8_t> build_tick_frame(const TickFrame& frame);
std::string trace_tick(const TickFrame& frame);

// --- Counters ---------------------------------------------------------------

struct CounterValue {
  std::string name;
  double value{0.0};
};

struct CountersFrame {
  std::uint64_t seq{0};
  std::int64_t sim_time_ns{0};
  std::vector<CounterValue> values;
};

std::vector<std::uint8_t> build_counters_frame(const CountersFrame& frame);
std::string trace_counters(const CountersFrame& frame);

// --- RunFinished ------------------------------------------------------------

inline constexpr char kRunStatusCompleted[] = "Completed";
inline constexpr char kRunStatusFailed[] = "Failed";
inline constexpr char kRunStatusCancelled[] = "Cancelled";

struct RunFinishedFrame {
  std::uint64_t seq{0};
  std::int64_t sim_time_ns{0};
  std::string run_id;
  int status{0};  // 0 Completed, 1 Failed, 2 Cancelled (wire RunStatus)
  std::string error;
  std::vector<CounterValue> stats;
};

std::vector<std::uint8_t> build_run_finished_frame(const RunFinishedFrame& frame);
std::string trace_run_finished(const RunFinishedFrame& frame);

}  // namespace logicpilot::server

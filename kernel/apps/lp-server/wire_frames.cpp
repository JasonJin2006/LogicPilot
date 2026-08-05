// lp-server wire frame construction - implementation.
#include "wire_frames.h"

#include <cstddef>
#include <utility>

#include <fmt/format.h>
#include <flatbuffers/flatbuffers.h>
#include <wire_generated.h>

namespace logicpilot::server {
namespace {

namespace wire = ::logicpilot::wire;

using Builder = flatbuffers::FlatBufferBuilder;

// Serialize `frame` (root table offset) as a size-prefixed buffer carrying
// the "LPWR" file identifier.
std::vector<std::uint8_t> finish(Builder& builder,
                                 flatbuffers::Offset<wire::Frame> frame) {
  builder.FinishSizePrefixed(frame, wire::FrameIdentifier());
  const std::uint8_t* data = builder.GetBufferPointer();
  return {data, data + builder.GetSize()};
}

flatbuffers::Offset<wire::FrameHeader> make_header(Builder& builder,
                                                   std::uint64_t seq,
                                                   std::int64_t sim_time_ns,
                                                   wire::FrameKind kind) {
  wire::FrameHeaderBuilder header{builder};
  header.add_version(kWireVersion);
  header.add_seq(seq);
  header.add_sim_time_ns(sim_time_ns);
  header.add_kind(kind);
  return header.Finish();
}

std::vector<flatbuffers::Offset<wire::Counter>> make_counters(
    Builder& builder, const std::vector<CounterValue>& values) {
  std::vector<flatbuffers::Offset<wire::Counter>> offsets;
  offsets.reserve(values.size());
  for (const CounterValue& counter : values) {
    // Create the name string before starting the Counter table: FlatBuffers
    // forbids building sub-objects (tables/vectors/strings) while a parent
    // table is open (NotNested assert in newer releases).
    const auto name = builder.CreateString(counter.name);
    wire::CounterBuilder cb{builder};
    cb.add_name(name);
    cb.add_value(counter.value);
    offsets.push_back(cb.Finish());
  }
  return offsets;
}

}  // namespace

std::vector<std::uint8_t> build_run_started_frame(const RunStartedFrame& f) {
  Builder builder{256};
  const auto run_id = builder.CreateString(f.run_id);
  const auto model_name = builder.CreateString(f.model_name);
  wire::RunStartedBuilder payload{builder};
  payload.add_run_id(run_id);
  payload.add_model_name(model_name);
  payload.add_seed(f.seed);
  const auto payload_offset = payload.Finish();
  const auto header =
      make_header(builder, f.seq, 0, wire::FrameKind_RunStarted);
  wire::FrameBuilder frame{builder};
  frame.add_header(header);
  frame.add_payload_type(wire::FramePayload_RunStarted);
  frame.add_payload(payload_offset.Union());
  return finish(builder, frame.Finish());
}

std::vector<std::uint8_t> build_tick_frame(const TickFrame& f) {
  Builder builder{1024 + f.deltas.size() * 64};
  std::vector<flatbuffers::Offset<wire::AgentDelta>> deltas;
  deltas.reserve(f.deltas.size());
  for (const TickAgent& agent : f.deltas) {
    wire::AgentDeltaBuilder delta{builder};
    delta.add_id(agent.id);
    delta.add_flags(0x3u);  // pos_x/pos_y + state_bits valid
    delta.add_pos_x(agent.pos_x);
    delta.add_pos_y(agent.pos_y);
    delta.add_state_bits(agent.state_bits);
    deltas.push_back(delta.Finish());
  }
  const auto deltas_vector = builder.CreateVector(deltas);
  wire::TickBuilder payload{builder};
  payload.add_sim_time_ns(f.sim_time_ns);
  payload.add_deltas(deltas_vector);
  const auto payload_offset = payload.Finish();
  const auto header =
      make_header(builder, f.seq, f.sim_time_ns, wire::FrameKind_Tick);
  wire::FrameBuilder frame{builder};
  frame.add_header(header);
  frame.add_payload_type(wire::FramePayload_Tick);
  frame.add_payload(payload_offset.Union());
  return finish(builder, frame.Finish());
}

std::vector<std::uint8_t> build_counters_frame(const CountersFrame& f) {
  Builder builder{512};
  const auto counters = make_counters(builder, f.values);
  const auto counters_vector = builder.CreateVector(counters);
  wire::CountersBuilder payload{builder};
  payload.add_values(counters_vector);
  const auto payload_offset = payload.Finish();
  const auto header =
      make_header(builder, f.seq, f.sim_time_ns, wire::FrameKind_Counters);
  wire::FrameBuilder frame{builder};
  frame.add_header(header);
  frame.add_payload_type(wire::FramePayload_Counters);
  frame.add_payload(payload_offset.Union());
  return finish(builder, frame.Finish());
}

std::vector<std::uint8_t> build_run_finished_frame(const RunFinishedFrame& f) {
  Builder builder{1024};
  const auto stats = make_counters(builder, f.stats);
  const auto run_id = builder.CreateString(f.run_id);
  const auto stats_vector = builder.CreateVector(stats);
  const auto error = f.error.empty()
                         ? flatbuffers::Offset<flatbuffers::String>{}
                         : builder.CreateString(f.error);
  wire::RunFinishedBuilder payload{builder};
  payload.add_run_id(run_id);
  payload.add_status(static_cast<wire::RunStatus>(f.status));
  if (!f.error.empty()) {
    payload.add_error(error);
  }
  payload.add_stats(stats_vector);
  const auto payload_offset = payload.Finish();
  const auto header = make_header(builder, f.seq, f.sim_time_ns,
                                  wire::FrameKind_RunFinished);
  wire::FrameBuilder frame{builder};
  frame.add_header(header);
  frame.add_payload_type(wire::FramePayload_RunFinished);
  frame.add_payload(payload_offset.Union());
  return finish(builder, frame.Finish());
}

// --- trace mirrors -----------------------------------------------------------

std::string trace_run_started(const RunStartedFrame& f) {
  return fmt::format(
      "{{\"frame\":\"RunStarted\",\"seq\":{},\"sim_time_ns\":0,"
      "\"payload\":{{\"run_id\":\"{}\",\"model\":\"{}\",\"seed\":{}}}}}",
      f.seq, f.run_id, f.model_name, f.seed);
}

std::string trace_tick(const TickFrame& f) {
  constexpr std::size_t kPreview = 3;
  std::string preview;
  for (std::size_t i = 0; i < f.deltas.size() && i < kPreview; ++i) {
    const TickAgent& a = f.deltas[i];
    preview += fmt::format(
        "{}{{\"id\":{},\"x\":{:.2f},\"y\":{:.2f},\"state\":{}}}",
        i == 0 ? "" : ",", a.id, a.pos_x, a.pos_y, a.state_bits);
  }
  if (f.deltas.size() > kPreview) {
    preview += fmt::format(",... +{}", f.deltas.size() - kPreview);
  }
  return fmt::format(
      "{{\"frame\":\"Tick\",\"seq\":{},\"sim_time_ns\":{},"
      "\"payload\":{{\"deltas\":[{}]}}}}",
      f.seq, f.sim_time_ns, preview);
}

std::string trace_counters(const CountersFrame& f) {
  std::string body;
  for (std::size_t i = 0; i < f.values.size(); ++i) {
    body += fmt::format("{}\"{}\":{:.6g}", i == 0 ? "" : ",",
                        f.values[i].name, f.values[i].value);
  }
  return fmt::format(
      "{{\"frame\":\"Counters\",\"seq\":{},\"sim_time_ns\":{},"
      "\"payload\":{{{}}}}}",
      f.seq, f.sim_time_ns, body);
}

std::string trace_run_finished(const RunFinishedFrame& f) {
  const char* status = f.status == 0   ? kRunStatusCompleted
                       : f.status == 1 ? kRunStatusFailed
                                       : kRunStatusCancelled;
  std::string body;
  for (std::size_t i = 0; i < f.stats.size(); ++i) {
    body += fmt::format("{}\"{}\":{:.6g}", i == 0 ? "" : ",",
                        f.stats[i].name, f.stats[i].value);
  }
  return fmt::format(
      "{{\"frame\":\"RunFinished\",\"seq\":{},\"sim_time_ns\":{},"
      "\"payload\":{{\"run_id\":\"{}\",\"status\":\"{}\",\"stats\":{{{}}}}}}}",
      f.seq, f.sim_time_ns, f.run_id, status, body);
}

}  // namespace logicpilot::server

// lp-server integration tests (task #7).
//
// Boots the real gateway on an ephemeral port and drives it through an
// embedded Beast WebSocket client:
//   connect -> start -> RunStarted -> Tick/Counters... -> RunFinished
// Assertions cover wire conformance (identifier "LPWR", version 1, frame
// ordering, monotonic seq), MM1 statistics vs examples/mm1.expect.json
// tolerances, run-to-run determinism (same seed => identical Counters/stats)
// and bit-exact parity between the streaming driver and the kernel's
// QueueingFlowSim.
#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <map>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>

#include <flatbuffers/flatbuffers.h>
#include <wire_generated.h>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/dsl/compile.h"
#include "process_runtime.h"
#include "server.h"
#include "sim_runner.h"
#include "wire_frames.h"

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace websocket = boost::beast::websocket;
using tcp = asio::ip::tcp;
namespace wire = logicpilot::wire;

namespace {

// Register the method runtimes (process + kernel-native) once per process;
// the server's batch run path lowers models through the registry.
struct EnsureMethodsRegistered {
  EnsureMethodsRegistered() { logicpilot::register_all_methods(); }
} ensure_methods_registered;

// --- embedded WebSocket client ------------------------------------------------

class WsClient {
 public:
  bool connect(unsigned short port, int retries = 40,
               bool small_receive_buffer = false) {
    for (int attempt = 0; attempt < retries; ++attempt) {
      try {
        tcp::resolver resolver{ioc_};
        const auto results =
            resolver.resolve("127.0.0.1", std::to_string(port));
        if (small_receive_buffer) {
          // Tiny receive window: the socket blocks after a handful of
          // unread frames, so a non-reading client stalls the server's
          // writes quickly (slow-consumer tests).
          boost::system::error_code ec;
          ws_.next_layer().close(ec);
          ws_.next_layer().open(tcp::v4(), ec);
          if (!ec) {
            ws_.next_layer().set_option(
                asio::socket_base::receive_buffer_size(4096));
          }
        }
        if (small_receive_buffer && ws_.next_layer().is_open()) {
          // The free asio::connect() closes and reopens the socket for each
          // endpoint, silently discarding the receive-buffer size set above
          // (Windows then advertises its 64 KiB default window and absorbs
          // a whole run without stalling). Connect the already-open socket
          // directly so the tiny window sticks.
          const tcp::endpoint endpoint = results.begin()->endpoint();
          ws_.next_layer().connect(endpoint);
        } else {
          asio::connect(ws_.next_layer(), results);
        }
        ws_.handshake("127.0.0.1:" + std::to_string(port), "/sim");
        return true;
      } catch (const std::exception&) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
      }
    }
    return false;
  }

  void send_text(const std::string& message) {
    ws_.text(true);
    ws_.write(asio::buffer(message));
  }

  // Blocking read of one message; false on error/close.
  bool read_one() {
    buffer_.clear();
    boost::system::error_code ec;
    ws_.read(buffer_, ec);
    if (ec) {
      return false;
    }
    was_binary_ = ws_.got_binary();
    payload_ = beast::buffers_to_string(buffer_.data());
    return true;
  }

  // Watchdog escape hatch: aborts a blocked read from another thread.
  void abort_from_other_thread() {
    boost::system::error_code ec;
    ws_.next_layer().cancel(ec);
    ws_.next_layer().close(ec);
  }

  [[nodiscard]] const std::string& payload() const { return payload_; }
  [[nodiscard]] bool was_binary() const { return was_binary_; }

 private:
  asio::io_context ioc_;
  websocket::stream<tcp::socket> ws_{ioc_};
  beast::flat_buffer buffer_;
  std::string payload_;
  bool was_binary_{false};
};

// Fails a hung test by closing the client socket after `timeout`.
class Watchdog {
 public:
  Watchdog(WsClient& client, std::chrono::seconds timeout) : client_{client} {
    thread_ = std::thread([this, timeout] {
      const auto deadline = std::chrono::steady_clock::now() + timeout;
      while (armed_.load()) {
        if (std::chrono::steady_clock::now() >= deadline) {
          client_.abort_from_other_thread();
          return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
      }
    });
  }
  ~Watchdog() {
    armed_.store(false);
    if (thread_.joinable()) {
      thread_.join();
    }
  }
  Watchdog(const Watchdog&) = delete;
  Watchdog& operator=(const Watchdog&) = delete;

 private:
  WsClient& client_;
  std::atomic<bool> armed_{true};
  std::thread thread_;
};

// --- wire frame parsing -------------------------------------------------------

struct ParsedFrame {
  bool valid{false};
  wire::FrameKind kind{wire::FrameKind_Unknown};
  std::uint32_t version{0};
  std::uint64_t seq{0};
  std::int64_t sim_time_ns{0};
  const wire::RunStarted* run_started{nullptr};
  const wire::Tick* tick{nullptr};
  const wire::Counters* counters{nullptr};
  const wire::RunFinished* run_finished{nullptr};
};

ParsedFrame parse_frame(const std::string& bytes) {
  ParsedFrame parsed;
  if (bytes.size() < 8) {
    return parsed;
  }
  if (!wire::SizePrefixedFrameBufferHasIdentifier(bytes.data())) {
    return parsed;
  }
  flatbuffers::Verifier verifier{
      reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size()};
  if (!wire::VerifySizePrefixedFrameBuffer(verifier)) {
    return parsed;
  }
  const wire::Frame* frame = wire::GetSizePrefixedFrame(bytes.data());
  const wire::FrameHeader* header = frame->header();
  if (header == nullptr) {
    return parsed;
  }
  parsed.valid = true;
  parsed.kind = header->kind();
  parsed.version = header->version();
  parsed.seq = header->seq();
  parsed.sim_time_ns = header->sim_time_ns();
  parsed.run_started = frame->payload_as_RunStarted();
  parsed.tick = frame->payload_as_Tick();
  parsed.counters = frame->payload_as_Counters();
  parsed.run_finished = frame->payload_as_RunFinished();
  return parsed;
}

std::map<std::string, double> counters_to_map(
    const flatbuffers::Vector<flatbuffers::Offset<wire::Counter>>* values) {
  std::map<std::string, double> out;
  if (values == nullptr) {
    return out;
  }
  for (const wire::Counter* counter : *values) {
    out[counter->name()->str()] = counter->value();
  }
  return out;
}

// --- run capture ----------------------------------------------------------------

struct RunCapture {
  bool ok{false};
  bool completed{false};
  std::uint64_t binary_frames{0};
  std::uint64_t tick_count{0};
  std::uint64_t counters_count{0};
  bool saw_nonempty_deltas{false};
  bool delta_invariants_hold{true};
  std::string run_started_run_id;
  std::string run_started_model;
  std::uint64_t run_started_seed{0};
  std::map<std::string, double> last_counters;
  std::map<std::string, double> stats;
};

// Drive one full run over `client` (already connected). `start_json` is
// the control message; returns everything the assertions need.
RunCapture capture_run(WsClient& client, const std::string& start_json) {
  RunCapture capture;

  std::uint64_t last_seq = 0;
  std::int64_t last_sim_ns = INT64_MIN;
  bool expect_tick = true;  // after RunStarted: Tick, Counters, Tick, ...
  bool first = true;

  // Process one binary wire frame; returns true once RunFinished arrived.
  const auto process_frame = [&](const std::string& bytes) -> bool {
    const ParsedFrame frame = parse_frame(bytes);
    REQUIRE(frame.valid);
    REQUIRE(frame.version == logicpilot::server::kWireVersion);
    if (!first) {
      REQUIRE(frame.seq > last_seq);             // strictly monotonic
      REQUIRE(frame.sim_time_ns >= last_sim_ns);  // sim time never retreats
    }
    last_seq = frame.seq;
    last_sim_ns = frame.sim_time_ns;
    first = false;
    ++capture.binary_frames;

    switch (frame.kind) {
      case wire::FrameKind_RunStarted: {
        REQUIRE(capture.tick_count == 0);  // must be the very first frame
        REQUIRE(frame.run_started != nullptr);
        capture.run_started_run_id = frame.run_started->run_id()->str();
        capture.run_started_model = frame.run_started->model_name()->str();
        capture.run_started_seed = frame.run_started->seed();
        return false;
      }
      case wire::FrameKind_Tick: {
        REQUIRE(expect_tick);  // strict Tick/Counters alternation
        expect_tick = false;
        ++capture.tick_count;
        REQUIRE(frame.tick != nullptr);
        const auto* deltas = frame.tick->deltas();
        if (deltas != nullptr && deltas->size() > 0) {
          capture.saw_nonempty_deltas = true;
          float last_x = -1.0f;
          int in_service = 0;
          for (const wire::AgentDelta* delta : *deltas) {
            if (delta->flags() != 0x3u) {
              capture.delta_invariants_hold = false;
            }
            if (delta->state_bits() > 1) {
              capture.delta_invariants_hold = false;
            }
            if (delta->pos_x() <= last_x) {
              capture.delta_invariants_hold = false;
            }
            last_x = delta->pos_x();
            in_service += (delta->state_bits() & 1u) != 0u ? 1 : 0;
          }
          if (in_service > 1) {
            capture.delta_invariants_hold = false;
          }
        }
        return false;
      }
      case wire::FrameKind_Counters: {
        REQUIRE(!expect_tick);
        expect_tick = true;
        ++capture.counters_count;
        REQUIRE(frame.counters != nullptr);
        capture.last_counters = counters_to_map(frame.counters->values());
        return false;
      }
      case wire::FrameKind_RunFinished: {
        REQUIRE(frame.run_finished != nullptr);
        capture.completed =
            frame.run_finished->status() == wire::RunStatus_Completed;
        capture.stats = counters_to_map(frame.run_finished->stats());
        return true;
      }
      default:
        FAIL("unexpected frame kind");
        return true;
    }
  };

  client.send_text(start_json);

  // The control ack can race with the first telemetry frames (the worker
  // may post RunStarted before the session strand posts the ack), so buffer
  // any binary frames seen while waiting for the text reply.
  std::vector<std::string> buffered;
  bool acked = false;
  for (int i = 0; i < 128 && !acked; ++i) {
    if (!client.read_one()) {
      return capture;
    }
    if (client.was_binary()) {
      buffered.push_back(client.payload());
    } else {
      acked = client.payload().find("\"ok\":true") != std::string::npos;
      if (!acked) {
        return capture;
      }
    }
  }
  if (!acked) {
    return capture;
  }
  capture.ok = true;

  for (const std::string& bytes : buffered) {
    if (process_frame(bytes)) {
      return capture;
    }
  }
  while (client.read_one()) {
    REQUIRE(client.was_binary());
    if (process_frame(client.payload())) {
      return capture;
    }
  }
  FAIL("connection closed before RunFinished");
  return capture;
}

// Reads messages until a text (control reply) frame arrives; telemetry
// binary frames interleaved before the reply are skipped.
std::string read_next_text(WsClient& client, int max_messages = 500) {
  for (int i = 0; i < max_messages; ++i) {
    if (!client.read_one()) {
      return {};
    }
    if (!client.was_binary()) {
      return client.payload();
    }
  }
  return {};
}

// Minimal base64 encoder (mirror of the server-side decoder) used to build
// `compile` control messages whose DSL source carries quotes/newlines.
std::string base64_encode(const std::string& input) {
  static const char kAlphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  unsigned int buffer = 0;
  int bits = 0;
  for (const char c : input) {
    buffer = (buffer << 8) | static_cast<unsigned char>(c);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out.push_back(kAlphabet[(buffer >> bits) & 0x3f]);
    }
  }
  if (bits > 0) {
    out.push_back(kAlphabet[(buffer << (6 - bits)) & 0x3f]);
  }
  while (out.size() % 4 != 0) {
    out.push_back('=');
  }
  return out;
}

logicpilot::server::ServerConfig make_test_config() {
  logicpilot::server::ServerConfig config;
  config.port = 0;  // ephemeral
  config.model_name = "mm1";
  config.seed = 42;
  config.reps = 1;
  config.arrivals = 1000;
  config.warmup = 100;
  // 1 s sim slices keep the integration-test frame counts modest; the
  // production default stays 100 ms (10 Hz at speed 1.0).
  config.emit_step_ns = 1'000'000'000;
  return config;
}

}  // namespace

TEST_CASE("lp-server streams a full mm1 run over WebSocket",
          "[server][integration]") {
  // Full serve pipeline: DSL -> IR -> executable model -> gateway.
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_file(LOGICPILOT_EXAMPLES_DIR "/mm1.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  std::string build_error;
  REQUIRE(logicpilot::build_replication_model(loaded.file, &build_error) !=
          nullptr);

  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{90}};

  const RunCapture capture = capture_run(
      client,
      R"({"cmd":"start","seed":42,"reps":3,"arrivals":4000,"warmup":400,)"
      R"("confidence":0.9,"speed":100000})");

  REQUIRE(capture.ok);
  REQUIRE(capture.completed);
  REQUIRE(capture.run_started_seed == 42);
  REQUIRE(!capture.run_started_run_id.empty());
  REQUIRE(!capture.run_started_model.empty());
  REQUIRE(capture.tick_count > 0);
  REQUIRE(capture.counters_count == capture.tick_count);
  REQUIRE(capture.saw_nonempty_deltas);
  REQUIRE(capture.delta_invariants_hold);

  // MM1 live counters must be present (task #7 mapping).
  for (const char* name :
       {"queue_length", "busy", "throughput", "mean_wait"}) {
    INFO("missing counter " << name);
    REQUIRE(capture.last_counters.count(name) == 1);
  }

  // Final statistics vs examples/mm1.expect.json acceptance rule:
  // pass if the cross-replication CI covers theory.wq (4.0), or the point
  // estimate lies within 0.25 of it; throughput within 5% of 0.8.
  REQUIRE(capture.stats.count("Wq.mean") == 1);
  REQUIRE(capture.stats.count("Wq.ci_low") == 1);
  REQUIRE(capture.stats.count("Wq.ci_high") == 1);
  REQUIRE(capture.stats.count("throughput.mean") == 1);
  REQUIRE(capture.stats.at("confidence") == Catch::Approx(0.9));
  const double wq_mean = capture.stats.at("Wq.mean");
  const double wq_low = capture.stats.at("Wq.ci_low");
  const double wq_high = capture.stats.at("Wq.ci_high");
  const bool ci_covers = 4.0 >= wq_low && 4.0 <= wq_high;
  INFO("Wq mean=" << wq_mean << " CI=[" << wq_low << ", " << wq_high << "]");
  REQUIRE((ci_covers || std::abs(wq_mean - 4.0) <= 0.25));
  const double throughput = capture.stats.at("throughput.mean");
  INFO("throughput mean=" << throughput);
  REQUIRE(std::abs(throughput - 0.8) / 0.8 <= 0.05);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: full-speed run with bounded telemetry",
          "[server][integration][fast]") {
  // Fast mode is the default (no executionMode in the start message): no
  // wall-clock pacing, so a 4000-arrival x 3-rep mm1 run that would take
  // minutes at speed 1.0 in animated mode stays in the seconds range, and
  // telemetry is bounded by the fast-mode frame budget (48 Counters slices
  // per replication).
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  const auto begin = std::chrono::steady_clock::now();
  const RunCapture capture = capture_run(
      client,
      R"({"cmd":"start","seed":42,"reps":3,"arrivals":4000,"warmup":400,)"
      R"("confidence":0.9})");
  const double wall_seconds = std::chrono::duration<double>(
                                  std::chrono::steady_clock::now() - begin)
                                  .count();

  REQUIRE(capture.ok);
  REQUIRE(capture.completed);
  // Animated mode at speed 1.0 would pace 0.1 s wall per 0.1 s sim slice;
  // the mm1 horizon is thousands of sim-seconds, i.e. minutes of wall time.
  // Fast mode must stay well below that.
  REQUIRE(wall_seconds < 30.0);
  REQUIRE(capture.tick_count == capture.counters_count);
  REQUIRE(capture.counters_count > 0);
  // Per-replication fast-mode frame budget (48 slices) x 3 replications.
  REQUIRE(capture.counters_count <= 3 * 48);
  REQUIRE(capture.delta_invariants_hold);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: huge sim gaps cannot flood empty frames",
          "[server][integration][fast][flow]") {
  // A 1e6 s delay: animated slicing would emit ~1 frame per 0.1 s sim slice
  // - 10 million empty frames for a handful of entities. Fast mode adapts
  // the slice size to event density and must stay within its frame budget.
  const std::string source = R"(model Flow {
  source S { arrival = rate(0.01) }
  delay D { delayTime = constant(1000000) maximumCapacity = true }
  sink K { }
  couple S.out -> D.in
  couple D.out -> K.in
}
)";
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_source(source, "flow-gap.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  logicpilot::server::ServerConfig config = make_test_config();
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":10,"warmup":0})");

  bool completed = false;
  std::uint64_t counters_frames = 0;
  std::int64_t last_sim_ns = INT64_MIN;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;  // skip the control ack text frame
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        // sim_time_ns stays monotonic even with adaptive slices.
        REQUIRE(frame.sim_time_ns > last_sim_ns);
        last_sim_ns = frame.sim_time_ns;
        ++counters_frames;
        break;
      }
      case wire::FrameKind_Tick:
        // Fast mode still emits the Tick+Counters pair for the MM1 driver;
        // the frame-budget assertion below is about the sampled Counters
        // stream, not suppressing the paired scene frame.
        break;
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        goto done;
      default:
        FAIL("unexpected frame kind for a flow run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  REQUIRE(counters_frames > 0);
  // The fast-mode frame budget (48 slices, including the final frame)
  // bounds the telemetry; animated slicing would have emitted ~10 million
  // frames here.
  REQUIRE(counters_frames <= 48);
  // The entities did flow through the delay into the sink.
  REQUIRE(last_sim_ns > 0);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: final flow counters reflect the completed "
          "run",
          "[server][integration][fast][flow]") {
  // Arrivals large enough to exhaust the fast-mode frame budget: the run
  // drains silently after the budget, then emits one final Counters frame
  // so the last telemetry shows every entity departed and every buffer
  // empty - and RunFinished.sim_time_ns matches that final frame.
  const std::string source = R"(model Flow {
  source S { arrival = rate(0.5) }
  delay D { delayTime = constant(0.2) maximumCapacity = true }
  sink K { }
  couple S.out -> D.in
  couple D.out -> K.in
}
)";
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_source(source, "flow-final.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  logicpilot::server::ServerConfig config = make_test_config();
  config.generic_model = true;
  config.model_bytes.assign(compiled.v2_bytes.begin(), compiled.v2_bytes.end());
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":20000,"warmup":0})");

  bool completed = false;
  std::uint64_t counters_frames = 0;
  std::map<std::string, double> last_counters;
  std::int64_t last_counters_sim_ns = INT64_MIN;
  std::int64_t run_finished_sim_ns = INT64_MIN;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;  // skip the control ack text frame
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        last_counters = counters_to_map(frame.counters->values());
        last_counters_sim_ns = frame.sim_time_ns;
        ++counters_frames;
        break;
      }
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        run_finished_sim_ns = frame.sim_time_ns;
        goto done;
      default:
        FAIL("unexpected frame kind for a flow run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  // The budget (48 frames per replication, final frame included) bounds
  // the telemetry even for a 20000-arrival run.
  REQUIRE(counters_frames > 0);
  REQUIRE(counters_frames <= 48);
  // Final frame: every entity reached the sink, all buffers drained.
  REQUIRE(last_counters.at("block.S.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.in_service") == 0.0);
  REQUIRE(last_counters.at("block.K.arrived") == 20000.0);
  REQUIRE(last_counters.at("block.K.departed") == 20000.0);
  // RunFinished.sim_time_ns equals the final Counters sim time (the engine's
  // actual last-event time, not a stale pre-drain boundary).
  REQUIRE(run_finished_sim_ns > 0);
  REQUIRE(run_finished_sim_ns == last_counters_sim_ns);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: within-budget completion reports the exact "
          "final sim time",
          "[server][integration][fast][flow]") {
  // The run ends inside the frame budget (well under 48 frames), and the
  // last event does not land on a slice boundary: arrival at 1.0 s, delay
  // of 0.2 s -> the final event fires at 1.2 s while the adaptive boundary
  // has already grown to 3.0 s (the first 1 s slice dispatched 1 event, so
  // the slice doubled). run_until only advances the engine clock to real
  // event times, so the final Counters and RunFinished must report exactly
  // 1.2 s - not the 3.0 s sampling boundary.
  const std::string source = R"(model Flow {
  source S { arrival = constant(1.0) }
  delay D { delayTime = constant(0.2) maximumCapacity = true }
  sink K { }
  couple S.out -> D.in
  couple D.out -> K.in
}
)";
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_source(source, "flow-exact-time.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  logicpilot::server::ServerConfig config = make_test_config();  // 1 s slices
  config.generic_model = true;
  config.model_bytes.assign(compiled.v2_bytes.begin(), compiled.v2_bytes.end());
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":1,"warmup":0})");

  bool completed = false;
  std::uint64_t counters_frames = 0;
  std::map<std::string, double> last_counters;
  std::int64_t last_counters_sim_ns = INT64_MIN;
  std::int64_t run_finished_sim_ns = INT64_MIN;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;  // skip the control ack text frame
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        last_counters = counters_to_map(frame.counters->values());
        last_counters_sim_ns = frame.sim_time_ns;
        ++counters_frames;
        break;
      }
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        run_finished_sim_ns = frame.sim_time_ns;
        goto done;
      default:
        FAIL("unexpected frame kind for a flow run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  // This run must finish inside the budget: the exact-time regression is
  // about the within-budget completion path, not the drain path.
  REQUIRE(counters_frames > 0);
  REQUIRE(counters_frames < 48);
  // Final frame is terminal: the entity reached the sink, buffers drained.
  REQUIRE(last_counters.at("block.S.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.in_service") == 0.0);
  REQUIRE(last_counters.at("block.K.departed") == 1.0);
  // Exact last-event time: 1.0 s arrival + 0.2 s delay = 1.2 s, not the
  // grown 3.0 s slice boundary.
  REQUIRE(last_counters_sim_ns == 1'200'000'000LL);
  REQUIRE(run_finished_sim_ns == last_counters_sim_ns);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: a source limited below the requested "
          "arrivals completes cleanly",
          "[server][integration][fast][flow]") {
  // The DSL source declares limitArrivals = 1 while the start message
  // requests arrivals = 100. The business ends when that single entity
  // leaves: fast mode must complete (no endless drain waiting for the 100
  // requested arrivals), the final Counters must be terminal, and
  // RunFinished must report the exact business end - not the config's
  // arrival quota.
  const std::string source = R"(model Flow {
  source S { arrival = constant(1.0) limitArrivals = true maxArrivals = 1 }
  delay D { delayTime = constant(0.2) maximumCapacity = true }
  sink K { }
  couple S.out -> D.in
  couple D.out -> K.in
}
)";
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_source(source, "flow-limited-source.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  logicpilot::server::ServerConfig config = make_test_config();
  config.generic_model = true;
  config.model_bytes.assign(compiled.v2_bytes.begin(), compiled.v2_bytes.end());
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":100,"warmup":0})");

  bool completed = false;
  std::uint64_t counters_frames = 0;
  std::map<std::string, double> last_counters;
  std::int64_t last_counters_sim_ns = INT64_MIN;
  std::int64_t run_finished_sim_ns = INT64_MIN;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;  // skip the control ack text frame
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        last_counters = counters_to_map(frame.counters->values());
        last_counters_sim_ns = frame.sim_time_ns;
        ++counters_frames;
        break;
      }
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        run_finished_sim_ns = frame.sim_time_ns;
        goto done;
      default:
        FAIL("unexpected frame kind for a flow run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  // The run completes promptly (the source is exhausted at maxArrivals =
  // 1, so the server must not drain toward the requested 100 arrivals).
  REQUIRE(counters_frames > 0);
  REQUIRE(counters_frames <= 48);
  // Final frame is terminal: exactly one entity, all buffers drained.
  REQUIRE(last_counters.at("block.S.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.buffered") == 0.0);
  REQUIRE(last_counters.at("block.D.in_service") == 0.0);
  REQUIRE(last_counters.at("block.K.arrived") == 1.0);
  REQUIRE(last_counters.at("block.K.departed") == 1.0);
  // Exact business end: 1.0 s arrival + 0.2 s delay = 1.2 s.
  REQUIRE(last_counters_sim_ns == 1'200'000'000LL);
  REQUIRE(run_finished_sim_ns == last_counters_sim_ns);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server fast mode: final mm1 counters show a drained system",
          "[server][integration][fast]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":20000,"warmup":0})");

  bool completed = false;
  std::uint64_t counters_frames = 0;
  std::map<std::string, double> last_counters;
  std::int64_t last_counters_sim_ns = INT64_MIN;
  std::int64_t run_finished_sim_ns = INT64_MIN;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Tick:
        break;  // mm1 pairs every Counters with a Tick
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        last_counters = counters_to_map(frame.counters->values());
        last_counters_sim_ns = frame.sim_time_ns;
        ++counters_frames;
        break;
      }
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        run_finished_sim_ns = frame.sim_time_ns;
        goto done;
      default:
        FAIL("unexpected frame kind for an mm1 run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  REQUIRE(counters_frames > 0);
  REQUIRE(counters_frames <= 48);
  // The final Counters reflects the drained system: no queue, no busy
  // server, every arrival departed - not the state before the silent drain.
  REQUIRE(last_counters.at("queue_length") == 0.0);
  REQUIRE(last_counters.at("busy") == 0.0);
  REQUIRE(last_counters.at("departures") == last_counters.at("arrivals"));
  REQUIRE(run_finished_sim_ns > 0);
  REQUIRE(run_finished_sim_ns == last_counters_sim_ns);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server stop terminates a fast run promptly",
          "[server][integration][fast]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  client.send_text(
      R"({"cmd":"start","seed":7,"reps":1,"arrivals":20000,"warmup":0})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  // The fast run completes in milliseconds, so a fixed frame count cannot
  // prove the worker is still dispatching when stop lands (the run could
  // finish - and emit RunFinished(Completed) - before the stop command is
  // processed). Gate the stop on a telemetry proof of mid-flight state: a
  // Counters frame whose departures are still below the arrival total.
  bool mid_flight = false;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_RunStarted ||
        frame.kind == wire::FrameKind_Tick) {
      continue;
    }
    if (frame.kind == wire::FrameKind_Counters) {
      REQUIRE(frame.counters != nullptr);
      if (counters_to_map(frame.counters->values()).at("departures") <
          20000.0) {
        mid_flight = true;
        break;
      }
      continue;
    }
    FAIL("run finished before the stop could be issued");
    break;
  }
  REQUIRE(mid_flight);

  // Stop must land while the replication is still running (the drain loop
  // and the slice loop both honor stop_request_).
  client.send_text(R"({"cmd":"stop"})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  bool finished = false;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_RunFinished) {
      REQUIRE(frame.run_finished->status() == wire::RunStatus_Cancelled);
      finished = true;
      break;
    }
  }
  REQUIRE(finished);
  client.abort_from_other_thread();
  server.stop();
}

namespace {

// Read every binary frame on `client` until RunFinished (or the socket
// closes). Runs on its own thread per client so a fan-out run can be drained
// by several clients concurrently.
struct BroadcastCapture {
  bool completed{false};
  std::vector<std::uint64_t> seqs;
  std::size_t counters{0};
};

BroadcastCapture drain_broadcast(WsClient& client) {
  BroadcastCapture capture;
  while (client.read_one()) {
    const ParsedFrame frame = parse_frame(client.payload());
    if (!frame.valid) {
      continue;  // text control acks are not part of the binary stream
    }
    capture.seqs.push_back(frame.seq);
    if (frame.kind == wire::FrameKind_Counters) {
      ++capture.counters;
    }
    if (frame.kind == wire::FrameKind_RunFinished) {
      capture.completed = true;
      break;
    }
  }
  return capture;
}

}  // namespace

TEST_CASE("lp-server broadcasts identical frames to every connected client",
          "[server][integration]") {
  logicpilot::server::ServerConfig config = make_test_config();
  // The run below floods frames at speed=100000; on debug builds the single
  // network thread cannot keep up, so the default 256-frame cap would drop
  // the oldest frames (deliberately covered by the slow-client test). Raise
  // the cap above the whole run's burst (~3722 frames for arrivals=1500) so
  // this test asserts complete identical fan-out, not the drop policy.
  config.write_queue_limit = 8192;
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  // Three clients join before the run starts; each drains the broadcast on
  // its own background reader so all three consume frames concurrently.
  WsClient a, b, c;
  REQUIRE(a.connect(server.port()));
  REQUIRE(b.connect(server.port()));
  REQUIRE(c.connect(server.port()));
  Watchdog watchdog_a{a, std::chrono::seconds{90}};
  Watchdog watchdog_b{b, std::chrono::seconds{90}};
  Watchdog watchdog_c{c, std::chrono::seconds{90}};

  BroadcastCapture ca, cb, cc;
  std::thread ta([&] { ca = drain_broadcast(a); });
  std::thread tb([&] { cb = drain_broadcast(b); });
  std::thread tc([&] { cc = drain_broadcast(c); });

  // Give every handshake a moment to register its session before the run
  // starts, so no client misses the RunStarted frame.
  std::this_thread::sleep_for(std::chrono::milliseconds(200));
  a.send_text(R"({"cmd":"start","seed":42,"reps":1,"arrivals":1500,)"
              R"("warmup":150,"speed":100000})");

  ta.join();
  tb.join();
  tc.join();

  REQUIRE(ca.completed);
  REQUIRE(cb.completed);
  REQUIRE(cc.completed);
  // Fan-out is one byte stream per session: same frame count and identical
  // seq sequences, plus the same number of Counters frames.
  REQUIRE(ca.seqs.size() == cb.seqs.size());
  REQUIRE(ca.seqs.size() == cc.seqs.size());
  REQUIRE(ca.seqs == cb.seqs);
  REQUIRE(ca.seqs == cc.seqs);
  REQUIRE(ca.counters > 0);
  REQUIRE(ca.counters == cb.counters);
  REQUIRE(ca.counters == cc.counters);

  a.abort_from_other_thread();
  b.abort_from_other_thread();
  c.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server bounds a slow client's write queue by dropping frames",
          "[server][integration]") {
  logicpilot::server::ServerConfig config = make_test_config();
  config.write_queue_limit = 8;  // tiny cap so drops engage quickly
  // Pin a small kernel send buffer: the run's ~38 KB of frames fits inside
  // OS-default send buffers on Windows (autotuned far larger than Linux),
  // which previously absorbed the whole run and left drops at 0-2.
  config.send_buffer_size = 2048;
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  // Client connects with a tiny receive buffer and never reads: the socket
  // blocks after a few frames, the pending queue hits the cap, and the
  // oldest frames are dropped instead of growing without bound.
  WsClient slow;
  REQUIRE(slow.connect(server.port(), 40, /*small_receive_buffer=*/true));
  Watchdog watchdog{slow, std::chrono::seconds{60}};

  slow.send_text(R"({"cmd":"start","seed":42,"reps":1,"arrivals":3000,)"
                 R"("warmup":100,"speed":100000})");

  // Wait until the run's frames have all been enqueued (the drop counter
  // goes stable), then assert the cap actually engaged.
  std::uint64_t previous = server.total_dropped_frames();
  std::uint64_t stable_samples = 0;
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds{45};
  while (std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const std::uint64_t current = server.total_dropped_frames();
    if (current == previous) {
      if (++stable_samples >= 3) {
        break;
      }
    } else {
      stable_samples = 0;
      previous = current;
    }
  }

  INFO("dropped frames = " << server.total_dropped_frames());
  // The run emits ~98 frames (fast-mode telemetry budget); the socket
  // blocks after a few, so the cap must have dropped the majority rather
  // than queueing them without bound.
  REQUIRE(server.total_dropped_frames() > 10);
  // A stuck consumer must not wedge the control plane (speed needs no run).
  const std::string reply =
      server.handle_control(R"({"cmd":"speed","speed":2})");
  CHECK(reply.find("\"ok\":true") != std::string::npos);

  slow.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server is deterministic: same seed => identical counters",
          "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{90}};

  const std::string start_json =
      R"({"cmd":"start","seed":7,"reps":2,"arrivals":2000,"warmup":200,)"
      R"("speed":100000})";
  const RunCapture first = capture_run(client, start_json);
  REQUIRE(first.ok);
  REQUIRE(first.completed);
  const RunCapture second = capture_run(client, start_json);
  REQUIRE(second.ok);
  REQUIRE(second.completed);

  // Bit-identical terminal Counters and RunFinished statistics.
  REQUIRE(first.last_counters.size() == second.last_counters.size());
  for (const auto& [name, value] : first.last_counters) {
    INFO("counter " << name);
    REQUIRE(second.last_counters.count(name) == 1);
    REQUIRE(second.last_counters.at(name) == value);
  }
  REQUIRE(first.stats.size() == second.stats.size());
  for (const auto& [name, value] : first.stats) {
    INFO("stat " << name);
    REQUIRE(second.stats.count(name) == 1);
    REQUIRE(second.stats.at(name) == value);
  }

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server rejects unknown and invalid control messages",
          "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{30}};

  client.send_text(R"({"cmd":"launch"})");
  REQUIRE(client.read_one());
  REQUIRE(!client.was_binary());
  REQUIRE(client.payload().find("\"ok\":false") != std::string::npos);
  REQUIRE(client.payload().find("unknown command") != std::string::npos);

  // Echoed cmd values are JSON-escaped so the error reply stays valid JSON
  // even when the value contains quotes, backslashes, or control characters.
  client.send_text("{\"cmd\":\"a\\\"b\\\\c\"}");
  REQUIRE(client.read_one());
  REQUIRE(!client.was_binary());
  REQUIRE(client.payload().find("\"ok\":false") != std::string::npos);
  REQUIRE(client.payload().find("unknown command") != std::string::npos);
  // A standards-compliant parser preserves the complete decoded value; the
  // reply then escapes its quote and backslash again as valid JSON.
  REQUIRE(client.payload().find("a\\\"b\\\\c") != std::string::npos);

  client.send_text("{\"cmd\":\"line1\nline2\"}");  // raw LF inside the value
  REQUIRE(client.read_one());
  REQUIRE(!client.was_binary());
  REQUIRE(client.payload().find("\"ok\":false") != std::string::npos);
  // The reply must be printable ASCII only (no raw control characters).
  for (const char c : client.payload()) {
    REQUIRE(static_cast<unsigned char>(c) >= 0x20);
  }

  client.send_text("not json at all");
  REQUIRE(client.read_one());
  REQUIRE(client.payload().find("\"ok\":false") != std::string::npos);

  // pause with no active run is an error too.
  client.send_text(R"({"cmd":"pause"})");
  REQUIRE(client.read_one());
  REQUIRE(client.payload().find("\"ok\":false") != std::string::npos);

  client.send_text(R"({"cmd":"start","confidence":1})");
  REQUIRE(client.read_one());
  REQUIRE(!client.was_binary());
  REQUIRE(client.payload().find("confidence must be between 0 and 1") !=
          std::string::npos);

  client.send_text(R"({"cmd":"start","seedMode":"surprise"})");
  REQUIRE(read_next_text(client).find("seedMode must be") != std::string::npos);
  client.send_text(R"({"cmd":"start","replicationMode":"forever"})");
  REQUIRE(read_next_text(client).find("replicationMode must be") !=
          std::string::npos);
  client.send_text(R"({"cmd":"start","executionMode":"turbo"})");
  REQUIRE(read_next_text(client).find("executionMode must be") !=
          std::string::npos);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server compiles DSL via the compile control command",
          "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{30}};

  // Valid source (the shape the IDE's generateDsl emits): ok + diagnostics.
  const std::string valid = R"(model Test {
  resource Server {
    capacity = 1
  }
  source Arrivals {
    arrival = rate(0.8)
  }
  queue WaitLine {
    capacity = 100
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  sink Done {
  }
  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
)";
  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(valid) + "\"}");
  const std::string ok_reply = read_next_text(client);
  REQUIRE(ok_reply.find("\"ok\": true") != std::string::npos);
  REQUIRE(ok_reply.find("\"diagnostics\"") != std::string::npos);

  // Invalid source: the diagnostics document reports the failure.
  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode("model X { nonsense }") + "\"}");
  const std::string bad_reply = read_next_text(client);
  REQUIRE(bad_reply.find("\"ok\": false") != std::string::npos);
  REQUIRE(bad_reply.find("diagnostics") != std::string::npos);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server streams generic process flows with per-block counters",
          "[server][integration][flow]") {
  // A delay-based flow (not the M/M/1 family) must run through the generic
  // ProcessFlowSim streaming path and expose live per-block state so the IDE
  // can badge blocks and animate tokens.
  const std::string source = R"(model Flow {
  source S { arrival = rate(1.0) }
  delay D { delayTime = constant(0.5) maximumCapacity = true }
  sink K { }
  couple S.out -> D.in
  couple D.out -> K.in
}
)";
  const logicpilot::dsl::CompileResult compiled =
      logicpilot::dsl::compile_source(source, "flow.lp");
  REQUIRE(compiled.ok);
  logicpilot::IrLoadResult loaded = logicpilot::load_model_buffer(
      compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  logicpilot::server::ServerConfig config = make_test_config();
  config.generic_model = true;
  config.model_bytes.assign(compiled.v2_bytes.begin(), compiled.v2_bytes.end());
  logicpilot::server::SimServer server{config};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};
  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(source) + "\"}");
  const std::string compile_reply = read_next_text(client);
  REQUIRE(compile_reply.find("\"ok\": true") != std::string::npos);
  // Animated mode with a huge speed: fixed 1 s slices so a slice boundary
  // reliably catches the entity inside the delay (fast mode would grow the
  // slices and skip the in-flight sample).
  client.send_text(
      R"({"cmd":"start","seed":42,"reps":1,"arrivals":20,"warmup":0,)"
      R"("executionMode":"animated","speed":100000})");

  bool completed = false;
  std::map<std::string, double> last_counters;
  bool saw_delay_in_service = false;
  std::uint64_t counters_frames = 0;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;  // skip the control ack text frame
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    switch (frame.kind) {
      case wire::FrameKind_RunStarted:
        break;
      case wire::FrameKind_Counters: {
        REQUIRE(frame.counters != nullptr);
        last_counters = counters_to_map(frame.counters->values());
        ++counters_frames;
        if (last_counters.count("block.D.in_service") != 0 &&
            last_counters.at("block.D.in_service") > 0) {
          saw_delay_in_service = true;
        }
        break;
      }
      case wire::FrameKind_RunFinished:
        completed = frame.run_finished != nullptr &&
                    frame.run_finished->status() == wire::RunStatus_Completed;
        goto done;
      default:
        FAIL("unexpected frame kind for a flow run");
        goto done;
    }
  }
  FAIL("connection closed before RunFinished");
done:
  REQUIRE(completed);
  REQUIRE(counters_frames > 0);
  // Live per-block telemetry must include every stage.
  for (const char* key : {"block.S.buffered", "block.D.buffered",
                          "block.D.in_service", "block.D.arrived",
                          "block.K.arrived"}) {
    INFO("missing counter " << key);
    REQUIRE(last_counters.count(key) == 1);
  }
  REQUIRE(saw_delay_in_service);  // a slice caught the entity in the delay
  REQUIRE(last_counters.at("block.D.arrived") >= 1);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server start honors per-run model parameter overrides",
          "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  const RunCapture capture = capture_run(
      client,
      R"({"cmd":"start","servers":2,"lambda":0.5,"mu":1.5,"arrivals":300,"warmup":30,"speed":100000})");
  REQUIRE(capture.ok);
  REQUIRE(capture.completed);
  // The overridden resource capacity must reach the streaming driver.
  REQUIRE(capture.last_counters.at("servers") == 2.0);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server streams agent population ticks after compile",
          "[server][integration][agent]") {
  const std::string source = R"(model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick { flip active }
    on_tick { bounce }
  }
}
)";
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));
  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(source) + "\"}");
  REQUIRE(read_next_text(client).find("\"ok\": true") != std::string::npos);
  client.send_text(
      R"({"cmd":"start","seed":7,"arrivals":4,"warmup":0,"executionMode":"animated","speed":1000000})");

  bool completed = false;
  bool saw_population_tick = false;
  bool saw_agent_counters = false;
  while (client.read_one()) {
    if (!client.was_binary()) continue;
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_Tick) {
      REQUIRE(frame.tick != nullptr);
      if (frame.tick->deltas() != nullptr && frame.tick->deltas()->size() == 3) {
        saw_population_tick = true;
      }
    } else if (frame.kind == wire::FrameKind_Counters) {
      const auto counters = counters_to_map(frame.counters->values());
      if (counters.count("agent_count") != 0 && counters.at("agent_count") == 3.0 &&
          counters.count("agent_tick") != 0 && counters.at("agent_tick") >= 1.0) {
        saw_agent_counters = true;
      }
    } else if (frame.kind == wire::FrameKind_RunFinished) {
      completed = frame.run_finished != nullptr &&
                  frame.run_finished->status() == wire::RunStatus_Completed;
      break;
    }
  }
  REQUIRE(completed);
  REQUIRE(saw_population_tick);
  REQUIRE(saw_agent_counters);
  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server streams statechart active-state counters after compile",
          "[server][integration][statechart]") {
  const std::string source = R"(model Traffic {
  statechart Light {
    initial = Red
    state Red { }
    state Green { }
    transition r_g { from = Red; to = Green; triggeredBy = timeout; timeout = 3.0 }
    transition g_r { from = Green; to = Red; triggeredBy = timeout; timeout = 3.0 }
  }
}
)";
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));
  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(source) + "\"}");
  REQUIRE(read_next_text(client).find("\"ok\": true") != std::string::npos);
  client.send_text(
      R"({"cmd":"start","seed":7,"arrivals":4,"warmup":0,"executionMode":"animated","speed":1000000})");

  bool completed = false;
  bool saw_red = false;
  bool saw_green = false;
  bool saw_steps = false;
  while (client.read_one()) {
    if (!client.was_binary()) continue;
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_Counters) {
      const auto counters = counters_to_map(frame.counters->values());
      saw_red = saw_red || counters.count("state.active.Red") != 0;
      saw_green = saw_green || counters.count("state.active.Green") != 0;
      saw_steps = saw_steps ||
                  (counters.count("state.steps") != 0 &&
                   counters.at("state.steps") >= 1.0);
    } else if (frame.kind == wire::FrameKind_RunFinished) {
      completed = frame.run_finished != nullptr &&
                  frame.run_finished->status() == wire::RunStatus_Completed;
      break;
    }
  }
  REQUIRE(completed);
  REQUIRE(saw_red);
  REQUIRE(saw_green);
  REQUIRE(saw_steps);
  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server streams continuous values after compile",
          "[server][integration][continuous]") {
  const std::string source = R"(model Decay {
  continuous Dynamics {
    state y: float = 1.0
    d y/dt = -y
  }
}
)";
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));
  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(source) + "\"}");
  REQUIRE(read_next_text(client).find("\"ok\": true") != std::string::npos);
  client.send_text(
      R"({"cmd":"start","seed":7,"arrivals":20,"warmup":0,"executionMode":"animated","speed":1000000})");

  bool completed = false;
  std::map<std::string, double> last_counters;
  while (client.read_one()) {
    if (!client.was_binary()) continue;
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_Counters) {
      last_counters = counters_to_map(frame.counters->values());
    } else if (frame.kind == wire::FrameKind_RunFinished) {
      completed = frame.run_finished != nullptr &&
                  frame.run_finished->status() == wire::RunStatus_Completed;
      break;
    }
  }
  REQUIRE(completed);
  REQUIRE(last_counters.count("continuous.time") == 1);
  REQUIRE(last_counters.count("continuous.step") == 1);
  REQUIRE(last_counters.count("continuous.value.y") == 1);
  REQUIRE(last_counters.at("continuous.time") == 0.2);
  REQUIRE(last_counters.at("continuous.step") == 20.0);
  REQUIRE(last_counters.at("continuous.value.y") < 1.0);
  REQUIRE(last_counters.at("continuous.value.y") > 0.7);
  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server streams atomic transition counters after compile",
          "[server][integration][atomic]") {
  const std::string source = R"(model PulseChain {
  atomic Pulser {
    time_advance = constant(1.0)
    on_timeout { emit pulse }
  }
  atomic Sink {
    state seen = false
    on_input pulse { seen = true }
  }
  couple Pulser.pulse -> Sink.pulse
}
)";
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));
  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  client.send_text("{\"cmd\":\"compile\",\"source_b64\":\"" +
                   base64_encode(source) + "\"}");
  REQUIRE(read_next_text(client).find("\"ok\": true") != std::string::npos);
  client.send_text(
      R"({"cmd":"start","seed":7,"arrivals":4,"warmup":0,"executionMode":"animated","speed":1000000})");

  bool completed = false;
  std::map<std::string, double> last_counters;
  while (client.read_one()) {
    if (!client.was_binary()) continue;
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_Counters) {
      last_counters = counters_to_map(frame.counters->values());
    } else if (frame.kind == wire::FrameKind_RunFinished) {
      completed = frame.run_finished != nullptr &&
                  frame.run_finished->status() == wire::RunStatus_Completed;
      break;
    }
  }
  REQUIRE(completed);
  REQUIRE(last_counters.count("atomic.time") == 1);
  REQUIRE(last_counters.count("atomic.step") == 1);
  REQUIRE(last_counters.at("atomic.time") == 4.0);
  REQUIRE(last_counters.at("atomic.step") == 4.0);
  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server stops precision replications after the confidence target",
          "[server][integration][precision]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));
  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  const RunCapture capture = capture_run(
      client,
      R"({"cmd":"start","replicationMode":"precision","minReps":2,"maxReps":8,"errorPercent":1000000,"precisionMetric":"Wq","arrivals":100,"warmup":0,"speed":100000})");
  REQUIRE(capture.ok);
  REQUIRE(capture.completed);
  REQUIRE(capture.stats.at("reps") == 2.0);
  REQUIRE(capture.stats.at("precision.target_percent") == 1000000.0);
  REQUIRE(capture.stats.count("precision.actual_percent") == 1);

  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("lp-server pause/step/resume control flow", "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  // Slow run (near-realtime) so the pause window is meaningful: pacing only
  // happens in animated mode.
  client.send_text(
      R"({"cmd":"start","seed":3,"reps":1,"arrivals":500,"warmup":50,)"
      R"("executionMode":"animated","speed":2})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  // Consume a couple of telemetry frames, then pause.
  for (int i = 0; i < 4; ++i) {
    REQUIRE(client.read_one());
  }
  client.send_text(R"({"cmd":"pause"})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  // Step advances exactly one Tick+Counters pair (buffered telemetry from
  // before the pause may precede the ack; read_next_text skips it).
  client.send_text(R"({"cmd":"step"})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);
  REQUIRE(client.read_one());
  REQUIRE(client.was_binary());  // Tick
  REQUIRE(client.read_one());
  REQUIRE(client.was_binary());  // Counters

  client.send_text(R"({"cmd":"resume"})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  client.send_text(R"({"cmd":"stop"})");
  REQUIRE(read_next_text(client).find("\"ok\":true") != std::string::npos);

  // Drain to RunFinished (Cancelled).
  bool finished = false;
  while (client.read_one()) {
    if (!client.was_binary()) {
      continue;
    }
    const ParsedFrame frame = parse_frame(client.payload());
    REQUIRE(frame.valid);
    if (frame.kind == wire::FrameKind_RunFinished) {
      REQUIRE(frame.run_finished->status() == wire::RunStatus_Cancelled);
      finished = true;
      break;
    }
  }
  REQUIRE(finished);
  client.abort_from_other_thread();
  server.stop();
}

TEST_CASE("streaming driver is bit-exact against kernel QueueingFlowSim",
          "[server][determinism]") {
  logicpilot::server::StreamRunConfig config;
  config.seed = 1234;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;
  config.lambda = 0.8;
  config.mu = 1.0;

  logicpilot::server::SimRunner runner;
  runner.reset(config);
  std::int64_t boundary = 0;
  while (!runner.finished()) {
    boundary += 100'000'000;
    runner.process_until(boundary);
  }
  const logicpilot::ReplicationMetrics streamed = runner.metrics();

  logicpilot::Mm1Simulator simulator{logicpilot::Mm1Params{0.8, 1.0}};
  logicpilot::ReplicationConfig reference_config;
  reference_config.seed = 1234;
  reference_config.arrivals = 3000;
  reference_config.warmup_arrivals = 300;
  const logicpilot::ReplicationMetrics reference =
      simulator.run(reference_config, nullptr);

  REQUIRE(streamed.departures == reference.departures);
  REQUIRE(streamed.horizon_seconds == reference.horizon_seconds);
  REQUIRE(streamed.throughput == reference.throughput);
  REQUIRE(streamed.mean_in_system == reference.mean_in_system);
  REQUIRE(streamed.mean_in_queue == reference.mean_in_queue);
  REQUIRE(streamed.mean_sojourn == reference.mean_sojourn);
  REQUIRE(streamed.mean_wait == reference.mean_wait);
}

TEST_CASE("streaming driver is bit-exact under failures and multiple "
          "servers", "[server][determinism][failure]") {
  logicpilot::server::StreamRunConfig config;
  config.seed = 4242;
  config.arrivals = 4000;
  config.warmup_arrivals = 400;
  config.lambda = 0.8;
  config.mu = 1.0;
  config.servers = 2;
  config.failure_rate = 0.2;
  config.repair_rate = 1.5;

  logicpilot::server::SimRunner runner;
  runner.reset(config);
  std::int64_t boundary = 0;
  while (!runner.finished()) {
    boundary += 100'000'000;
    runner.process_until(boundary);
  }
  const logicpilot::ReplicationMetrics streamed = runner.metrics();

  // Same spec the streaming driver derives from its config: build the
  // kernel QueueingFlowSim and require bit-identical metrics.
  logicpilot::QueueingFlowSpec spec;
  spec.interarrival = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{0.8};
    return dist(engine);
  };
  spec.service = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.0};
    return dist(engine);
  };
  spec.servers = 2;
  spec.failure = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{0.2};
    return dist(engine);
  };
  spec.repair = [](logicpilot::Xoshiro256PlusPlus& engine) {
    logicpilot::Exponential<logicpilot::Xoshiro256PlusPlus> dist{1.5};
    return dist(engine);
  };
  logicpilot::QueueingFlowSim simulator{std::move(spec)};
  logicpilot::ReplicationConfig reference_config;
  reference_config.seed = 4242;
  reference_config.arrivals = 4000;
  reference_config.warmup_arrivals = 400;
  const logicpilot::ReplicationMetrics reference =
      simulator.run(reference_config, nullptr);

  REQUIRE(streamed.departures == reference.departures);
  REQUIRE(streamed.horizon_seconds == reference.horizon_seconds);
  REQUIRE(streamed.throughput == reference.throughput);
  REQUIRE(streamed.mean_in_system == reference.mean_in_system);
  REQUIRE(streamed.mean_in_queue == reference.mean_in_queue);
  REQUIRE(streamed.mean_sojourn == reference.mean_sojourn);
  REQUIRE(streamed.mean_wait == reference.mean_wait);
}

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
        asio::connect(ws_.next_layer(), results);
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
      R"("speed":100000})");

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
  // ~7500 frames for this run; the socket blocks after ~tens, so the cap
  // must have dropped the overwhelming majority rather than queueing them.
  REQUIRE(server.total_dropped_frames() > 500);
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
  // `a\` is extracted as the cmd value; the backslash must appear doubled
  // (raw `\\` bytes) in the reply, never emitted bare.
  REQUIRE(client.payload().find("a\\\\") != std::string::npos);

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

TEST_CASE("lp-server pause/step/resume control flow", "[server][integration]") {
  logicpilot::server::SimServer server{make_test_config()};
  std::string error;
  REQUIRE(server.start(&error));

  WsClient client;
  REQUIRE(client.connect(server.port()));
  Watchdog watchdog{client, std::chrono::seconds{60}};

  // Slow run (near-realtime) so the pause window is meaningful.
  client.send_text(
      R"({"cmd":"start","seed":3,"reps":1,"arrivals":500,"warmup":50,)"
      R"("speed":2})");
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

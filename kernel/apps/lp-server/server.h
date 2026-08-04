// lp-server - WebSocket gateway for realtime simulation streaming (task #7).
//
// One SimServer owns:
//   * a Boost.Beast WebSocket listener (default ws://127.0.0.1:<port>/sim),
//     any number of concurrent subscriber sessions,
//   * a simulation worker thread driving the streaming M/M/1 replication
//     (sim_runner.h) with wall-clock pacing (default 10 Hz emit rate),
//   * a broadcast hub: the worker builds wire.fbs frames and fans them out
//     to every connected session through strand-serialized async writes.
//
// Control plane: JSON text frames from any client
//   {"cmd":"start"|"pause"|"resume"|"step"|"stop","speed":n,"seed":s,
//    "reps":r,"arrivals":n,"warmup":n}
// are routed through SimServer::handle_control() (thread-safe) and answered
// with a JSON ack/error text frame. pause/step/speed are thread-safe; the
// speed multiplier only affects wall-clock pacing, never simulation results
// (same seed => same frames).
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace logicpilot::server {

class Session;  // one WebSocket client connection (defined in server.cpp)

// Slow-consumer guard default: a client that stops reading would otherwise
// grow its per-session write queue without bound at 10 Hz telemetry. When a
// queue exceeds the limit the oldest pending frames are dropped (the
// in-flight frame is never dropped).
inline constexpr std::size_t kDefaultWriteQueueLimit = 256;

struct ServerConfig {
  unsigned short port{8089};
  std::string model_name{"mm1"};  // reported in RunStarted.model_name
  // Run defaults (overridable per-run via the start control message).
  std::uint64_t seed{42};
  std::uint64_t reps{1};
  std::uint64_t arrivals{4000};
  std::uint64_t warmup{400};
  double lambda{0.8};
  double mu{1.0};
  // Milestone 1: model flow parameters (from the served IR model). servers
  // = resource capacity; failure_rate > 0 enables per-server breakdowns.
  std::int64_t servers{1};
  double failure_rate{0.0};
  double repair_rate{1.0};
  double speed{1.0};  // wall-clock pacing multiplier (1.0 = realtime)
  // Fixed simulation step between Tick+Counters emissions. Default 100 ms of
  // simulated time => 10 Hz at speed 1.0 (task #7 default cadence).
  std::int64_t emit_step_ns{100'000'000};
  // Per-session pending-write bound (see kDefaultWriteQueueLimit).
  std::size_t write_queue_limit{kDefaultWriteQueueLimit};
  bool trace{false};  // mirror every outgoing frame as JSON on stdout
};

class SimServer {
 public:
  explicit SimServer(ServerConfig config);
  ~SimServer();
  SimServer(const SimServer&) = delete;
  SimServer& operator=(const SimServer&) = delete;

  // Binds the listener synchronously (so port() is valid on return), then
  // starts the network + simulation worker threads. Returns false with
  // `error` filled when the port cannot be bound.
  bool start(std::string* error = nullptr);

  // Stop the run (if any), disconnect clients, join threads. Idempotent.
  void stop();

  // Actual bound port (differs from config when config.port == 0).
  [[nodiscard]] unsigned short port() const;
  [[nodiscard]] std::size_t client_count() const;
  [[nodiscard]] bool running() const;
  // Total frames dropped from slow-consumer queues since startup (test hook
  // for the bounded-queue guarantee: > 0 proves the cap engaged instead of
  // growing without bound).
  [[nodiscard]] std::uint64_t total_dropped_frames() const;

  // Route one JSON control message; returns the JSON reply text.
  // Thread-safe (called from session strands / tests).
  std::string handle_control(const std::string& message);

 private:
  struct Impl;
  friend class Session;  // Session drives the control router + hub
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot::server

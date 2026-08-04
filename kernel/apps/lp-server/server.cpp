// lp-server gateway implementation (Boost.Beast). See server.h for design.
#include "server.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <charconv>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <fmt/format.h>

#include <boost/asio.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>

#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/replication.h"
#include "json_controls.h"
#include "sim_runner.h"
#include "wire_frames.h"

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace asio = boost::asio;
using tcp = asio::ip::tcp;

namespace logicpilot::server {
namespace {

// Emit cadence: one Tick+Counters pair per ServerConfig::emit_step_ns of
// simulated time (default 100 ms => 10 Hz at speed 1.0). Speed scales
// wall-clock pacing only.
// Frame-size budget guard for per-tick agent deltas.
constexpr std::size_t kMaxAgentsPerTick = 1024;

}  // namespace

// ---------------------------------------------------------------------------
// Session - one WebSocket client connection.
// ---------------------------------------------------------------------------

class Session : public std::enable_shared_from_this<Session> {
 public:
  Session(tcp::socket socket, SimServer::Impl& server)
      : ws_(std::move(socket)), server_(server) {}

  void run();
  void send_binary(std::shared_ptr<const std::vector<std::uint8_t>> frame);
  void send_text(std::string text);
  void request_close();
  [[nodiscard]] std::uint64_t dropped_frames() const {
    return dropped_frames_;
  }

 private:
  struct OutMessage {
    bool binary{true};
    std::shared_ptr<const std::string> text;
    std::shared_ptr<const std::vector<std::uint8_t>> binary_data;
  };

  void on_accept(beast::error_code ec);
  void do_read();
  void on_read(beast::error_code ec, std::size_t bytes);
  void do_write();
  void on_write(beast::error_code ec, std::size_t bytes);
  void do_close();
  void enqueue(OutMessage message);

  websocket::stream<tcp::socket> ws_;
  SimServer::Impl& server_;
  beast::flat_buffer read_buffer_;
  std::deque<OutMessage> write_queue_;
  OutMessage in_flight_;
  std::uint64_t dropped_frames_{0};
  bool writing_{false};
  bool closing_{false};
};

// ---------------------------------------------------------------------------
// Impl - listener, hub, control router, simulation worker.
// ---------------------------------------------------------------------------
struct SimServer::Impl {
  ServerConfig config;

  // --- network ---
  asio::io_context ioc_{1};  // single-threaded run() on net_thread_
  asio::executor_work_guard<asio::io_context::executor_type> work_guard_{
      asio::make_work_guard(ioc_)};
  tcp::acceptor acceptor_{ioc_};
  std::thread net_thread_;
  unsigned short actual_port_{0};

  // --- hub ---
  std::mutex sessions_mutex_;
  std::vector<std::shared_ptr<Session>> sessions_;

  // --- run control (worker <-> control router) ---
  struct RunParams {
    std::uint64_t seed{42};
    std::uint64_t reps{1};
    std::uint64_t arrivals{4000};
    std::uint64_t warmup{400};
  };
  enum class RunState { kIdle, kRunning, kPaused };

  std::mutex run_mutex_;
  std::condition_variable run_cv_;
  RunState state_{RunState::kIdle};
  bool run_requested_{false};
  bool stop_request_{false};
  bool pending_step_{false};
  bool shutdown_{false};
  RunParams pending_params_;
  std::atomic<double> speed_{1.0};

  std::thread worker_thread_;
  SimRunner runner_;
  std::uint64_t run_counter_{0};
  std::uint64_t seq_{0};
  std::int64_t last_frame_sim_ns_{0};
  // Cumulative sim-time offset across replications so header.sim_time_ns is
  // monotonic for the whole run (each replication restarts its own clock).
  std::int64_t run_sim_offset_ns_{0};
  // True from the moment a start command is accepted until the worker has
  // emitted RunFinished (closes the pickup race for pause/stop commands).
  bool active_run_{false};

  // --- hub operations -------------------------------------------------------

  void add_session(const std::shared_ptr<Session>& session) {
    std::lock_guard lock{sessions_mutex_};
    sessions_.push_back(session);
  }

  void remove_session(const Session* session) {
    std::lock_guard lock{sessions_mutex_};
    std::erase_if(sessions_,
                  [&](const std::shared_ptr<Session>& s) {
                    return s.get() == session;
                  });
  }

  std::uint64_t total_dropped_frames() {
    std::lock_guard lock{sessions_mutex_};
    std::uint64_t total = 0;
    for (const auto& session : sessions_) {
      total += session->dropped_frames();
    }
    return total;
  }

  void broadcast(std::shared_ptr<const std::vector<std::uint8_t>> frame) {
    std::vector<std::shared_ptr<Session>> snapshot;
    {
      std::lock_guard lock{sessions_mutex_};
      snapshot = sessions_;
    }
    for (const auto& session : snapshot) {
      session->send_binary(frame);
    }
  }

  // Build + trace + fan out one frame. Worker thread only.
  void emit(std::vector<std::uint8_t> bytes, const std::string& trace_json) {
    if (config.trace && !trace_json.empty()) {
      fmt::print("[trace] {}\n", trace_json);
      std::fflush(stdout);
    }
    broadcast(std::make_shared<const std::vector<std::uint8_t>>(
        std::move(bytes)));
  }

  // --- control routing -------------------------------------------------------

  std::string handle_control(const std::string& message) {
    std::string cmd;
    if (!json_string_field(message, "cmd", cmd)) {
      return json_error("invalid control message (expected JSON with \"cmd\")");
    }

    double number = 0.0;
    const bool has_speed = json_number_field(message, "speed", number);
    double speed_value = number;

    if (cmd == "start") {
      RunParams params;
      params.seed = config.seed;
      params.reps = config.reps;
      params.arrivals = config.arrivals;
      params.warmup = config.warmup;
      double value = 0.0;
      if (json_number_field(message, "seed", value) && value >= 0.0) {
        params.seed = static_cast<std::uint64_t>(value);
      }
      if (json_number_field(message, "reps", value) && value >= 1.0) {
        params.reps = static_cast<std::uint64_t>(value);
      }
      if (json_number_field(message, "arrivals", value) && value >= 1.0) {
        params.arrivals = static_cast<std::uint64_t>(value);
      }
      if (json_number_field(message, "warmup", value) && value >= 0.0) {
        params.warmup = static_cast<std::uint64_t>(value);
      }
      if (params.warmup >= params.arrivals) {
        return json_error("warmup must be < arrivals");
      }
      std::lock_guard lock{run_mutex_};
      if (state_ != RunState::kIdle || run_requested_ || active_run_) {
        return json_error("a run is already in progress");
      }
      if (has_speed && speed_value > 0.0) {
        speed_.store(clamp_speed(speed_value));
      }
      pending_params_ = params;
      run_requested_ = true;
      active_run_ = true;
      run_cv_.notify_all();
      return json_ok(cmd);
    }

    if (cmd == "pause") {
      std::lock_guard lock{run_mutex_};
      if (!active_run_ || state_ != RunState::kRunning) {
        return json_error("no running run to pause");
      }
      state_ = RunState::kPaused;
      run_cv_.notify_all();
      return json_ok(cmd);
    }

    if (cmd == "resume") {
      std::lock_guard lock{run_mutex_};
      if (!active_run_ || state_ != RunState::kPaused) {
        return json_error("no paused run to resume");
      }
      state_ = RunState::kRunning;
      run_cv_.notify_all();
      return json_ok(cmd);
    }

    if (cmd == "step") {
      std::lock_guard lock{run_mutex_};
      if (!active_run_ || state_ != RunState::kPaused) {
        return json_error("step requires a paused run");
      }
      pending_step_ = true;
      run_cv_.notify_all();
      return json_ok(cmd);
    }

    if (cmd == "stop") {
      std::lock_guard lock{run_mutex_};
      if (!active_run_) {
        return json_error("no active run to stop");
      }
      stop_request_ = true;
      run_cv_.notify_all();
      return json_ok(cmd);
    }

    if (cmd == "speed") {
      if (!has_speed || speed_value <= 0.0) {
        return json_error("speed requires a positive \"speed\" value");
      }
      speed_.store(clamp_speed(speed_value));
      return json_ok(cmd);
    }

    return json_error(fmt::format("unknown command '{}'", cmd));
  }

  static double clamp_speed(double speed) {
    return std::clamp(speed, 1e-3, 1e6);
  }

  // --- simulation worker -----------------------------------------------------

  void worker_loop() {
    for (;;) {
      RunParams params;
      {
        std::unique_lock lock{run_mutex_};
        run_cv_.wait(lock, [&] { return run_requested_ || shutdown_; });
        if (!run_requested_) {
          return;  // shutdown with no pending run
        }
        params = pending_params_;
        run_requested_ = false;
        stop_request_ = false;
        pending_step_ = false;
        state_ = RunState::kRunning;
      }
      execute_run(params);
      {
        std::lock_guard lock{run_mutex_};
        state_ = RunState::kIdle;
        active_run_ = false;
      }
      run_cv_.notify_all();
    }
  }

  void execute_run(const RunParams& params) {
    ++run_counter_;
    const std::string run_id = fmt::format("run-{}", run_counter_);
    seq_ = 0;
    last_frame_sim_ns_ = 0;
    run_sim_offset_ns_ = 0;

    RunStartedFrame started;
    started.seq = ++seq_;
    started.run_id = run_id;
    started.model_name = config.model_name;
    started.seed = params.seed;
    emit(build_run_started_frame(started), trace_run_started(started));

    // Per-replication stream sharding identical to lpcli run (ADR-0007).
    const SeedStreams streams{params.seed};
    std::vector<ReplicationMetrics> results;
    bool cancelled = false;
    for (std::uint64_t rep = 0; rep < params.reps; ++rep) {
      StreamRunConfig run_config;
      run_config.seed = streams.derive_state(rep)[0];
      run_config.arrivals = params.arrivals;
  run_config.warmup_arrivals = params.warmup;
  run_config.lambda = config.lambda;
  run_config.mu = config.mu;
  run_config.servers = config.servers;
  run_config.failure_rate = config.failure_rate;
  run_config.repair_rate = config.repair_rate;
  runner_.reset(run_config);
      if (!stream_replication(params, rep)) {
        cancelled = true;
        break;
      }
      results.push_back(runner_.metrics());
      run_sim_offset_ns_ += runner_.now_ns();  // keep run sim time monotonic
      {
        std::lock_guard lock{run_mutex_};
        if (stop_request_) {
          cancelled = true;
          break;
        }
      }
    }

    RunFinishedFrame finished;
    finished.seq = ++seq_;
    finished.sim_time_ns = last_frame_sim_ns_;
    finished.run_id = run_id;
    if (cancelled) {
      finished.status = 2;  // Cancelled
    } else {
      finished.status = 0;  // Completed
      const ReplicationSummary summary = summarize_replications(results, 0.95);
      auto& stats = finished.stats;
      stats.push_back({"reps", static_cast<double>(summary.reps)});
      stats.push_back({"confidence", summary.confidence});
      const auto add_metric = [&](const char* name, const MetricSummary& m) {
        stats.push_back({fmt::format("{}.mean", name), m.mean});
        stats.push_back({fmt::format("{}.std", name), m.stddev});
        stats.push_back({fmt::format("{}.ci_low", name), m.ci_low});
        stats.push_back({fmt::format("{}.ci_high", name), m.ci_high});
      };
      add_metric("throughput", summary.throughput);
      add_metric("L", summary.mean_in_system);
      add_metric("Lq", summary.mean_in_queue);
      add_metric("W", summary.mean_sojourn);
      add_metric("Wq", summary.mean_wait);
    }
    emit(build_run_finished_frame(finished), trace_run_finished(finished));
  }

  // Pace one replication: process events in emit_step_ns sim slices, emitting
  // Tick+Counters per slice; wall-clock throttling honors the speed factor.
  // Returns false when the run was cancelled via stop.
  bool stream_replication(const RunParams& params, std::uint64_t rep) {
    const std::int64_t step_ns = config.emit_step_ns > 0
                                     ? config.emit_step_ns
                                     : 100'000'000;
    std::int64_t boundary_ns = 0;
    auto deadline = std::chrono::steady_clock::now();
    for (;;) {
      // Pause gate (wake on resume / step / stop).
      bool step_once = false;
      {
        std::unique_lock lock{run_mutex_};
        for (;;) {
          if (stop_request_) {
            return false;
          }
          if (state_ == RunState::kPaused) {
            if (pending_step_) {
              pending_step_ = false;
              step_once = true;
              break;
            }
            run_cv_.wait(lock);
            continue;
          }
          break;
        }
      }

      boundary_ns += step_ns;
      runner_.process_until(boundary_ns);
      emit_tick();
      emit_counters(params, rep);

      if (runner_.finished()) {
        return true;
      }

      if (step_once) {
        continue;  // single slice while paused; no wall-clock budget consumed
      }

      // Wall-clock pacing: speed x realtime, independent of sim results.
      const double speed = speed_.load(std::memory_order_relaxed);
      deadline += std::chrono::duration_cast<std::chrono::steady_clock::duration>(
          std::chrono::duration<double>(
              static_cast<double>(step_ns) * 1e-9 / speed));
      const auto now = std::chrono::steady_clock::now();
      if (deadline > now) {
        std::unique_lock lock{run_mutex_};
        run_cv_.wait_until(lock, deadline, [&] {
          return stop_request_ || state_ != RunState::kRunning;
        });
        if (stop_request_) {
          return false;
        }
      } else {
        deadline = now;  // behind schedule: catch up without sleeping
      }
    }
  }

  void emit_tick() {
    TickFrame tick;
    tick.seq = ++seq_;
    tick.sim_time_ns = run_sim_offset_ns_ + runner_.now_ns();
    runner_.snapshot_agents(tick.deltas, kMaxAgentsPerTick);
    last_frame_sim_ns_ = tick.sim_time_ns;
    emit(build_tick_frame(tick), trace_tick(tick));
  }

  void emit_counters(const RunParams& params, std::uint64_t rep) {
    CountersFrame counters;
    counters.seq = ++seq_;
    counters.sim_time_ns = run_sim_offset_ns_ + runner_.now_ns();
    runner_.fill_counters(counters.values, rep + 1, params.reps);
    last_frame_sim_ns_ = counters.sim_time_ns;
    emit(build_counters_frame(counters), trace_counters(counters));
  }

  // --- network plumbing --------------------------------------------------------

  void do_accept() {
    acceptor_.async_accept(
        asio::make_strand(ioc_),
        [this](beast::error_code ec, tcp::socket socket) {
          if (!ec) {
            auto session =
                std::make_shared<Session>(std::move(socket), *this);
            add_session(session);
            session->run();
          }
          if (acceptor_.is_open()) {
            do_accept();
          }
        });
  }
};

// ---------------------------------------------------------------------------
// Session implementation
// ---------------------------------------------------------------------------
void Session::run() {
  ws_.set_option(websocket::stream_base::timeout::suggested(
      beast::role_type::server));
  ws_.set_option(websocket::stream_base::decorator(
      [](websocket::response_type& response) {
        response.set(http::field::server, "LogicPilot-lp-server/1");
      }));
  auto self = shared_from_this();
  ws_.async_accept(
      [self](beast::error_code ec) { self->on_accept(ec); });
}

void Session::on_accept(beast::error_code ec) {
  if (ec) {
    server_.remove_session(this);
    return;
  }
  do_read();
}

void Session::do_read() {
  auto self = shared_from_this();
  ws_.async_read(read_buffer_, [self](beast::error_code ec, std::size_t n) {
    self->on_read(ec, n);
  });
}

void Session::on_read(beast::error_code ec, std::size_t) {
  if (ec) {
    server_.remove_session(this);
    return;
  }
  if (ws_.got_text()) {
    const std::string message = beast::buffers_to_string(read_buffer_.data());
    read_buffer_.consume(read_buffer_.size());
    const std::string reply = server_.handle_control(message);
    send_text(reply);
  } else {
    read_buffer_.consume(read_buffer_.size());  // binary control: ignore
  }
  do_read();
}

void Session::send_binary(std::shared_ptr<const std::vector<std::uint8_t>> frame) {
  auto self = shared_from_this();
  asio::post(ws_.get_executor(), [self, frame = std::move(frame)] {
    if (self->closing_) {
      return;
    }
    OutMessage message;
    message.binary = true;
    message.binary_data = std::move(frame);
    self->enqueue(std::move(message));
  });
}

void Session::send_text(std::string text) {
  auto self = shared_from_this();
  asio::post(ws_.get_executor(), [self, text = std::move(text)] {
    if (self->closing_) {
      return;
    }
    OutMessage message;
    message.binary = false;
    message.text = std::make_shared<const std::string>(std::move(text));
    self->enqueue(std::move(message));
  });
}

void Session::enqueue(OutMessage message) {
  write_queue_.push_back(std::move(message));
  // Bound memory for slow/stuck clients: drop the oldest pending frames. The
  // in-flight frame lives in in_flight_ (popped by do_write), so dropping the
  // queue front can never orphan the buffer the current async_write uses.
  while (write_queue_.size() > server_.config.write_queue_limit) {
    write_queue_.pop_front();
    ++dropped_frames_;
  }
  if (!writing_) {
    do_write();
  }
}

void Session::do_write() {
  writing_ = true;
  in_flight_ = std::move(write_queue_.front());
  write_queue_.pop_front();
  ws_.binary(in_flight_.binary);
  auto self = shared_from_this();
  if (in_flight_.binary) {
    ws_.async_write(asio::buffer(*in_flight_.binary_data),
                    [self](beast::error_code ec, std::size_t n) {
                      self->on_write(ec, n);
                    });
  } else {
    ws_.async_write(asio::buffer(*in_flight_.text),
                    [self](beast::error_code ec, std::size_t n) {
                      self->on_write(ec, n);
                    });
  }
}

void Session::on_write(beast::error_code ec, std::size_t) {
  in_flight_ = OutMessage{};
  if (ec) {
    server_.remove_session(this);
    return;
  }
  if (!write_queue_.empty()) {
    do_write();
  } else {
    writing_ = false;
  }
}

void Session::request_close() {
  auto self = shared_from_this();
  asio::post(ws_.get_executor(), [self] { self->do_close(); });
}

void Session::do_close() {
  if (closing_) {
    return;
  }
  closing_ = true;
  // Hard-close the transport: cancels any pending async reads/writes and
  // never blocks on the peer's close handshake (browser tabs vanish).
  beast::error_code ec;
  ws_.next_layer().close(ec);
  server_.remove_session(this);
}

// ---------------------------------------------------------------------------
// SimServer public surface
// ---------------------------------------------------------------------------
SimServer::SimServer(ServerConfig config) : impl_{std::make_unique<Impl>()} {
  impl_->config = std::move(config);
  impl_->speed_.store(Impl::clamp_speed(impl_->config.speed));
}

SimServer::~SimServer() { stop(); }

bool SimServer::start(std::string* error) {
  Impl& d = *impl_;
  const tcp::endpoint endpoint{tcp::v4(), d.config.port};
  try {
    d.acceptor_.open(endpoint.protocol());
    d.acceptor_.set_option(asio::socket_base::reuse_address(true));
    d.acceptor_.bind(endpoint);
    d.acceptor_.listen(asio::socket_base::max_listen_connections);
    d.actual_port_ = d.acceptor_.local_endpoint().port();
  } catch (const std::exception& e) {
    if (error != nullptr) {
      *error = e.what();
    }
    return false;
  }
  d.net_thread_ = std::thread([&d] {
    d.do_accept();
    d.ioc_.run();
  });
  d.worker_thread_ = std::thread([&d] { d.worker_loop(); });
  return true;
}

void SimServer::stop() {
  Impl& d = *impl_;
  if (d.worker_thread_.joinable()) {
    {
      std::lock_guard lock{d.run_mutex_};
      d.shutdown_ = true;
      d.stop_request_ = true;
      d.state_ = Impl::RunState::kRunning;  // unblock pause gates
    }
    d.run_cv_.notify_all();
    d.worker_thread_.join();
  }
  if (d.net_thread_.joinable()) {
    asio::post(d.ioc_, [&d] {
      beast::error_code ec;
      d.acceptor_.close(ec);
      std::vector<std::shared_ptr<Session>> sessions;
      {
        std::lock_guard lock{d.sessions_mutex_};
        sessions = std::move(d.sessions_);
        d.sessions_.clear();
      }
      for (const auto& session : sessions) {
        session->request_close();
      }
      d.work_guard_.reset();
    });
    d.net_thread_.join();
  }
}

unsigned short SimServer::port() const { return impl_->actual_port_; }

std::size_t SimServer::client_count() const {
  std::lock_guard lock{impl_->sessions_mutex_};
  return impl_->sessions_.size();
}

std::uint64_t SimServer::total_dropped_frames() const {
  return impl_->total_dropped_frames();
}

bool SimServer::running() const { return impl_->net_thread_.joinable(); }

std::string SimServer::handle_control(const std::string& message) {
  return impl_->handle_control(message);
}

}  // namespace logicpilot::server

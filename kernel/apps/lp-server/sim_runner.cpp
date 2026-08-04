// Streaming flow replication driver - implementation.
//
// The arrive/depart handlers below are a line-for-line replay of
// QueueingFlowSim::run() (kernel/src/devs/mm1.cpp). Only bookkeeping that the
// gateway needs and that never touches the RNG / scheduler differs:
//   * server_state_ / server_customer_   (scene synthesis)
//   * cumulative wait_sum_/wait_count_   (instead of wait_times_ vector)
// Determinism follows because RNG draw order, event scheduling and handler
// dispatch order are identical to the kernel.
#include "sim_runner.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/run.h"

namespace logicpilot::server {
namespace {

constexpr EventType kArriveEvent = 10;  // must match kernel mm1.cpp
constexpr EventType kDepartEvent = 11;
constexpr EventType kFailEvent = 12;
constexpr EventType kRepairEvent = 13;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

void SimRunner::reset(const StreamRunConfig& config) {
  config_ = config;
  engine_ = Xoshiro256PlusPlus{config.seed};
  scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  clock_ = SimulationClock{};
  handlers_.clear();

  // Interarrival/service samplers (identical to Mm1Simulator).
  const double lambda = config.lambda;
  const double mu = config.mu;
  spec_.interarrival = [lambda](Xoshiro256PlusPlus& engine) {
    Exponential<Xoshiro256PlusPlus> dist{lambda};
    return dist(engine);
  };
  spec_.service = [mu](Xoshiro256PlusPlus& engine) {
    Exponential<Xoshiro256PlusPlus> dist{mu};
    return dist(engine);
  };
  spec_.servers = config.servers < 1 ? 1 : config.servers;
  if (config.failure_rate > 0.0) {
    const double failure_rate = config.failure_rate;
    spec_.failure = [failure_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{failure_rate};
      return dist(engine);
    };
    const double repair_rate = config.repair_rate;
    spec_.repair = [repair_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{repair_rate};
      return dist(engine);
    };
  }

  queue_.clear();
  arrival_ns_.assign(config.arrivals, 0);
  service_start_ns_.assign(config.arrivals, 0);
  server_state_.assign(spec_.servers, ServerState::kIdle);
  server_customer_.assign(spec_.servers, 0);
  emitted_ = 0;
  in_system_ = 0;
  in_queue_ = 0;
  departures_ = 0;
  finished_ = false;
  last_ns_ = 0;
  area_system_ns_ = 0;
  area_queue_ns_ = 0;
  sojourn_sum_ = 0.0;
  sojourn_count_ = 0;
  wait_sum_ = 0.0;
  wait_count_ = 0;

  const auto accumulate_area = [this](std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns_;
    area_system_ns_ += dt * static_cast<std::int64_t>(in_system_);
    area_queue_ns_ += dt * static_cast<std::int64_t>(in_queue_);
    last_ns_ = now_ns;
  };

  // Starts service on `server` for `customer`: samples service time and (when
  // failures are enabled) a failure time, exactly mirroring the kernel's
  // start_service draw order (service first, then failure).
  const auto start_service = [this](std::uint64_t server,
                                    std::uint64_t customer) {
    server_state_[server] = ServerState::kBusy;
    server_customer_[server] = customer;
    service_start_ns_[customer] = clock_.now().as_ns();
    const std::int64_t service_ns = to_ns(spec_.service(engine_));
    if (!spec_.failure) {
      scheduler_->schedule(clock_.now() + SimTime::from_ns(service_ns),
                           kDepartEvent, depart_id_, server);
      return;
    }
    const std::int64_t failure_ns = to_ns(spec_.failure(engine_));
    if (failure_ns < service_ns) {
      scheduler_->schedule(clock_.now() + SimTime::from_ns(failure_ns),
                           kFailEvent, fail_id_, server);
    } else {
      scheduler_->schedule(clock_.now() + SimTime::from_ns(service_ns),
                           kDepartEvent, depart_id_, server);
    }
  };

  // Registered in kernel order (depart, arrive, fail, repair).
  depart_id_ = handlers_.add([this, accumulate_area,
                              start_service](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    const std::uint64_t id = server_customer_[server];
    --in_system_;
    ++departures_;
    if (id >= config_.warmup_arrivals) {
      wait_sum_ += static_cast<double>(service_start_ns_[id] -
                                       arrival_ns_[id]) *
                   1e-9;
      ++wait_count_;
      sojourn_sum_ +=
          static_cast<double>(now_ns - arrival_ns_[id]) * 1e-9;
      ++sojourn_count_;
    }

    server_state_[server] = ServerState::kIdle;
    if (!queue_.empty()) {
      const std::uint64_t next = queue_.front();
      queue_.pop_front();
      --in_queue_;
      start_service(server, next);
    }
  });

  arrive_id_ = handlers_.add([this, accumulate_area,
                              start_service](const Event& event) {
    const std::uint64_t id = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    arrival_ns_[id] = now_ns;

    // Emit the next arrival (source keeps generating until the quota).
    if (emitted_ < config_.arrivals) {
      const double gap = spec_.interarrival(engine_);
      scheduler_->schedule(clock_.now() + SimTime::from_ns(to_ns(gap)),
                          kArriveEvent, arrive_id_, emitted_);
      ++emitted_;
    }

    const auto idle = std::find_if(server_state_.begin(),
                                   server_state_.end(),
                                   [](ServerState state) {
                                     return state == ServerState::kIdle;
                                   });
    if (idle != server_state_.end()) {
      ++in_system_;
      start_service(static_cast<std::uint64_t>(idle - server_state_.begin()),
                    id);
    } else {
      ++in_system_;
      ++in_queue_;
      queue_.push_back(id);
    }
  });
  fail_id_ = handlers_.add([this, accumulate_area](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    const std::uint64_t id = server_customer_[server];
    server_state_[server] = ServerState::kDown;
    // Preemptive-repeat: the customer in service returns to the queue head.
    queue_.push_front(id);
    ++in_queue_;
    const std::int64_t repair_ns = to_ns(spec_.repair(engine_));
    scheduler_->schedule(clock_.now() + SimTime::from_ns(repair_ns),
                         kRepairEvent, repair_id_, server);
  });
  repair_id_ = handlers_.add([this, accumulate_area,
                              start_service](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    server_state_[server] = ServerState::kIdle;
    if (!queue_.empty()) {
      const std::uint64_t next = queue_.front();
      queue_.pop_front();
      --in_queue_;
      start_service(server, next);
    }
  });

  // Seed the first arrival (matches kernel seeding exactly).
  emitted_ = 1;
  scheduler_->schedule(SimTime::from_ns(to_ns(spec_.interarrival(engine_))),
                      kArriveEvent, arrive_id_, 0);
}

std::size_t SimRunner::process_until(std::int64_t boundary_ns) {
  const std::size_t dispatched = run_until(
      *scheduler_, clock_, SimTime::from_ns(boundary_ns),
      [this](const Event& event) { handlers_.dispatch(event); });
  if (scheduler_->empty()) {
    finished_ = true;
  }
  return dispatched;
}

ReplicationMetrics SimRunner::metrics() const {
  ReplicationMetrics metrics;
  metrics.arrivals = config_.arrivals;
  metrics.departures = departures_;
  const std::int64_t horizon_ns = clock_.now().as_ns();
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  metrics.throughput = horizon_ns > 0
                           ? static_cast<double>(departures_) /
                                 metrics.horizon_seconds
                           : 0.0;
  metrics.mean_in_system = horizon_ns > 0
                               ? static_cast<double>(area_system_ns_) /
                                     static_cast<double>(horizon_ns)
                               : 0.0;
  metrics.mean_in_queue = horizon_ns > 0
                              ? static_cast<double>(area_queue_ns_) /
                                    static_cast<double>(horizon_ns)
                              : 0.0;
  metrics.mean_wait = wait_count_ == 0
                          ? 0.0
                          : wait_sum_ / static_cast<double>(wait_count_);
  metrics.mean_sojourn =
      sojourn_count_ == 0
          ? 0.0
          : sojourn_sum_ / static_cast<double>(sojourn_count_);
  return metrics;
}

void SimRunner::snapshot_agents(std::vector<TickAgent>& out,
                                std::size_t max_agents) {
  out.clear();
  for (std::size_t i = 0; i < server_state_.size(); ++i) {
    if (server_state_[i] != ServerState::kBusy || out.size() >= max_agents) {
      continue;
    }
    TickAgent agent;
    agent.id = server_customer_[i];
    agent.pos_x = 0.0f;
    agent.pos_y = 0.0f;
    agent.state_bits = 1;  // bit0: in service
    out.push_back(agent);
  }
  std::size_t slot = 1;
  for (const std::uint64_t id : queue_) {
    if (out.size() >= max_agents) {
      break;
    }
    TickAgent agent;
    agent.id = id;
    agent.pos_x = static_cast<float>(slot);
    agent.pos_y = 0.0f;
    agent.state_bits = 0;  // waiting
    out.push_back(agent);
    ++slot;
  }
}

void SimRunner::fill_counters(std::vector<CounterValue>& out,
                              std::uint64_t rep_index,
                              std::uint64_t reps_total) const {
  const ReplicationMetrics m = metrics();
  out.clear();
  out.push_back({"queue_length", static_cast<double>(in_queue_)});
  std::int64_t busy_count = 0;
  std::int64_t down_count = 0;
  for (const ServerState state : server_state_) {
    busy_count += state == ServerState::kBusy ? 1 : 0;
    down_count += state == ServerState::kDown ? 1 : 0;
  }
  out.push_back({"busy", static_cast<double>(busy_count)});
  out.push_back({"down_servers", static_cast<double>(down_count)});
  out.push_back({"servers", static_cast<double>(server_state_.size())});
  out.push_back({"throughput", m.throughput});
  out.push_back({"mean_wait", m.mean_wait});
  out.push_back({"mean_sojourn", m.mean_sojourn});
  out.push_back({"mean_in_system", m.mean_in_system});
  out.push_back({"mean_in_queue", m.mean_in_queue});
  out.push_back({"arrivals", static_cast<double>(config_.arrivals)});
  out.push_back({"departures", static_cast<double>(departures_)});
  out.push_back({"rep", static_cast<double>(rep_index)});
  out.push_back({"reps", static_cast<double>(reps_total)});
}

}  // namespace logicpilot::server

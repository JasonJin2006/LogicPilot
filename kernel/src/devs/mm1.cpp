// QueueingFlowSim / Mm1Simulator implementation.
//
// Hot loop: one BinaryHeapScheduler + arrive/depart handlers (plus
// fail/repair when the spec carries a failure law). The engine is
// incremental since the Method Runtime Layer (Phase 3): reset() prepares one
// replication, advance(until) dispatches every event with timestamp <= until
// (run drains completely at until = infinity, so a full replication yields
// steady-state statistics without horizon truncation), metrics() reports the
// accumulated statistics. run() = reset() + advance(infinity) + metrics()
// and stays bit-identical to the legacy batch call.
#include "logicpilot/devs/mm1.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <deque>
#include <vector>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/run.h"

namespace logicpilot {
namespace {

constexpr EventType kArriveEvent = 10;
constexpr EventType kDepartEvent = 11;
constexpr EventType kFailEvent = 12;
constexpr EventType kRepairEvent = 13;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

QueueingFlowSim::QueueingFlowSim(QueueingFlowSpec spec)
    : spec_{std::move(spec)} {}

void QueueingFlowSim::reset(const ReplicationConfig& config) {
  config_ = config;
  wait_times_.clear();
  dropped_ = 0;

  engine_ = Xoshiro256PlusPlus{config.seed};
  scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  clock_ = SimulationClock{};
  handlers_ = EventHandlerRegistry{};

  queue_.clear();
  servers_.assign(spec_.servers < 1 ? 1 : spec_.servers, Server{});
  arrival_ns_.assign(config.arrivals, 0);
  service_start_ns_.assign(config.arrivals, 0);
  emitted_ = 0;
  in_system_ = 0;
  in_queue_ = 0;
  departures_ = 0;
  busy_servers_ = 0;
  down_servers_ = 0;
  has_failure_ = static_cast<bool>(spec_.failure);

  last_ns_ = 0;
  area_system_ns_ = 0;
  area_queue_ns_ = 0;
  area_busy_ns_ = 0;
  area_down_ns_ = 0;
  sojourn_sum_ = 0.0;
  sojourn_count_ = 0;

  // Begins service on `server` for `customer`: samples service time, and
  // (when failures are enabled) a failure time. A failure that would land
  // before the service completes preempts the customer back to the queue
  // head and sends the server down (preemptive-repeat, milestone 1).
  const auto start_service = [this](std::uint64_t server,
                                    std::uint64_t customer) {
    Server& s = servers_[server];
    s.state = ServerState::kBusy;
    s.customer = customer;
    ++busy_servers_;
    service_start_ns_[customer] = clock_.now().as_ns();
    const std::int64_t service_ns = to_ns(spec_.service(engine_));
    if (!has_failure_) {
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

  const auto accumulate_area = [this](std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns_;
    area_system_ns_ += dt * static_cast<std::int64_t>(in_system_);
    area_queue_ns_ += dt * static_cast<std::int64_t>(in_queue_);
    area_busy_ns_ += dt * busy_servers_;
    area_down_ns_ += dt * down_servers_;
    last_ns_ = now_ns;
  };

  // Real handlers (registry ids are stable after this block).
  depart_id_ = handlers_.add(
      [this, accumulate_area, start_service](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers_[server];
    const std::uint64_t id = s.customer;
    --in_system_;
    ++departures_;
    if (id >= config_.warmup_arrivals) {
      // Final wait = arrival -> last service start (preemption-aware).
      wait_times_.push_back(
          static_cast<double>(service_start_ns_[id] - arrival_ns_[id]) *
          1e-9);
      sojourn_sum_ +=
          static_cast<double>(now_ns - arrival_ns_[id]) * 1e-9;
      ++sojourn_count_;
    }

    s.state = ServerState::kIdle;
    --busy_servers_;
    if (!queue_.empty()) {
      const std::uint64_t next = queue_.front();
      queue_.pop_front();
      --in_queue_;
      start_service(server, next);
    }
  });
  arrive_id_ = handlers_.add(
      [this, accumulate_area, start_service](const Event& event) {
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

    const auto idle_server =
        std::find_if(servers_.begin(), servers_.end(), [](const Server& s) {
          return s.state == ServerState::kIdle;
        });
    if (idle_server != servers_.end()) {
      ++in_system_;
      start_service(
          static_cast<std::uint64_t>(idle_server - servers_.begin()), id);
    } else if (spec_.queue_capacity < 0 ||
               static_cast<std::int64_t>(queue_.size()) <
                   spec_.queue_capacity) {
      ++in_system_;
      ++in_queue_;
      queue_.push_back(id);
    } else {
      ++dropped_;  // finite buffer full: customer lost, never enters system
    }
  });
  fail_id_ = handlers_.add([this, accumulate_area](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers_[server];
    const std::uint64_t id = s.customer;
    s.state = ServerState::kDown;
    --busy_servers_;
    ++down_servers_;
    // Preemptive-repeat: the customer in service returns to the queue head
    // (preempted customers bypass the finite-buffer capacity check).
    queue_.push_front(id);
    ++in_queue_;
    const std::int64_t repair_ns = to_ns(spec_.repair(engine_));
    scheduler_->schedule(clock_.now() + SimTime::from_ns(repair_ns),
                         kRepairEvent, repair_id_, server);
  });
  repair_id_ = handlers_.add(
      [this, accumulate_area, start_service](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock_.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers_[server];
    s.state = ServerState::kIdle;
    --down_servers_;
    if (!queue_.empty()) {
      const std::uint64_t next = queue_.front();
      queue_.pop_front();
      --in_queue_;
      start_service(server, next);
    }
  });

  // Seed the first arrival; the handler chain then keeps the source going.
  emitted_ = 1;
  scheduler_->schedule(SimTime::from_ns(to_ns(spec_.interarrival(engine_))),
                       kArriveEvent, arrive_id_, 0);
}

std::size_t QueueingFlowSim::advance(SimTime until, TraceRecorder* trace) {
  return run_until(*scheduler_, clock_, until, [&](const Event& event) {
    if (trace != nullptr) {
      trace->record(event.at, event.type, event.payload);
    }
    handlers_.dispatch(event);
  });
}

ReplicationMetrics QueueingFlowSim::metrics() const {
  ReplicationMetrics metrics;
  metrics.arrivals = config_.arrivals;

  const std::int64_t horizon_ns = clock_.now().as_ns();
  metrics.departures = departures_;
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  metrics.throughput =
      horizon_ns > 0 ? static_cast<double>(departures_) /
                           metrics.horizon_seconds
                     : 0.0;
  metrics.mean_in_system =
      horizon_ns > 0
          ? static_cast<double>(area_system_ns_) /
                static_cast<double>(horizon_ns)
          : 0.0;
  metrics.mean_in_queue =
      horizon_ns > 0
          ? static_cast<double>(area_queue_ns_) /
                static_cast<double>(horizon_ns)
          : 0.0;
  double wait_sum = 0.0;
  for (double w : wait_times_) {
    wait_sum += w;
  }
  metrics.mean_wait = wait_times_.empty()
                          ? 0.0
                          : wait_sum / static_cast<double>(wait_times_.size());
  metrics.mean_sojourn = sojourn_count_ == 0
                             ? 0.0
                             : sojourn_sum_ / static_cast<double>(sojourn_count_);
  const double servers_total = static_cast<double>(servers_.size());
  if (horizon_ns > 0 && servers_total > 0.0) {
    metrics.utilization =
        static_cast<double>(area_busy_ns_) /
        static_cast<double>(horizon_ns) / servers_total;
    metrics.availability =
        1.0 - static_cast<double>(area_down_ns_) /
                  static_cast<double>(horizon_ns) / servers_total;
  }
  return metrics;
}

ReplicationMetrics QueueingFlowSim::run(const ReplicationConfig& config,
                                        TraceRecorder* trace) {
  reset(config);
  advance(SimTime::infinity(), trace);
  const ReplicationMetrics metrics = this->metrics();

  if (trace != nullptr) {
    // Fold final stat bits so the trace hash covers outcomes, not just the
    // event sequence.
    trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_wait));
    trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_sojourn));
    trace->absorb(departures_);
  }
  return metrics;
}

Mm1Theory mm1_theory(double lambda, double mu) {
  Mm1Theory t;
  t.rho = lambda / mu;
  const double slack = mu - lambda;
  t.wq = t.rho / slack;
  t.w = 1.0 / slack;
  t.lq = t.rho * t.rho / (1.0 - t.rho);
  t.l = lambda / slack;
  t.throughput = lambda;
  return t;
}

Mm1Theory mmc_theory(double lambda, double mu, std::int64_t servers) {
  const double c = static_cast<double>(servers);
  const double a = lambda / mu;  // offered load (Erlang units)
  Mm1Theory t;
  t.rho = a / c;  // system utilization (per-server, rho < 1 required)
  const double slack = c * mu - lambda;

  // Erlang-C: probability that all c servers are busy.
  //   C = (a^c / c!) * c/(c-a) /
  //       ( sum_{k=0}^{c-1} a^k/k! + (a^c / c!) * c/(c-a) )
  double sum = 1.0;   // k = 0 term
  double term = 1.0;  // a^k / k!
  for (std::int64_t k = 1; k < servers; ++k) {
    term *= a / static_cast<double>(k);
    sum += term;
  }
  const double last = term * a / c;  // a^c / c!
  const double busy_ratio = last * c / (c - a);
  const double erlang_c = busy_ratio / (sum + busy_ratio);

  t.wq = erlang_c / slack;
  t.w = t.wq + 1.0 / mu;
  t.lq = lambda * t.wq;
  t.l = lambda * t.w;
  t.throughput = lambda;
  return t;
}

Mm1Simulator::Mm1Simulator(Mm1Params params)
    : QueueingFlowSim{[&] {
        QueueingFlowSpec spec;
        const double lambda = params.lambda;
        const double mu = params.mu;
        spec.interarrival = [lambda](Xoshiro256PlusPlus& engine) {
          Exponential<Xoshiro256PlusPlus> dist{lambda};
          return dist(engine);
        };
        spec.service = [mu](Xoshiro256PlusPlus& engine) {
          Exponential<Xoshiro256PlusPlus> dist{mu};
          return dist(engine);
        };
        return spec;
      }()},
      params_{params} {}

}  // namespace logicpilot

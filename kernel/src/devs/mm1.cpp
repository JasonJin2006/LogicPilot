// QueueingFlowSim / Mm1Simulator implementation.
//
// Hot loop: one BinaryHeapScheduler + arrive/depart handlers (plus
// fail/repair when the spec carries a failure law). The run drains
// completely (all arrivals served), so every replication yields
// steady-state statistics without horizon truncation.
#include "logicpilot/devs/mm1.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <deque>
#include <vector>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"

namespace logicpilot {
namespace {

constexpr EventType kArriveEvent = 10;
constexpr EventType kDepartEvent = 11;
constexpr EventType kFailEvent = 12;
constexpr EventType kRepairEvent = 13;

enum class ServerState { kIdle, kBusy, kDown };

struct Server {
  ServerState state{ServerState::kIdle};
  std::uint64_t customer{0};  // customer in service while busy
};

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

}  // namespace

QueueingFlowSim::QueueingFlowSim(QueueingFlowSpec spec)
    : spec_{std::move(spec)} {}

ReplicationMetrics QueueingFlowSim::run(const ReplicationConfig& config,
                                        TraceRecorder* trace) {
  wait_times_.clear();
  dropped_ = 0;

  ReplicationMetrics metrics;
  metrics.arrivals = config.arrivals;

  Xoshiro256PlusPlus engine{config.seed};
  BinaryHeapScheduler scheduler{64};
  SimulationClock clock;
  EventHandlerRegistry handlers;

  // Flow state.
  std::deque<std::uint64_t> queue;              // waiting customer ids (FIFO)
  std::vector<Server> servers(spec_.servers < 1 ? 1 : spec_.servers);
  std::vector<std::int64_t> arrival_ns;         // per-customer arrival stamp
  std::vector<std::int64_t> service_start_ns;   // per-customer last service
                                                // start (final wait baseline)
  arrival_ns.resize(config.arrivals);
  service_start_ns.resize(config.arrivals);
  std::uint64_t emitted = 0;
  std::uint64_t in_system = 0;
  std::uint64_t in_queue = 0;
  std::uint64_t departures = 0;
  std::int64_t busy_servers = 0;
  std::int64_t down_servers = 0;
  const bool has_failure = static_cast<bool>(spec_.failure);

  // Statistics accumulators.
  std::int64_t last_ns = 0;
  std::int64_t area_system_ns = 0;  // sum of in_system * dt
  std::int64_t area_queue_ns = 0;
  std::int64_t area_busy_ns = 0;    // sum of busy servers * dt
  std::int64_t area_down_ns = 0;    // sum of down servers * dt
  double sojourn_sum = 0.0;
  std::uint64_t sojourn_count = 0;

  const auto accumulate_area = [&](std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns;
    area_system_ns += dt * static_cast<std::int64_t>(in_system);
    area_queue_ns += dt * static_cast<std::int64_t>(in_queue);
    area_busy_ns += dt * busy_servers;
    area_down_ns += dt * down_servers;
    last_ns = now_ns;
  };

  HandlerId arrive_id = 0;
  HandlerId depart_id = 0;
  HandlerId fail_id = 0;
  HandlerId repair_id = 0;

  // Begins service on `server` for `customer`: samples service time, and
  // (when failures are enabled) a failure time. A failure that would land
  // before the service completes preempts the customer back to the queue
  // head and sends the server down (preemptive-repeat, milestone 1).
  const auto start_service = [&](std::uint64_t server, std::uint64_t customer) {
    Server& s = servers[server];
    s.state = ServerState::kBusy;
    s.customer = customer;
    ++busy_servers;
    service_start_ns[customer] = clock.now().as_ns();
    const std::int64_t service_ns = to_ns(spec_.service(engine));
    if (!has_failure) {
      scheduler.schedule(clock.now() + SimTime::from_ns(service_ns),
                         kDepartEvent, depart_id, server);
      return;
    }
    const std::int64_t failure_ns = to_ns(spec_.failure(engine));
    if (failure_ns < service_ns) {
      scheduler.schedule(clock.now() + SimTime::from_ns(failure_ns),
                         kFailEvent, fail_id, server);
    } else {
      scheduler.schedule(clock.now() + SimTime::from_ns(service_ns),
                         kDepartEvent, depart_id, server);
    }
  };

  // Real handlers (registry ids are stable after this block).
  depart_id = handlers.add([&](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers[server];
    const std::uint64_t id = s.customer;
    --in_system;
    ++departures;
    if (id >= config.warmup_arrivals) {
      // Final wait = arrival -> last service start (preemption-aware).
      wait_times_.push_back(
          static_cast<double>(service_start_ns[id] - arrival_ns[id]) * 1e-9);
      sojourn_sum += static_cast<double>(now_ns - arrival_ns[id]) * 1e-9;
      ++sojourn_count;
    }

    s.state = ServerState::kIdle;
    --busy_servers;
    if (!queue.empty()) {
      const std::uint64_t next = queue.front();
      queue.pop_front();
      --in_queue;
      start_service(server, next);
    }
  });
  arrive_id = handlers.add([&](const Event& event) {
    const std::uint64_t id = event.payload;
    const std::int64_t now_ns = clock.now().as_ns();
    accumulate_area(now_ns);
    arrival_ns[id] = now_ns;

    // Emit the next arrival (source keeps generating until the quota).
    if (emitted < config.arrivals) {
      const double gap = spec_.interarrival(engine);
      scheduler.schedule(clock.now() + SimTime::from_ns(to_ns(gap)),
                         kArriveEvent, arrive_id, emitted);
      ++emitted;
    }

    const auto idle_server =
        std::find_if(servers.begin(), servers.end(), [](const Server& s) {
          return s.state == ServerState::kIdle;
        });
    if (idle_server != servers.end()) {
      ++in_system;
      start_service(
          static_cast<std::uint64_t>(idle_server - servers.begin()), id);
    } else if (spec_.queue_capacity < 0 ||
               static_cast<std::int64_t>(queue.size()) <
                   spec_.queue_capacity) {
      ++in_system;
      ++in_queue;
      queue.push_back(id);
    } else {
      ++dropped_;  // finite buffer full: customer lost, never enters system
    }
  });
  fail_id = handlers.add([&](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers[server];
    const std::uint64_t id = s.customer;
    s.state = ServerState::kDown;
    --busy_servers;
    ++down_servers;
    // Preemptive-repeat: the customer in service returns to the queue head
    // (preempted customers bypass the finite-buffer capacity check).
    queue.push_front(id);
    ++in_queue;
    const std::int64_t repair_ns = to_ns(spec_.repair(engine));
    scheduler.schedule(clock.now() + SimTime::from_ns(repair_ns),
                       kRepairEvent, repair_id, server);
  });
  repair_id = handlers.add([&](const Event& event) {
    const std::uint64_t server = event.payload;
    const std::int64_t now_ns = clock.now().as_ns();
    accumulate_area(now_ns);
    Server& s = servers[server];
    s.state = ServerState::kIdle;
    --down_servers;
    if (!queue.empty()) {
      const std::uint64_t next = queue.front();
      queue.pop_front();
      --in_queue;
      start_service(server, next);
    }
  });

  // Seed the first arrival; the handler chain then keeps the source going.
  emitted = 1;
  scheduler.schedule(SimTime::from_ns(to_ns(spec_.interarrival(engine))),
                     kArriveEvent, arrive_id, 0);

  run_until(scheduler, clock, SimTime::infinity(), [&](const Event& event) {
    if (trace != nullptr) {
      trace->record(event.at, event.type, event.payload);
    }
    handlers.dispatch(event);
  });

  const std::int64_t horizon_ns = clock.now().as_ns();
  metrics.departures = departures;
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  metrics.throughput =
      horizon_ns > 0 ? static_cast<double>(departures) /
                           metrics.horizon_seconds
                     : 0.0;
  metrics.mean_in_system = horizon_ns > 0
                               ? static_cast<double>(area_system_ns) /
                                     static_cast<double>(horizon_ns)
                               : 0.0;
  metrics.mean_in_queue = horizon_ns > 0
                              ? static_cast<double>(area_queue_ns) /
                                    static_cast<double>(horizon_ns)
                              : 0.0;
  double wait_sum = 0.0;
  for (double w : wait_times_) {
    wait_sum += w;
  }
  metrics.mean_wait = wait_times_.empty()
                          ? 0.0
                          : wait_sum / static_cast<double>(wait_times_.size());
  metrics.mean_sojourn = sojourn_count == 0
                             ? 0.0
                             : sojourn_sum / static_cast<double>(sojourn_count);
  const double servers_total = static_cast<double>(servers.size());
  if (horizon_ns > 0 && servers_total > 0.0) {
    metrics.utilization =
        static_cast<double>(area_busy_ns) /
        static_cast<double>(horizon_ns) / servers_total;
    metrics.availability =
        1.0 - static_cast<double>(area_down_ns) /
                  static_cast<double>(horizon_ns) / servers_total;
  }

  if (trace != nullptr) {
    // Fold final stat bits so the trace hash covers outcomes, not just the
    // event sequence.
    trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_wait));
    trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_sojourn));
    trace->absorb(departures);
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

// QueueingFlowSim / Mm1Simulator implementation.
//
// Hot loop: one BinaryHeapScheduler + two registered handlers (arrive,
// depart). The run drains completely (all arrivals served), so every
// replication yields steady-state statistics without horizon truncation.
#include "logicpilot/devs/mm1.h"

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
  std::vector<std::int64_t> arrival_ns;         // per-customer arrival stamp
  arrival_ns.resize(config.arrivals);
  std::uint64_t emitted = 0;
  bool busy = false;
  std::uint64_t in_system = 0;
  std::uint64_t in_queue = 0;
  std::uint64_t departures = 0;

  // Statistics accumulators.
  std::int64_t last_ns = 0;
  std::int64_t area_system_ns = 0;  // sum of in_system * dt
  std::int64_t area_queue_ns = 0;
  double sojourn_sum = 0.0;
  std::uint64_t sojourn_count = 0;

  const auto accumulate_area = [&](std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns;
    area_system_ns += dt * static_cast<std::int64_t>(in_system);
    area_queue_ns += dt * static_cast<std::int64_t>(in_queue);
    last_ns = now_ns;
  };

  HandlerId arrive_id = 0;
  HandlerId depart_id = 0;

  // Registered first so arrive/depart lambdas can call it by reference.
  const auto schedule_depart = [&](std::uint64_t customer) {
    const double s = spec_.service(engine);
    scheduler.schedule(clock.now() + SimTime::from_ns(to_ns(s)), kDepartEvent,
                       depart_id, customer);
  };

  // Real handlers (registry ids are stable after this block).
  depart_id = handlers.add([&](const Event& event) {
    const std::uint64_t id = event.payload;
    const std::int64_t now_ns = clock.now().as_ns();
    accumulate_area(now_ns);
    --in_system;
    ++departures;
    if (id >= config.warmup_arrivals) {
      sojourn_sum += static_cast<double>(now_ns - arrival_ns[id]) * 1e-9;
      ++sojourn_count;
    }

    if (!queue.empty()) {
      const std::uint64_t next = queue.front();
      queue.pop_front();
      --in_queue;
      const double wait =
          static_cast<double>(now_ns - arrival_ns[next]) * 1e-9;
      if (next >= config.warmup_arrivals) {
        wait_times_.push_back(wait);
      }
      schedule_depart(next);
    } else {
      busy = false;
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

    if (!busy) {
      busy = true;
      ++in_system;
      if (id >= config.warmup_arrivals) {
        wait_times_.push_back(0.0);  // straight into service, zero wait
      }
      schedule_depart(id);
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

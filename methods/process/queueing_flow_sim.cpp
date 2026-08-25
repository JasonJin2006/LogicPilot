// QueueingFlowSim implementation - the incremental flow engine of the
// process domain (ADR-0068 rehoming). Declared in logicpilot/devs/mm1.h
// until the header itself is split from the M/M/1 reference model.
#include "logicpilot/devs/mm1.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <deque>
#include <limits>
#include <vector>

#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/runtime/runtime_context.h"

namespace logicpilot {
namespace {

constexpr std::uint32_t kQueueingCheckpointMagic = 0x4C505151U;  // LPQQ
constexpr std::uint8_t kQueueingCheckpointVersion = 2;

void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int byte = 0; byte < 4; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  for (int byte = 0; byte < 8; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int byte = 0; byte < 4; ++byte) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int byte = 0; byte < 8; ++byte) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

std::string event_budget_error(std::uint64_t max_events) {
  return "KR1017: shared scheduler event budget exhausted (" +
         std::to_string(max_events) + " events)";
}

}  // namespace

QueueingFlowSim::QueueingFlowSim(QueueingFlowSpec spec)
    : spec_{std::move(spec)} {}

void QueueingFlowSim::reset(const ReplicationConfig& config) {
  config_ = config;
  wait_times_.clear();
  dropped_ = 0;

  engine_ = Xoshiro256PlusPlus{config.seed};
  if (external_ == nullptr) {
    // Owned facilities are replaced wholesale: stale events die with the
    // old scheduler, and handlers are re-registered against the fresh
    // registry.
    owned_scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
    owned_clock_ = SimulationClock{};
    owned_handlers_ = EventHandlerRegistry{};
    handlers_owner_ = nullptr;  // re-register against the fresh registry
  } else {
    // External (kernel-owned) scheduler survives across resets: cancel
    // every event this engine still owns, otherwise run_until would pop
    // the stale events and advance the shared clock before their no-op
    // handlers run.
    if (arrive_token_.valid()) {
      scheduler().cancel(arrive_token_);
    }
    for (const EventToken token : server_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
  }
  arrive_token_ = EventToken{};
  server_tokens_.assign(spec_.servers < 1 ? 1 : spec_.servers, EventToken{});
  arrive_event_ = PendingEvent{};
  server_events_.assign(spec_.servers < 1 ? 1 : spec_.servers, PendingEvent{});

  queue_.clear();
  servers_.assign(spec_.servers < 1 ? 1 : spec_.servers, Server{});
  arrival_ns_.assign(config.arrivals, 0);
  service_start_ns_.assign(config.arrivals, 0);
  emitted_ = 0;
  in_system_ = 0;
  in_queue_ = 0;
  departures_ = 0;
  dispatched_total_ = 0;
  budget_exhausted_ = false;
  failure_reason_.clear();
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
    service_start_ns_[customer] = clock().now().as_ns();
    const std::int64_t service_ns = to_ns(spec_.service(engine_));
    if (!has_failure_) {
      const SimTime at = clock().now() + SimTime::from_ns(service_ns);
      server_tokens_[server] = scheduler().schedule(at, kDepartEvent,
                                                     depart_id_, server);
      server_events_[server] = PendingEvent{at, kDepartEvent, server, true};
      return;
    }
    const std::int64_t failure_ns = to_ns(spec_.failure(engine_));
    if (failure_ns < service_ns) {
      const SimTime at = clock().now() + SimTime::from_ns(failure_ns);
      server_tokens_[server] = scheduler().schedule(at, kFailEvent, fail_id_,
                                                     server);
      server_events_[server] = PendingEvent{at, kFailEvent, server, true};
    } else {
      const SimTime at = clock().now() + SimTime::from_ns(service_ns);
      server_tokens_[server] = scheduler().schedule(at, kDepartEvent,
                                                     depart_id_, server);
      server_events_[server] = PendingEvent{at, kDepartEvent, server, true};
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

  // Register the handlers exactly once per (registry identity, epoch): a
  // replaced owned registry, an attach() to another context's registry, or
  // a registry clear() (epoch bump) invalidates the HandlerIds, so they
  // are re-registered before use; repeated resets on the same registry do
  // not accumulate duplicates.
  if (handlers_owner_ != &handlers() ||
      handlers_epoch_ != handlers().epoch()) {
    depart_id_ = handlers().add(
        [this, accumulate_area, start_service](const Event& event) {
      const std::uint64_t server = event.payload;
      server_tokens_[server] = EventToken{};  // this event was consumed
      server_events_[server] = PendingEvent{};
      const std::int64_t now_ns = clock().now().as_ns();
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
    arrive_id_ = handlers().add(
        [this, accumulate_area, start_service](const Event& event) {
      const std::uint64_t id = event.payload;
      arrive_token_ = EventToken{};  // this event was consumed
      arrive_event_ = PendingEvent{};
      const std::int64_t now_ns = clock().now().as_ns();
      accumulate_area(now_ns);
      arrival_ns_[id] = now_ns;

      // Emit the next arrival (source keeps generating until the quota).
      if (emitted_ < config_.arrivals) {
        const double gap = spec_.interarrival(engine_);
        const SimTime at = clock().now() + SimTime::from_ns(to_ns(gap));
        arrive_token_ = scheduler().schedule(at, kArriveEvent, arrive_id_,
                                             emitted_);
        arrive_event_ = PendingEvent{at, kArriveEvent, emitted_, true};
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
    fail_id_ = handlers().add([this, accumulate_area](const Event& event) {
      const std::uint64_t server = event.payload;
      server_tokens_[server] = EventToken{};  // this event was consumed
      server_events_[server] = PendingEvent{};
      const std::int64_t now_ns = clock().now().as_ns();
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
      const SimTime at = clock().now() + SimTime::from_ns(repair_ns);
      server_tokens_[server] = scheduler().schedule(at, kRepairEvent,
                                                     repair_id_, server);
      server_events_[server] = PendingEvent{at, kRepairEvent, server, true};
    });
    repair_id_ = handlers().add(
        [this, accumulate_area, start_service](const Event& event) {
      const std::uint64_t server = event.payload;
      server_tokens_[server] = EventToken{};  // this event was consumed
      server_events_[server] = PendingEvent{};
      const std::int64_t now_ns = clock().now().as_ns();
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
    handlers_owner_ = &handlers();
    handlers_epoch_ = handlers().epoch();
  }

  // Seed the first arrival only when arrivals > 0: arrival_ns_ and
  // service_start_ns_ are sized by config.arrivals, and payload 0 would
  // index out of bounds for an empty run.
  if (config_.arrivals > 0) {
    emitted_ = 1;
    const SimTime at =
        clock().now() + SimTime::from_ns(to_ns(spec_.interarrival(engine_)));
    arrive_token_ = scheduler().schedule(at, kArriveEvent, arrive_id_, 0);
    arrive_event_ = PendingEvent{at, kArriveEvent, 0, true};
  }
}

std::size_t QueueingFlowSim::advance(SimTime until, TraceRecorder* trace) {
  const std::size_t dispatched = run_until_bounded(
      scheduler(), clock(), until, config_.max_events, dispatched_total_,
      budget_exhausted_, [&](const Event& event) {
    if (trace != nullptr) {
      trace->record(event.at, event.type, event.payload);
    }
    handlers().dispatch(event);
  });
  if (budget_exhausted_) {
    failure_reason_ = event_budget_error(config_.max_events);
  }
  return dispatched;
}

bool QueueingFlowSim::checkpoint_save(
    std::vector<std::uint8_t>& state) const {
  if (config_.arrivals > std::numeric_limits<std::uint32_t>::max() ||
      servers_.size() > std::numeric_limits<std::uint32_t>::max() ||
      queue_.size() > std::numeric_limits<std::uint32_t>::max() ||
      wait_times_.size() > std::numeric_limits<std::uint32_t>::max()) {
    return false;
  }
  state.clear();
  append_u32(state, kQueueingCheckpointMagic);
  state.push_back(kQueueingCheckpointVersion);
  append_u64(state, config_.seed);
  append_u64(state, config_.arrivals);
  append_u64(state, config_.warmup_arrivals);
  append_u64(state, config_.max_events);
  const std::uint64_t* rng = engine_.state();
  for (int index = 0; index < 4; ++index) append_u64(state, rng[index]);
  append_u64(state, dropped_);
  append_u64(state, emitted_);
  append_u64(state, in_system_);
  append_u64(state, in_queue_);
  append_u64(state, departures_);
  append_u64(state, dispatched_total_);
  state.push_back(budget_exhausted_ ? 1 : 0);
  append_u64(state, static_cast<std::uint64_t>(busy_servers_));
  append_u64(state, static_cast<std::uint64_t>(down_servers_));
  state.push_back(has_failure_ ? 1 : 0);
  append_u64(state, static_cast<std::uint64_t>(last_ns_));
  append_u64(state, static_cast<std::uint64_t>(area_system_ns_));
  append_u64(state, static_cast<std::uint64_t>(area_queue_ns_));
  append_u64(state, static_cast<std::uint64_t>(area_busy_ns_));
  append_u64(state, static_cast<std::uint64_t>(area_down_ns_));
  append_u64(state, std::bit_cast<std::uint64_t>(sojourn_sum_));
  append_u64(state, sojourn_count_);

  append_u32(state, static_cast<std::uint32_t>(wait_times_.size()));
  for (const double value : wait_times_) {
    append_u64(state, std::bit_cast<std::uint64_t>(value));
  }
  append_u32(state, static_cast<std::uint32_t>(queue_.size()));
  for (const std::uint64_t customer : queue_) append_u64(state, customer);
  append_u32(state, static_cast<std::uint32_t>(servers_.size()));
  for (const Server& server : servers_) {
    state.push_back(static_cast<std::uint8_t>(server.state));
    append_u64(state, server.customer);
  }
  append_u32(state, static_cast<std::uint32_t>(arrival_ns_.size()));
  for (const std::int64_t value : arrival_ns_)
    append_u64(state, static_cast<std::uint64_t>(value));
  append_u32(state, static_cast<std::uint32_t>(service_start_ns_.size()));
  for (const std::int64_t value : service_start_ns_)
    append_u64(state, static_cast<std::uint64_t>(value));

  const auto append_event = [&](const PendingEvent& event) {
    state.push_back(event.valid ? 1 : 0);
    append_u64(state, static_cast<std::uint64_t>(event.at.as_ns()));
    append_u32(state, event.type);
    append_u64(state, event.payload);
  };
  append_event(arrive_event_);
  append_u32(state, static_cast<std::uint32_t>(server_events_.size()));
  for (const PendingEvent& event : server_events_) append_event(event);
  return true;
}

bool QueueingFlowSim::checkpoint_restore(
    std::span<const std::uint8_t> state) {
  std::size_t offset = 0;
  std::uint32_t magic = 0;
  std::uint64_t seed = 0, arrivals = 0, warmup = 0, max_events = 0;
  if (!read_u32(state, offset, magic) || magic != kQueueingCheckpointMagic ||
      offset >= state.size() || state[offset++] != kQueueingCheckpointVersion ||
      !read_u64(state, offset, seed) || !read_u64(state, offset, arrivals) ||
      !read_u64(state, offset, warmup) ||
      !read_u64(state, offset, max_events)) {
    return false;
  }
  if (arrivals > std::numeric_limits<std::uint32_t>::max()) return false;
  ReplicationConfig restored_config{seed, arrivals, warmup, max_events};
  std::uint64_t rng_state[4]{};
  for (std::uint64_t& value : rng_state) {
    if (!read_u64(state, offset, value)) return false;
  }
  std::uint64_t dropped = 0, emitted = 0, in_system = 0, in_queue = 0,
               departures = 0, dispatched_total = 0, busy = 0, down = 0;
  if (!read_u64(state, offset, dropped) || !read_u64(state, offset, emitted) ||
      !read_u64(state, offset, in_system) || !read_u64(state, offset, in_queue) ||
      !read_u64(state, offset, departures) ||
      !read_u64(state, offset, dispatched_total) || offset >= state.size())
    return false;
  const bool budget_exhausted = state[offset++] != 0;
  if (!read_u64(state, offset, busy) || !read_u64(state, offset, down) ||
      offset >= state.size()) return false;
  const bool has_failure = state[offset++] != 0;
  std::uint64_t raw = 0;
  std::int64_t last_ns = 0, area_system = 0, area_queue = 0, area_busy = 0,
               area_down = 0;
  double sojourn_sum = 0.0;
  std::uint64_t sojourn_count = 0;
  if (!read_u64(state, offset, raw)) return false;
  last_ns = static_cast<std::int64_t>(raw);
  if (!read_u64(state, offset, raw)) return false;
  area_system = static_cast<std::int64_t>(raw);
  if (!read_u64(state, offset, raw)) return false;
  area_queue = static_cast<std::int64_t>(raw);
  if (!read_u64(state, offset, raw)) return false;
  area_busy = static_cast<std::int64_t>(raw);
  if (!read_u64(state, offset, raw)) return false;
  area_down = static_cast<std::int64_t>(raw);
  if (!read_u64(state, offset, raw)) return false;
  sojourn_sum = std::bit_cast<double>(raw);
  if (!std::isfinite(sojourn_sum) || !read_u64(state, offset, sojourn_count))
    return false;

  std::uint32_t count = 0;
  if (!read_u32(state, offset, count)) return false;
  std::vector<double> waits;
  waits.reserve(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    if (!read_u64(state, offset, raw)) return false;
    const double value = std::bit_cast<double>(raw);
    if (!std::isfinite(value)) return false;
    waits.push_back(value);
  }
  std::uint32_t queue_count = 0;
  if (!read_u32(state, offset, queue_count)) return false;
  std::deque<std::uint64_t> queue;
  for (std::uint32_t index = 0; index < queue_count; ++index) {
    if (!read_u64(state, offset, raw)) return false;
    queue.push_back(raw);
  }
  std::uint32_t server_count = 0;
  if (!read_u32(state, offset, server_count) ||
      server_count != (spec_.servers < 1 ? 1 : spec_.servers)) return false;
  std::vector<Server> servers(server_count);
  for (Server& server : servers) {
    if (offset >= state.size()) return false;
    const std::uint8_t kind = state[offset++];
    if (kind > static_cast<std::uint8_t>(ServerState::kDown) ||
        !read_u64(state, offset, server.customer)) return false;
    server.state = static_cast<ServerState>(kind);
  }
  std::uint32_t arrival_count = 0, service_count = 0;
  if (!read_u32(state, offset, arrival_count) || arrival_count != arrivals)
    return false;
  std::vector<std::int64_t> arrival_ns(arrival_count);
  for (std::int64_t& value : arrival_ns) {
    if (!read_u64(state, offset, raw)) return false;
    value = static_cast<std::int64_t>(raw);
  }
  if (!read_u32(state, offset, service_count) || service_count != arrivals)
    return false;
  std::vector<std::int64_t> service_start(service_count);
  for (std::int64_t& value : service_start) {
    if (!read_u64(state, offset, raw)) return false;
    value = static_cast<std::int64_t>(raw);
  }
  const auto read_event = [&](PendingEvent& event) {
    if (offset >= state.size()) return false;
    event.valid = state[offset++] != 0;
    if (!read_u64(state, offset, raw)) return false;
    event.at = SimTime::from_ns(static_cast<std::int64_t>(raw));
    if (!read_u32(state, offset, event.type) ||
        !read_u64(state, offset, event.payload)) return false;
    return event.type == 0 || event.type == kArriveEvent ||
           event.type == kDepartEvent || event.type == kFailEvent ||
           event.type == kRepairEvent;
  };
  PendingEvent arrive_event;
  if (!read_event(arrive_event)) return false;
  std::uint32_t event_count = 0;
  if (!read_u32(state, offset, event_count) || event_count != server_count)
    return false;
  std::vector<PendingEvent> server_events(event_count);
  for (PendingEvent& event : server_events) {
    if (!read_event(event)) return false;
  }
  if (offset != state.size()) return false;

  // The engine's own tokens are canceled before replacing state; the method
  // runtime owns no other queue events in this fast-path checkpoint.
  if (arrive_token_.valid()) scheduler().cancel(arrive_token_);
  for (const EventToken token : server_tokens_) {
    if (token.valid()) scheduler().cancel(token);
  }
  config_ = restored_config;
  engine_.restore_state(rng_state);
  dropped_ = dropped;
  emitted_ = emitted;
  in_system_ = in_system;
  in_queue_ = in_queue;
  departures_ = departures;
  dispatched_total_ = dispatched_total;
  budget_exhausted_ = budget_exhausted;
  failure_reason_ = budget_exhausted ? event_budget_error(config_.max_events)
                                     : std::string{};
  busy_servers_ = static_cast<std::int64_t>(busy);
  down_servers_ = static_cast<std::int64_t>(down);
  has_failure_ = has_failure;
  last_ns_ = last_ns;
  area_system_ns_ = area_system;
  area_queue_ns_ = area_queue;
  area_busy_ns_ = area_busy;
  area_down_ns_ = area_down;
  sojourn_sum_ = sojourn_sum;
  sojourn_count_ = sojourn_count;
  wait_times_ = std::move(waits);
  queue_ = std::move(queue);
  servers_ = std::move(servers);
  arrival_ns_ = std::move(arrival_ns);
  service_start_ns_ = std::move(service_start);
  arrive_event_ = arrive_event;
  server_events_ = server_events;
  arrive_token_ = EventToken{};
  server_tokens_.assign(server_count, EventToken{});
  if (arrive_event_.valid) {
    arrive_token_ = scheduler().schedule(arrive_event_.at, arrive_event_.type,
                                         arrive_id_, arrive_event_.payload);
  }
  for (std::size_t index = 0; index < server_events_.size(); ++index) {
    if (server_events_[index].valid) {
      server_tokens_[index] = scheduler().schedule(
          server_events_[index].at, server_events_[index].type,
          server_events_[index].type == kDepartEvent
              ? depart_id_
              : server_events_[index].type == kFailEvent ? fail_id_ : repair_id_,
          server_events_[index].payload);
    }
  }
  return true;
}

std::int64_t QueueingFlowSim::now_ns() const {
  return clock().now().as_ns();
}

bool QueueingFlowSim::has_pending_events() {
  return !scheduler().empty();
}

void QueueingFlowSim::attach(RuntimeContext& context) {
  if (external_ != &context) {
    // Switching contexts: cancel every event this engine still owns on the
    // OLD scheduler. EventTokens carry no scheduler identity, so cancelling
    // them on the new scheduler could hit unrelated events of the new
    // context.
    // This also covers owned -> external migration after an owned run. A
    // never-reset owned engine has no scheduler or tokens to cancel.
    if (external_ != nullptr || owned_scheduler_ != nullptr) {
      if (arrive_token_.valid()) {
        scheduler().cancel(arrive_token_);
      }
      for (const EventToken token : server_tokens_) {
        if (token.valid()) {
          scheduler().cancel(token);
        }
      }
    }
    // Cancellation happened against the old scheduler. Forget those tokens
    // before switching so the next reset cannot replay them against the new
    // scheduler and accidentally cancel an unrelated colliding token.
    arrive_token_ = EventToken{};
    std::fill(server_tokens_.begin(), server_tokens_.end(), EventToken{});
    arrive_event_ = PendingEvent{};
    std::fill(server_events_.begin(), server_events_.end(), PendingEvent{});
    external_ = &context;
    handlers_owner_ = nullptr;  // re-register against the new registry
  }
}

IEventScheduler& QueueingFlowSim::scheduler() {
  return external_ != nullptr ? external_->scheduler() : *owned_scheduler_;
}

SimulationClock& QueueingFlowSim::clock() {
  return external_ != nullptr ? external_->clock() : owned_clock_;
}

const SimulationClock& QueueingFlowSim::clock() const {
  return external_ != nullptr ? external_->clock() : owned_clock_;
}

EventHandlerRegistry& QueueingFlowSim::handlers() {
  return external_ != nullptr ? external_->handlers() : owned_handlers_;
}

ReplicationMetrics QueueingFlowSim::metrics() const {
  ReplicationMetrics metrics;
  metrics.arrivals = config_.arrivals;

  const std::int64_t horizon_ns = clock().now().as_ns();
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
  if (!spec_.source_name.empty()) {
    BlockMetrics source;
    source.name = spec_.source_name;
    source.kind = "source";
    source.arrived = config_.arrivals;
    source.departed = config_.arrivals;
    metrics.blocks.push_back(std::move(source));

    if (spec_.has_queue_block) {
      BlockMetrics queue;
      queue.name = spec_.queue_name;
      queue.kind = "queue";
      queue.arrived = config_.arrivals;
      queue.departed = config_.arrivals - dropped_;
      queue.capacity = spec_.queue_capacity;
      queue.mean_occupancy = metrics.mean_in_queue;
      metrics.blocks.push_back(std::move(queue));
    }

    BlockMetrics service;
    service.name = spec_.service_name;
    service.kind = "service";
    service.arrived = departures_;
    service.departed = departures_;
    service.capacity = spec_.has_queue_block ? 0 : spec_.queue_capacity;
    service.utilization = metrics.utilization;
    service.availability = metrics.availability;
    metrics.blocks.push_back(std::move(service));

    if (!spec_.sink_name.empty()) {
      BlockMetrics sink;
      sink.name = spec_.sink_name;
      sink.kind = "sink";
      sink.arrived = departures_;
      sink.departed = departures_;
      metrics.blocks.push_back(std::move(sink));
    }
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

}  // namespace logicpilot

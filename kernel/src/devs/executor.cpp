// DevsExecutor implementation: coupling-tree flattening + next-event loop.
#include "logicpilot/devs/executor.h"
#include "logicpilot/devs/partition_transport.h"

#include <array>
#include <exception>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <unordered_set>
#include <utility>

namespace logicpilot {
namespace {

constexpr EventType kInternalEvent = 1;
constexpr EventType kExternalEvent = 2;

}  // namespace

DevsExecutor::DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock)
    : scheduler_{scheduler}, clock_{clock}, handlers_{owned_handlers_} {
  dispatch_handler_ = handlers_.add([this](const Event& event) { this->on_event(event); });
}

DevsExecutor::DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock,
                           EventHandlerRegistry& handlers)
    : scheduler_{scheduler}, clock_{clock}, handlers_{handlers} {
  dispatch_handler_ = handlers_.add([this](const Event& event) { this->on_event(event); });
}

std::size_t DevsExecutor::load(CoupledModel& root) {
  plan_ = DevsRuntimePlan::compile(root);
  pending_.clear();
  pending_at_.clear();
  last_transition_.clear();
  ext_inputs_.clear();
  dispatched_ = 0;
  internal_transitions_ = 0;
  all_pdevs_ = false;
  all_parallel_safe_ = false;
  if (recovery_epoch_ == 0) {
    recovery_epoch_ = 1;
  }
  if (evidence_ != nullptr) {
    evidence_->clear();
  }

  // Initial scheduling: every active atom gets its first internal event.
  pending_.assign(plan_.atom_count(), EventToken{});
  pending_at_.assign(plan_.atom_count(), SimTime::infinity());
  last_transition_.assign(plan_.atom_count(), clock_.now());
  all_pdevs_ = plan_.atom_count() != 0;
  all_parallel_safe_ = plan_.atom_count() != 0;
  for (std::uint32_t i = 0; i < plan_.atom_count(); ++i) {
    all_pdevs_ = all_pdevs_ && plan_.atom(i)->uses_pdevs_semantics();
    all_parallel_safe_ =
        all_parallel_safe_ && plan_.atom(i)->supports_parallel_execution();
    reschedule(i);
  }
  return plan_.atom_count();
}

bool DevsExecutor::save_checkpoint(DevsCheckpoint& checkpoint,
                                   std::string* error) const {
  if (error != nullptr) {
    error->clear();
  }
  const auto fail = [&](const std::string& message) {
    if (error != nullptr) {
      *error = message;
    }
    return false;
  };
  checkpoint = DevsCheckpoint{};
  if (plan_.atom_count() == 0) {
    return fail("DevsExecutor: cannot checkpoint an empty plan");
  }

  std::size_t owned_live_events = 0;
  for (std::size_t atom = 0; atom < plan_.atom_count(); ++atom) {
    if (pending_[atom].valid()) {
      ++owned_live_events;
    }
  }
  if (scheduler_.size() != owned_live_events) {
    return fail("DevsExecutor: checkpoint requires an executor-owned queue");
  }

  checkpoint.now = clock_.now();
  checkpoint.dispatched = dispatched_;
  checkpoint.internal_transitions = internal_transitions_;
  checkpoint.internal_budget = internal_budget_;
  checkpoint.recovery_epoch = recovery_epoch_;
  checkpoint.replay_watermarks = replay_watermarks_;
  checkpoint.atom_paths.reserve(plan_.atom_count());
  checkpoint.atoms.reserve(plan_.atom_count());
  for (std::size_t atom = 0; atom < plan_.atom_count(); ++atom) {
    const std::string path{plan_.atom_path(atom)};
    checkpoint.atom_paths.push_back(path);
    DevsAtomCheckpoint atom_checkpoint;
    atom_checkpoint.atom_path = path;
    atom_checkpoint.last_transition = last_transition_[atom];
    if (!plan_.atom(atom)->checkpoint_save(atom_checkpoint.state)) {
      return fail("DevsExecutor: atom '" + path +
                  "' does not support checkpoint_save");
    }
    checkpoint.atoms.push_back(std::move(atom_checkpoint));
  }
  return true;
}

bool DevsExecutor::restore_checkpoint(const DevsCheckpoint& checkpoint,
                                      std::string* error) {
  if (error != nullptr) {
    error->clear();
  }
  const auto fail = [&](const std::string& message) {
    if (error != nullptr) {
      *error = message;
    }
    return false;
  };
  const std::size_t count = plan_.atom_count();
  if (count == 0 || checkpoint.atoms.size() != count ||
      checkpoint.atom_paths.size() != count || pending_.size() != count) {
    return fail("DevsExecutor: checkpoint model shape does not match plan");
  }
  if (checkpoint.recovery_epoch != 0 &&
      checkpoint.recovery_epoch != recovery_epoch_) {
    return fail("DevsExecutor: checkpoint recovery epoch mismatch");
  }
  for (std::size_t atom = 0; atom < count; ++atom) {
    const std::string_view path = plan_.atom_path(atom);
    if (checkpoint.atom_paths[atom] != path ||
        checkpoint.atoms[atom].atom_path != path) {
      return fail("DevsExecutor: checkpoint atom paths do not match plan");
    }
  }

  std::size_t owned_live_events = 0;
  for (const EventToken token : pending_) {
    if (token.valid()) {
      ++owned_live_events;
    }
  }
  if (scheduler_.size() != owned_live_events) {
    return fail("DevsExecutor: restore requires an executor-owned queue");
  }

  // Validate state blobs before mutating scheduler state as far as the model
  // API allows. A model can still reject its blob during restore; callers must
  // discard the executor on such an error because arbitrary user state cannot
  // be transactionally rolled back by the kernel.
  for (std::size_t atom = 0; atom < count; ++atom) {
    if (!plan_.atom(atom)->checkpoint_restore(
            std::span<const std::uint8_t>{checkpoint.atoms[atom].state})) {
      return fail("DevsExecutor: atom '" + checkpoint.atom_paths[atom] +
                  "' rejected checkpoint_restore");
    }
  }

  for (std::uint32_t atom = 0; atom < count; ++atom) {
    cancel_pending(atom);
  }
  if (!scheduler_.empty()) {
    return fail("DevsExecutor: queue contains events outside the checkpoint");
  }
  clock_.reset(checkpoint.now);
  dispatched_ = checkpoint.dispatched;
  internal_transitions_ = checkpoint.internal_transitions;
  internal_budget_ = checkpoint.internal_budget;
  replay_watermarks_ = checkpoint.replay_watermarks;
  last_transition_.resize(count);
  for (std::size_t atom = 0; atom < count; ++atom) {
    last_transition_[atom] = checkpoint.atoms[atom].last_transition;
  }
  ext_inputs_.clear();
  if (evidence_ != nullptr) {
    evidence_->clear();
  }
  for (std::uint32_t atom = 0; atom < count; ++atom) {
    reschedule(atom);
  }
  return true;
}

bool DevsExecutor::save_checkpoint_bytes(std::vector<std::uint8_t>& bytes,
                                          std::string* error) const {
  DevsCheckpoint checkpoint;
  if (!save_checkpoint(checkpoint, error)) {
    return false;
  }
  try {
    bytes = DevsCheckpointCodec::encode(checkpoint);
  } catch (const std::exception& exception) {
    if (error != nullptr) *error = exception.what();
    return false;
  }
  return true;
}

bool DevsExecutor::restore_checkpoint_bytes(
    std::span<const std::uint8_t> bytes, std::string* error) {
  DevsCheckpoint checkpoint;
  if (!DevsCheckpointCodec::decode(bytes, checkpoint, error)) {
    return false;
  }
  return restore_checkpoint(checkpoint, error);
}

bool DevsExecutor::inject(const std::string& root_port, std::uint64_t payload) {
  const auto port = plan_.root_port_id(root_port);
  if (!port.has_value()) {
    return false;
  }
  const auto routes = plan_.root_targets(*port);
  if (routes.empty()) {
    return false;
  }
  if (!all_pdevs_) {
    for (const DevsRuntimePlan::RouteTarget& t : routes) {
      deliver_external(t.atom, PortEvent{t.port, payload});
    }
    return true;
  }

  // External inputs are a timestamp-level bag in PDEVS mode. If the current
  // clock is already at an imminent time, cancel those scheduler entries and
  // process every imminent atom together with the injected bag so lambda is
  // observed before delta_con. Otherwise only the targeted atoms are
  // externally transitioned and their future internal events are preempted.
  std::vector<std::vector<PendingInput>> incoming(plan_.atom_count());
  for (const DevsRuntimePlan::RouteTarget& target : routes) {
    incoming[target.atom].push_back(
        PendingInput{PortEvent{target.port, payload},
                     kExternalEvidenceSource});
  }
  const SimTime now = clock_.now();
  std::vector<std::uint32_t> imminent;
  for (std::uint32_t atom = 0; atom < plan_.atom_count(); ++atom) {
    if (pending_[atom].valid() && pending_at_[atom] == now) {
      imminent.push_back(atom);
      cancel_pending(atom);
    }
  }
  if (!imminent.empty()) {
    for (std::uint32_t atom = 0; atom < plan_.atom_count(); ++atom) {
      if (!incoming[atom].empty()) {
        cancel_pending(atom);
      }
    }
    process_pdevs_round(imminent, std::move(incoming));
    return true;
  }
  for (std::uint32_t atom = 0; atom < plan_.atom_count(); ++atom) {
    if (incoming[atom].empty()) {
      continue;
    }
    cancel_pending(atom);
    AtomicModel& model = *plan_.atom(atom);
    std::vector<PortEvent> inputs;
    std::vector<std::uint32_t> sources;
    inputs.reserve(incoming[atom].size());
    sources.reserve(incoming[atom].size());
    for (const PendingInput& input : incoming[atom]) {
      inputs.push_back(input.event);
      sources.push_back(input.source);
    }
    const SimTime elapsed = now - last_transition_[atom];
    model.external_transition_batch(now, elapsed, inputs);
    if (evidence_ != nullptr) {
      evidence_->record(now, atom, plan_.atom_path(atom),
                        DevsTransitionKind::kExternal, elapsed, inputs,
                        sources, {});
    }
    last_transition_[atom] = now;
    reschedule(atom);
  }
  return true;
}

std::size_t DevsExecutor::run(SimTime horizon) {
  if (all_pdevs_) {
    const std::size_t n = run_pdevs(horizon);
    dispatched_ += n;
    return n;
  }
  const std::size_t n = run_until(scheduler_, clock_, horizon,
                                  [this](const Event& event) { handlers_.dispatch(event); });
  dispatched_ += n;
  return n;
}

std::size_t DevsExecutor::run_parallel(SimTime horizon, std::size_t workers) {
  if (!parallel_supported() || workers <= 1 || plan_.atom_count() <= 1) {
    return run(horizon);
  }
  const DevsPartitionPlan partitions = partition_plan(workers);
  const std::size_t n = run_pdevs_parallel(horizon, partitions);
  dispatched_ += n;
  return n;
}

SimTime DevsExecutor::conservative_safe_horizon(
    SimTime requested_horizon, std::size_t requested_partitions) const {
  if (!parallel_supported() || plan_.atom_count() == 0) {
    return clock_.now();
  }
  const DevsPartitionPlan partitions = partition_plan(requested_partitions);
  if (!partitions.has_cross_partition_routes()) {
    return requested_horizon;
  }
  SimTime safe = requested_horizon;
  for (const DevsPartitionPlan::CrossPartitionRoute& route :
       partitions.cross_routes()) {
    if (route.from_atom >= pending_at_.size()) {
      continue;
    }
    const SimTime event_at = pending_at_[route.from_atom];
    if (event_at.is_infinity()) {
      continue;
    }
    const SimTime declared =
        plan_.atom(route.from_atom)->parallel_lookahead();
    const SimTime lookahead =
        declared < SimTime::zero() ? SimTime::zero() : declared;
    SimTime candidate = event_at;
    if (!lookahead.is_infinity() &&
        lookahead.as_ns() <=
            std::numeric_limits<std::int64_t>::max() - event_at.as_ns()) {
      candidate = event_at + lookahead;
    } else if (!lookahead.is_infinity()) {
      candidate = SimTime::infinity();
    }
    if (candidate < safe) {
      safe = candidate;
    }
  }
  return safe;
}

std::size_t DevsExecutor::run_pdevs(SimTime horizon) {
  std::size_t dispatched = 0;
  for (;;) {
    const SimTime next = scheduler_.peek_time();
    if (next.is_infinity()) {
      break;
    }
    if (next > horizon) {
      break;
    }

    clock_.advance_to(next);
    std::vector<std::uint32_t> imminent;
    Event event{};
    bool popped_any = false;
    // Collect one complete timestamp batch. Events scheduled at the same
    // timestamp by the transition round below form the next microstep.
    while (scheduler_.peek_time() == next && scheduler_.try_pop_next(event)) {
      popped_any = true;
      ++dispatched;
      if (event.type != kInternalEvent) {
        // PDEVS-native executor events are currently internal only. Preserve
        // the handler escape hatch for kernel-owned external events.
        handlers_.dispatch(event);
        continue;
      }
      const auto atom = static_cast<std::uint32_t>(event.payload);
      if (atom >= plan_.atom_count()) {
        throw std::logic_error("DevsExecutor: internal event references unknown atom");
      }
      pending_[atom] = EventToken{};
      pending_at_[atom] = SimTime::infinity();
      imminent.push_back(atom);
    }
    if (!popped_any) {
      break;  // an empty scheduler reports infinity as its peek timestamp
    }
    if (!imminent.empty()) {
      process_pdevs_round(imminent);
    }
  }
  return dispatched;
}

std::size_t DevsExecutor::run_pdevs_parallel(
    SimTime horizon, const DevsPartitionPlan& partitions) {
  std::size_t dispatched = 0;
  for (;;) {
    const SimTime next = scheduler_.peek_time();
    if (next.is_infinity() || next > horizon) {
      break;
    }

    clock_.advance_to(next);
    std::vector<std::uint32_t> imminent;
    Event event{};
    bool popped_any = false;
    while (scheduler_.peek_time() == next && scheduler_.try_pop_next(event)) {
      popped_any = true;
      ++dispatched;
      if (event.type != kInternalEvent) {
        handlers_.dispatch(event);
        continue;
      }
      const auto atom = static_cast<std::uint32_t>(event.payload);
      if (atom >= plan_.atom_count()) {
        throw std::logic_error(
            "DevsExecutor: internal event references unknown atom");
      }
      pending_[atom] = EventToken{};
      pending_at_[atom] = SimTime::infinity();
      imminent.push_back(atom);
    }
    if (!popped_any) {
      break;
    }
    if (!imminent.empty()) {
      process_pdevs_round_parallel(imminent, {}, partitions);
    }
  }
  return dispatched;
}

void DevsExecutor::process_pdevs_round(
    const std::vector<std::uint32_t>& imminent,
    std::vector<std::vector<PendingInput>> incoming) {
  const SimTime now = clock_.now();
  if (incoming.empty()) {
    incoming.resize(plan_.atom_count());
  }
  std::vector<bool> is_imminent(plan_.atom_count(), false);
  std::vector<std::uint32_t> transitioned;

  std::vector<std::vector<PortEvent>> outputs(plan_.atom_count());
  for (const std::uint32_t atom : imminent) {
    is_imminent[atom] = true;
    AtomicModel& model = *plan_.atom(atom);
    model.output_function(now);
    for (const PortEvent& output : model.staged_outputs()) {
      outputs[atom].push_back(output);
      const auto routes = plan_.output_targets(atom, output.port);
      for (const DevsRuntimePlan::RouteTarget& target : routes) {
        incoming[target.atom].push_back(
            PendingInput{PortEvent{target.port, output.payload}, atom});
      }
    }
    model.clear_outputs();
  }

  // Transition in stable atom-id order. PDEVS semantics make the bag the
  // synchronization boundary, so no model observes an order-dependent partial
  // update from another model in this timestamp round.
  for (std::uint32_t atom = 0; atom < plan_.atom_count(); ++atom) {
    const bool has_input = !incoming[atom].empty();
    if (!is_imminent[atom] && !has_input) {
      continue;
    }
    transitioned.push_back(atom);

    AtomicModel& model = *plan_.atom(atom);
    std::vector<PortEvent> inputs;
    std::vector<std::uint32_t> sources;
    inputs.reserve(incoming[atom].size());
    sources.reserve(incoming[atom].size());
    for (const PendingInput& input : incoming[atom]) {
      inputs.push_back(input.event);
      sources.push_back(input.source);
    }
    const SimTime elapsed = now - last_transition_[atom];
    DevsTransitionKind kind = DevsTransitionKind::kInternal;
    if (is_imminent[atom] && has_input) {
      model.confluent_transition(now, inputs);
      kind = DevsTransitionKind::kConfluent;
      ++internal_transitions_;
    } else if (is_imminent[atom]) {
      model.internal_transition(now);
      ++internal_transitions_;
    } else {
      model.external_transition_batch(now, elapsed, inputs);
      kind = DevsTransitionKind::kExternal;
    }
    if (evidence_ != nullptr) {
      evidence_->record(now, atom, plan_.atom_path(atom), kind, elapsed, inputs,
                        sources, outputs[atom]);
    }
    last_transition_[atom] = now;
  }
  // A PDEVS input bag is one synchronization boundary. Decide whether to
  // re-arm atoms only after the complete timestamp batch has committed;
  // doing it per atom leaves an order-dependent extra event when the global
  // budget is reached midway through a simultaneous-imminent set.
  if (internal_budget_ == 0 || internal_transitions_ < internal_budget_) {
    for (const std::uint32_t atom : transitioned) reschedule(atom);
  }
}

void DevsExecutor::process_pdevs_round_parallel(
    const std::vector<std::uint32_t>& imminent,
    std::vector<std::vector<PendingInput>> incoming,
    const DevsPartitionPlan& partitions) {
  const std::size_t count = plan_.atom_count();
  const SimTime now = clock_.now();
  if (incoming.empty()) {
    incoming.resize(count);
  } else if (incoming.size() != count) {
    throw std::logic_error(
        "DevsExecutor: parallel input bag shape does not match plan");
  }

  std::vector<bool> is_imminent(count, false);
  for (const std::uint32_t atom : imminent) {
    if (atom >= count) {
      throw std::logic_error("DevsExecutor: parallel imminent atom is unknown");
    }
    is_imminent[atom] = true;
  }

  std::vector<std::vector<PortEvent>> outputs(count);
  std::exception_ptr failure;
  std::mutex failure_mutex;
  const auto run_partition_workers = [&](const auto& fn) {
    std::vector<std::thread> workers;
    workers.reserve(partitions.partition_count());
    for (const DevsPartitionPlan::Partition& partition :
         partitions.partitions()) {
      workers.emplace_back([&, partition] {
        try {
          fn(partition);
        } catch (...) {
          std::lock_guard<std::mutex> lock(failure_mutex);
          if (failure == nullptr) {
            failure = std::current_exception();
          }
        }
      });
    }
    for (std::thread& worker : workers) {
      worker.join();
    }
    if (failure != nullptr) {
      std::rethrow_exception(failure);
    }
  };

  // Phase 1: lambda is atom-local. No route table or scheduler is touched by
  // workers; the main thread merges the staged outputs in the original
  // imminent-event order below.
  run_partition_workers([&](const DevsPartitionPlan::Partition& partition) {
    for (std::uint32_t atom = partition.begin; atom < partition.end; ++atom) {
      if (!is_imminent[atom]) {
        continue;
      }
      AtomicModel& model = *plan_.atom(atom);
      model.output_function(now);
      outputs[atom].assign(model.staged_outputs().begin(),
                           model.staged_outputs().end());
      model.clear_outputs();
    }
  });

  // The barrier merge is intentionally serial and stable. The transport
  // boundary makes the same code usable by a future IPC implementation while
  // preserving the exact bag order used by legacy fallback hooks.
  DeterministicPartitionTransport transport;
  std::uint64_t route_sequence = 0;
  for (const std::uint32_t atom : imminent) {
    for (const PortEvent& output : outputs[atom]) {
      const auto routes = plan_.output_targets(atom, output.port);
      for (const DevsRuntimePlan::RouteTarget& target : routes) {
        transport.send(DevsPartitionEvent{
            now,
            0,
            partitions.partition_of(atom),
            partitions.partition_of(target.atom),
            atom,
            target.atom,
            target.port,
            output.payload,
            route_sequence++});
      }
    }
  }
  for (std::uint32_t partition = 0;
       partition < partitions.partition_count(); ++partition) {
    for (const DevsPartitionEvent& event :
         transport.receive(now, partition)) {
      incoming[event.target_atom].push_back(
          PendingInput{PortEvent{event.target_port, event.payload},
                       event.source_atom});
    }
  }
  if (transport.pending() != 0) {
    throw std::logic_error(
        "DevsExecutor: partition transport left a stale timestamp event");
  }

  std::vector<bool> active(count, false);
  std::vector<DevsTransitionKind> kinds(count,
                                        DevsTransitionKind::kExternal);
  std::vector<SimTime> elapsed(count, SimTime::zero());
  std::vector<std::vector<PortEvent>> transition_inputs(count);
  std::vector<std::vector<std::uint32_t>> transition_sources(count);

  // Phase 2: each atom consumes its complete timestamp bag independently.
  // Scheduler mutation, evidence sequence assignment, and budget accounting
  // are deferred to the deterministic commit loop below.
  run_partition_workers([&](const DevsPartitionPlan::Partition& partition) {
    for (std::uint32_t atom = partition.begin; atom < partition.end; ++atom) {
      const bool has_input = !incoming[atom].empty();
      if (!is_imminent[atom] && !has_input) {
        continue;
      }
      active[atom] = true;
      auto& inputs = transition_inputs[atom];
      auto& sources = transition_sources[atom];
      inputs.reserve(incoming[atom].size());
      sources.reserve(incoming[atom].size());
      for (const PendingInput& input : incoming[atom]) {
        inputs.push_back(input.event);
        sources.push_back(input.source);
      }
      AtomicModel& model = *plan_.atom(atom);
      elapsed[atom] = now - last_transition_[atom];
      if (is_imminent[atom] && has_input) {
        model.confluent_transition(now, inputs);
        kinds[atom] = DevsTransitionKind::kConfluent;
      } else if (is_imminent[atom]) {
        model.internal_transition(now);
        kinds[atom] = DevsTransitionKind::kInternal;
      } else {
        model.external_transition_batch(now, elapsed[atom], inputs);
        kinds[atom] = DevsTransitionKind::kExternal;
      }
      last_transition_[atom] = now;
    }
  });

  // Commit in atom-id order. This is the conservative synchronization
  // barrier: all models have completed their local transition before any
  // scheduler token or evidence record is made visible.
  for (std::uint32_t atom = 0; atom < count; ++atom) {
    if (!active[atom]) {
      continue;
    }
    if (evidence_ != nullptr) {
      evidence_->record(now, atom, plan_.atom_path(atom), kinds[atom],
                        elapsed[atom], transition_inputs[atom],
                        transition_sources[atom], outputs[atom]);
    }
    if (kinds[atom] != DevsTransitionKind::kExternal) {
      ++internal_transitions_;
    }
  }
  if (internal_budget_ == 0 || internal_transitions_ < internal_budget_) {
    for (std::uint32_t atom = 0; atom < count; ++atom) {
      if (active[atom]) reschedule(atom);
    }
  }
}

void DevsExecutor::on_event(const Event& event) {
  if (event.type == kInternalEvent) {
    deliver_internal(static_cast<std::uint32_t>(event.payload));
  } else {
    // External inputs are delivered synchronously inside deliver_internal /
    // inject(); scheduler-driven external events use this side channel.
    const ExtInput& in = ext_inputs_.at(event.payload);
      deliver_external(in.atom, in.event, in.source);
  }
}

void DevsExecutor::deliver_internal(std::uint32_t atom) {
  AtomicModel& model = *plan_.atom(atom);
  const SimTime now = clock_.now();
  pending_[atom] = EventToken{};
  pending_at_[atom] = SimTime::infinity();
  ++internal_transitions_;

  model.internal_transition(now);

  const std::vector<PortEvent> outputs(model.staged_outputs().begin(),
                                       model.staged_outputs().end());

  // Record the source transition before synchronously delivering its outputs
  // so the evidence sequence follows the causal direction source -> target.
  if (evidence_ != nullptr) {
    evidence_->record(now, atom, plan_.atom_path(atom),
                      DevsTransitionKind::kInternal,
                      now - last_transition_[atom], {}, {}, outputs);
  }
  last_transition_[atom] = now;

  // Route staged outputs synchronously through the flattened routing table.
  for (const PortEvent& out : outputs) {
    const auto routes = plan_.output_targets(atom, out.port);
    for (const DevsRuntimePlan::RouteTarget& t : routes) {
      deliver_external(t.atom, PortEvent{t.port, out.payload}, atom);
    }
  }
  model.clear_outputs();

  if (internal_budget_ == 0 || internal_transitions_ < internal_budget_) {
    reschedule(atom);
  }
}

void DevsExecutor::deliver_external(std::uint32_t atom, const PortEvent& input,
                                    std::uint32_t source) {
  AtomicModel& model = *plan_.atom(atom);
  const SimTime now = clock_.now();
  if (all_pdevs_) {
    // External injection is synchronous at the current simulation time. The
    // common case is an input arriving while the atom is passive or has a
    // future internal event, so expose the proper elapsed-time bag hook and
    // restart its time advance from `now`.
    cancel_pending(atom);
    const std::array<PortEvent, 1> inputs{input};
    const std::array<std::uint32_t, 1> sources{source};
    const SimTime elapsed = now - last_transition_[atom];
    model.external_transition_batch(now, elapsed, inputs);
    if (evidence_ != nullptr) {
      evidence_->record(now, atom, plan_.atom_path(atom),
                        DevsTransitionKind::kExternal, elapsed, inputs, sources,
                        {});
    }
    last_transition_[atom] = now;
    reschedule(atom);
    return;
  }
  // External input preempts the pending internal transition (DEVS-lite: the
  // model restarts its full ta(); elapsed-time carryover is not modeled).
  if (pending_[atom].valid()) {
    cancel_pending(atom);
  }
  model.external_transition(now, input.port, input.payload);
  if (evidence_ != nullptr) {
    const std::array<PortEvent, 1> inputs{input};
    const std::array<std::uint32_t, 1> sources{source};
    evidence_->record(now, atom, plan_.atom_path(atom),
                      DevsTransitionKind::kExternal,
                      now - last_transition_[atom], inputs, sources, {});
  }
  last_transition_[atom] = now;
  reschedule(atom);
}

void DevsExecutor::cancel_pending(std::uint32_t atom) {
  if (pending_[atom].valid()) {
    scheduler_.cancel(pending_[atom]);
    pending_[atom] = EventToken{};
  }
  pending_at_[atom] = SimTime::infinity();
}

void DevsExecutor::reschedule(std::uint32_t atom) {
  const SimTime ta = plan_.atom(atom)->time_advance();
  if (ta.is_infinity()) {
    pending_at_[atom] = SimTime::infinity();
    return;  // passive model
  }
  const SimTime at = clock_.now() + ta;
  pending_[atom] = scheduler_.schedule(at, kInternalEvent, dispatch_handler_, atom);
  pending_at_[atom] = at;
}

}  // namespace logicpilot

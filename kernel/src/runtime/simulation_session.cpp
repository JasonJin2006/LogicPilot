// Persistent shared-event-queue session (see simulation_session.h).
#include "logicpilot/runtime/simulation_session.h"

#include <exception>
#include <utility>

#include "logicpilot/runtime/method_registry.h"

namespace logicpilot {

namespace {
std::uint64_t model_fingerprint(std::span<const std::uint8_t> bytes) {
  std::uint64_t hash = 1469598103934665603ULL;
  for (const std::uint8_t byte : bytes) {
    hash ^= byte;
    hash *= 1099511628211ULL;
  }
  return hash;
}
}  // namespace

SimulationSession::SimulationSession(std::vector<std::uint8_t> model_bytes)
    : bytes_{std::move(model_bytes)} {
  model_fingerprint_ = model_fingerprint(bytes_);
  if (bytes_.empty()) {
    return;
  }
  IrLoadResult loaded = load_model_buffer(bytes_.data(), bytes_.size());
  if (loaded.ok()) {
    verified_ = std::move(loaded.file);
    loaded_ = true;
  }
}

SimulationSession::~SimulationSession() {
  if (active_ && manager_ != nullptr) {
    manager_->shutdown();
  }
}

std::size_t SimulationSession::method_count() const {
  return manager_ == nullptr ? 0 : manager_->method_count();
}

void SimulationSession::collect_telemetry(
    std::vector<RuntimeTelemetryValue>& values) const {
  if (manager_ == nullptr) return;
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    const SimulationMethod* method = manager_->method(index);
    if (method != nullptr) method->collect_telemetry(values);
  }
}

bool SimulationSession::has_pending_events() const {
  return scheduler_ != nullptr && !scheduler_->empty();
}

bool SimulationSession::fail(
    const std::string& code, const std::string& message, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) const {
  if (diagnostics != nullptr) {
    diagnostics->push_back(
        RuntimeDiagnostic{RuntimeSeverity::kError, code, message});
  }
  if (error != nullptr) {
    *error = message;
  }
  return false;
}

bool SimulationSession::start(
    const ReplicationConfig& config, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics,
    DevsEvidenceRecorder* evidence, SimulationProfile* profile) {
  if (error != nullptr) {
    error->clear();
  }
  if (active_) {
    return fail("KR1011", "SimulationSession is already active", error,
                diagnostics);
  }
  if (!loaded_ || verified_.v2_root == nullptr) {
    return fail("KR1002", "SimulationSession has no valid model", error,
                diagnostics);
  }
  const std::vector<MethodRequirement> requirements =
      resolve_method_requirements(verified_);
  if (requirements.empty()) {
    return fail("KR1003", "no executable modeling method under the model root",
                error, diagnostics);
  }

  scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  handlers_.clear();
  variables_.clear();
  clock_.reset();
  manager_ = std::make_unique<RuntimeManager>(
      clock_, *scheduler_, handlers_, variables_, config, evidence);

  MethodRegistry& registry = MethodRegistry::instance();
  for (const MethodRequirement& requirement : requirements) {
    auto runtime = registry.create(requirement.method);
    if (runtime == nullptr) {
      manager_.reset();
      scheduler_.reset();
      return fail("KR1004", "no registered method runtime for '" +
                                requirement.method + "'",
                  error, diagnostics);
    }
    for (const std::string& version : requirement.semantics_versions) {
      if (!registry.supports_semantics_version(requirement.method, version)) {
        manager_.reset();
        scheduler_.reset();
        return fail("KR1008", "method runtime '" + requirement.method +
                                  "' does not support semantics version '" +
                                  version + "'",
                    error, diagnostics);
      }
    }
    if (!manager_->add(std::move(runtime), error)) {
      const std::string message =
          error != nullptr ? *error : "method attach failed";
      manager_.reset();
      scheduler_.reset();
      return fail("KR1005", message, error, diagnostics);
    }
  }

  if (!manager_->initialize(verified_, error)) {
    const std::string message = error != nullptr ? *error : "initialize failed";
    manager_.reset();
    scheduler_.reset();
    return fail("KR1006", message, error, diagnostics);
  }

  all_shared_event_queue_ = true;
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    const SimulationMethod* method = manager_->method(index);
    if (method == nullptr ||
        method->capabilities().execution_mode !=
            MethodExecutionMode::kSharedEventQueue) {
      all_shared_event_queue_ = false;
      break;
    }
  }
  if (!all_shared_event_queue_) {
    manager_->shutdown();
    manager_.reset();
    scheduler_.reset();
    return fail("KR1007",
                "SimulationSession requires every runtime to use the shared "
                "event queue",
                error, diagnostics);
  }

  profile_ = profile;
  dispatched_total_ = 0;
  if (profile_ != nullptr) {
    profiler_.begin();
  }
  active_ = true;
  return true;
}

bool SimulationSession::advance(SimTime until, TraceRecorder* trace,
                                DebugRecorder* debug, std::string* error,
                                std::size_t* dispatched) {
  if (error != nullptr) {
    error->clear();
  }
  if (!active_ || manager_ == nullptr || scheduler_ == nullptr) {
    if (dispatched != nullptr) {
      *dispatched = 0;
    }
    return fail("KR1012", "SimulationSession is not active", error, nullptr);
  }
  std::size_t count = 0;
  const std::uint64_t max_events = manager_->context().config().max_events;
  while (!scheduler_->empty() && scheduler_->peek_time() <= until) {
    if (max_events == 0 || dispatched_total_ >= max_events) {
      if (dispatched != nullptr) *dispatched = count;
      return fail("KR1017", "KR1017: shared scheduler event budget exhausted (" +
                               std::to_string(max_events) + " events)", error, nullptr);
    }
    Event event{};
    if (!scheduler_->try_pop_next(event)) break;
    clock_.advance_to(event.at);
    if (trace != nullptr) {
      trace->record(event.at, event.type, event.payload);
    }
    if (debug != nullptr) {
      debug->record(event);
    }
    if (profile_ != nullptr) {
      profiler_.record_event(event);
    }
    handlers_.dispatch(event);
    ++count;
    ++dispatched_total_;
  }
  if (dispatched != nullptr) {
    *dispatched = count;
  }
  return true;
}

bool SimulationSession::advance_events(std::size_t max_events,
                                       TraceRecorder* trace,
                                       DebugRecorder* debug,
                                       std::string* error,
                                       std::size_t* dispatched) {
  if (max_events == 0) {
    if (dispatched != nullptr) *dispatched = 0;
    return fail("KR1018", "SimulationSession event step must be positive", error,
                nullptr);
  }
  if (error != nullptr) error->clear();
  if (!active_ || manager_ == nullptr || scheduler_ == nullptr) {
    if (dispatched != nullptr) *dispatched = 0;
    return fail("KR1012", "SimulationSession is not active", error, nullptr);
  }
  std::size_t count = 0;
  const std::uint64_t max_total = manager_->context().config().max_events;
  while (count < max_events && !scheduler_->empty()) {
    if (max_total == 0 || dispatched_total_ >= max_total) {
      if (dispatched != nullptr) *dispatched = count;
      return fail("KR1017", "KR1017: shared scheduler event budget exhausted (" +
                               std::to_string(max_total) + " events)", error,
                  nullptr);
    }
    Event event{};
    if (!scheduler_->try_pop_next(event)) break;
    clock_.advance_to(event.at);
    if (trace != nullptr) trace->record(event.at, event.type, event.payload);
    if (debug != nullptr) debug->record(event);
    if (profile_ != nullptr) profiler_.record_event(event);
    handlers_.dispatch(event);
    ++count;
    ++dispatched_total_;
  }
  if (dispatched != nullptr) *dispatched = count;
  return true;
}

bool SimulationSession::abort(std::string* error,
                              std::vector<RuntimeDiagnostic>* diagnostics) {
  if (error != nullptr) error->clear();
  if (!active_ || manager_ == nullptr) {
    return fail("KR1012", "SimulationSession is not active", error,
                diagnostics);
  }
  manager_->shutdown();
  if (profile_ != nullptr) *profile_ = profiler_.end();
  profile_ = nullptr;
  active_ = false;
  manager_.reset();
  scheduler_.reset();
  handlers_.clear();
  variables_.clear();
  all_shared_event_queue_ = false;
  return true;
}

std::vector<ReplicationMetrics> SimulationSession::finish(
    TraceRecorder* trace, DebugRecorder* debug, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  if (error != nullptr) {
    error->clear();
  }
  if (!active_ || manager_ == nullptr) {
    fail("KR1012", "SimulationSession is not active", error, diagnostics);
    return {};
  }

  bool ok = advance(SimTime::infinity(), trace, debug, error, nullptr);
  manager_->shutdown();
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    const SimulationMethod* method = manager_->method(index);
    if (method != nullptr && !method->runtime_error().empty()) {
      ok = false;
      fail("KR1010", std::string(method->method_name()) +
                           " runtime failed: " + method->runtime_error(),
           error, diagnostics);
    }
  }

  std::vector<ReplicationMetrics> metrics;
  if (ok) {
    metrics.reserve(manager_->method_count());
    for (std::size_t index = 0; index < manager_->method_count(); ++index) {
      metrics.push_back(manager_->method(index)->replication_metrics());
    }
  }
  if (profile_ != nullptr) {
    *profile_ = profiler_.end();
  }
  profile_ = nullptr;
  active_ = false;
  manager_.reset();
  scheduler_.reset();
  handlers_.clear();
  variables_.clear();
  all_shared_event_queue_ = false;
  return metrics;
}

const SimulationMethod* SimulationSession::active_method() const {
  if (!active_ || manager_ == nullptr || manager_->method_count() != 1) {
    return nullptr;
  }
  return manager_->method(0);
}

SimulationMethod* SimulationSession::active_method() {
  if (!active_ || manager_ == nullptr || manager_->method_count() != 1) {
    return nullptr;
  }
  return manager_->method(0);
}

bool SimulationSession::save_method_checkpoint(
    SimulationSessionCheckpoint& checkpoint, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) const {
  if (!active_ || manager_ == nullptr) {
    return fail("KR1012", "SimulationSession is not active", error,
                diagnostics);
  }
  checkpoint = SimulationSessionCheckpoint{};
  checkpoint.now = clock_.now();
  checkpoint.dispatched_events = dispatched_total_;
  checkpoint.model_fingerprint = model_fingerprint_;
  checkpoint.variables = manager_->variables().snapshot();
  checkpoint.messages = manager_->messages().snapshot();
  checkpoint.methods.reserve(manager_->method_count());
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    const SimulationMethod* method = manager_->method(index);
    if (method == nullptr) {
      return fail("KR1014", "session contains a null method runtime", error,
                  diagnostics);
    }
    MethodCheckpoint bundle;
    std::string local_error;
    if (!method->save_method_checkpoint(bundle, &local_error)) {
      return fail("KR1014", "method '" + std::string(method->method_name()) +
                                "' cannot checkpoint: " +
                                (local_error.empty() ? "unsupported" :
                                                       local_error),
                  error, diagnostics);
    }
    if (bundle.method != method->method_name()) {
      return fail("KR1014", "method checkpoint identity mismatch for '" +
                                std::string(method->method_name()) + "'",
                  error, diagnostics);
    }
    if (bundle.schema_version != method->checkpoint_schema_version()) {
      return fail("KR1014", "method checkpoint schema mismatch for '" +
                                std::string(method->method_name()) + "'",
                  error, diagnostics);
    }
    bundle.now = checkpoint.now;
    checkpoint.methods.push_back(std::move(bundle));
  }
  return true;
}

bool SimulationSession::restore_method_checkpoint_impl(
    const SimulationSessionCheckpoint& checkpoint,
    const MethodCheckpointMigrationRegistry* migrations,
    const SessionCheckpointMigrationRegistry* session_migrations,
    std::string* error, std::vector<RuntimeDiagnostic>* diagnostics) {
  if (!active_ || manager_ == nullptr) {
    return fail("KR1012", "SimulationSession is not active", error,
                diagnostics);
  }
  const SimulationSessionCheckpoint* effective = &checkpoint;
  SimulationSessionCheckpoint migrated_session;
  if (checkpoint.model_fingerprint != 0 &&
      checkpoint.model_fingerprint != model_fingerprint_) {
    std::string migration_error;
    if (session_migrations == nullptr ||
        !session_migrations->migrate(checkpoint, model_fingerprint_,
                                     migrated_session, &migration_error)) {
      return fail("KR1013", "method checkpoint model fingerprint mismatch: " +
                                (migration_error.empty() ? "migration unavailable"
                                                         : migration_error),
                  error, diagnostics);
    }
    effective = &migrated_session;
  }
  const SimulationSessionCheckpoint& state = *effective;
  if (state.model_fingerprint != 0 &&
      state.model_fingerprint != model_fingerprint_) {
    return fail("KR1013", "method checkpoint migration produced wrong model fingerprint",
                error, diagnostics);
  }
  if (state.methods.size() != manager_->method_count()) {
    return fail("KR1013", "method checkpoint count does not match session",
                error, diagnostics);
  }
  std::vector<MethodCheckpoint> bundles;
  bundles.reserve(manager_->method_count());
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    SimulationMethod* method = manager_->method(index);
    const MethodCheckpoint& source = state.methods[index];
    if (method == nullptr || source.method != method->method_name()) {
      return fail("KR1013", "method checkpoint identity does not match session",
                  error, diagnostics);
    }
    MethodCheckpoint migrated;
    const MethodCheckpoint* bundle = &source;
    const std::uint32_t target_schema = method->checkpoint_schema_version();
    if (source.schema_version != target_schema) {
      std::string migration_error;
      const bool migrated_ok = migrations != nullptr
                                   ? migrations->migrate(source, target_schema,
                                                         migrated,
                                                         &migration_error)
                                   : method->migrate_method_checkpoint(
                                         source, target_schema, migrated,
                                         &migration_error);
      if (!migrated_ok) {
        return fail("KR1015",
                    "method '" + std::string(method->method_name()) +
                        "' schema migration failed: " +
                        (migration_error.empty() ? "unsupported" : migration_error),
                    error, diagnostics);
      }
      bundle = &migrated;
    }
    bundles.push_back(*bundle);
  }

  // Establish a complete rollback image before mutating the shared world.
  // Restoring one method can schedule/cancel events, so method bundles and
  // scheduler state must be treated as one transaction rather than a series
  // of independent best-effort operations.
  const auto rollback_variables = manager_->variables().snapshot();
  const auto rollback_messages = manager_->messages().snapshot();
  const SimTime rollback_now = clock_.now();
  const std::uint64_t rollback_dispatched = dispatched_total_;
  std::vector<MethodCheckpoint> rollback_bundles;
  rollback_bundles.reserve(manager_->method_count());
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    SimulationMethod* method = manager_->method(index);
    MethodCheckpoint current;
    std::string local_error;
    if (method == nullptr || !method->save_method_checkpoint(current, &local_error)) {
      return fail("KR1016", "cannot establish session restore rollback snapshot for method '" +
                              (method == nullptr ? std::string("<null>")
                                                 : std::string(method->method_name())) +
                              "': " + (local_error.empty() ? "checkpoint unavailable" :
                                                               local_error),
                  error, diagnostics);
    }
    rollback_bundles.push_back(std::move(current));
  }
  const auto rollback = [&](const std::string& cause) {
    std::string rollback_error;
    bool rollback_ok = true;
    if (!manager_->variables().restore(rollback_variables)) {
      rollback_ok = false;
      rollback_error = "shared variables rollback failed";
    }
    std::string message_rollback_error;
    if (!manager_->messages().restore(rollback_messages, &message_rollback_error)) {
      rollback_ok = false;
      rollback_error = message_rollback_error.empty() ? "shared messages rollback failed"
                                                       : message_rollback_error;
    }
    clock_.reset(rollback_now);
    dispatched_total_ = rollback_dispatched;
    for (std::size_t index = 0; index < rollback_bundles.size(); ++index) {
      std::string local_error;
      if (!manager_->method(index)->restore_method_checkpoint(rollback_bundles[index],
                                                               &local_error)) {
        rollback_ok = false;
        rollback_error = "method '" + std::string(manager_->method(index)->method_name()) +
                         "' rollback failed: " +
                         (local_error.empty() ? "checkpoint restore rejected" : local_error);
        break;
      }
    }
    return fail("KR1016", cause + (rollback_ok ? "; session state rolled back"
                                                : "; rollback failed: " + rollback_error),
                error, diagnostics);
  };

  // Let each method cancel its own pre-checkpoint tokens while applying the
  // target bundle. Their token/order semantics are part of deterministic
  // replay; the scheduler is cleared only inside rollback after a failure.
  if (!manager_->variables().restore(state.variables)) {
    return rollback("method checkpoint shared variable state is invalid");
  }
  std::string message_error;
  if (!manager_->messages().restore(state.messages, &message_error)) {
    return rollback("method checkpoint shared message state is invalid: " +
                    (message_error.empty() ? "message contract mismatch" : message_error));
  }
  clock_.reset(state.now);
  dispatched_total_ = state.dispatched_events;
  for (std::size_t index = 0; index < manager_->method_count(); ++index) {
    SimulationMethod* method = manager_->method(index);
    std::string local_error;
    if (!method->restore_method_checkpoint(bundles[index], &local_error)) {
      return rollback("method '" + std::string(method->method_name()) +
                      "' cannot restore checkpoint: " +
                      (local_error.empty() ? "unsupported" : local_error));
    }
  }
  return true;
}

bool SimulationSession::restore_method_checkpoint(
    const SimulationSessionCheckpoint& checkpoint, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  return restore_method_checkpoint_impl(checkpoint, nullptr, nullptr, error,
                                        diagnostics);
}

bool SimulationSession::restore_method_checkpoint(
    const SimulationSessionCheckpoint& checkpoint,
    const MethodCheckpointMigrationRegistry& migrations, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  return restore_method_checkpoint_impl(checkpoint, &migrations, nullptr,
                                        error, diagnostics);
}

bool SimulationSession::restore_method_checkpoint(
    const SimulationSessionCheckpoint& checkpoint,
    const SessionCheckpointMigrationRegistry& migrations, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  return restore_method_checkpoint_impl(checkpoint, nullptr, &migrations,
                                        error, diagnostics);
}

bool SimulationSession::save_method_checkpoint_bytes(
    std::vector<std::uint8_t>& bytes, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) const {
  SimulationSessionCheckpoint checkpoint;
  if (!save_method_checkpoint(checkpoint, error, diagnostics)) return false;
  try {
    bytes = SimulationSessionCheckpointCodec::encode(checkpoint);
  } catch (const std::exception& exception) {
    return fail("KR1014", exception.what(), error, diagnostics);
  }
  return true;
}

bool SimulationSession::restore_method_checkpoint_bytes(
    std::span<const std::uint8_t> bytes, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  SimulationSessionCheckpoint checkpoint;
  if (!SimulationSessionCheckpointCodec::decode(bytes, checkpoint, error)) {
    return fail("KR1015", error != nullptr && !error->empty()
                              ? *error
                              : "method checkpoint archive decode failed",
                error, diagnostics);
  }
  return restore_method_checkpoint(checkpoint, error, diagnostics);
}

}  // namespace logicpilot

// Persistent shared-event-queue simulation session.
//
// SimulationKernel::run remains the one-shot compatibility API. A
// SimulationSession owns one replication world across multiple advance()
// calls, so pause/step/checkpoint layers can observe the same scheduler,
// clock, method runtimes, variables, and messages.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/checkpoint.h"
#include "logicpilot/devs/evidence.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/runtime_diagnostics.h"
#include "logicpilot/runtime/runtime_manager.h"
#include "logicpilot/runtime/method_checkpoint.h"
#include "logicpilot/runtime/method_checkpoint_codec.h"
#include "logicpilot/runtime/simulation_profiler.h"

namespace logicpilot {

class SimulationSession {
 public:
  // The model bytes are copied and verified by the constructor. The session
  // can therefore outlive the caller's IR buffer.
  explicit SimulationSession(std::vector<std::uint8_t> model_bytes);
  ~SimulationSession();

  SimulationSession(const SimulationSession&) = delete;
  SimulationSession& operator=(const SimulationSession&) = delete;

  [[nodiscard]] bool loaded() const { return loaded_; }
  [[nodiscard]] bool active() const { return active_; }
  [[nodiscard]] SimTime now() const { return clock_.now(); }
  [[nodiscard]] std::size_t method_count() const;
  [[nodiscard]] bool has_pending_events() const;
  [[nodiscard]] VariableStore& variables() { return manager_->variables(); }
  [[nodiscard]] MessageStore& messages() { return manager_->messages(); }

  // Start one replication world. Every attached method must use the shared
  // event queue; batch-only methods are rejected with a structured diagnostic.
  bool start(const ReplicationConfig& config, std::string* error = nullptr,
             std::vector<RuntimeDiagnostic>* diagnostics = nullptr,
             DevsEvidenceRecorder* evidence = nullptr,
             SimulationProfile* profile = nullptr);

  // Advance the same world through events at timestamps <= until. Multiple
  // calls are semantically equivalent to one call at the final horizon.
  bool advance(SimTime until, TraceRecorder* trace = nullptr,
               DebugRecorder* debug = nullptr, std::string* error = nullptr,
               std::size_t* dispatched = nullptr);

  // Drain, shut down all methods, return metrics, and release the active
  // replication world. Calling finish() is the normal end of a session.
  std::vector<ReplicationMetrics> finish(
      TraceRecorder* trace = nullptr, DebugRecorder* debug = nullptr,
      std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr);

  // Initial method-level checkpoint slice. The current contract accepts a
  // single DEVS runtime; mixed-method bundles will be added once each method
  // supplies its own state schema.
  bool save_checkpoint(DevsCheckpoint& checkpoint, std::string* error = nullptr,
                       std::vector<RuntimeDiagnostic>* diagnostics = nullptr) const;
  bool restore_checkpoint(const DevsCheckpoint& checkpoint,
                          std::string* error = nullptr,
                          std::vector<RuntimeDiagnostic>* diagnostics = nullptr);

  bool save_method_checkpoint(
      SimulationSessionCheckpoint& checkpoint, std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr) const;
  bool restore_method_checkpoint(
      const SimulationSessionCheckpoint& checkpoint,
      std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr);
  bool restore_method_checkpoint(
      const SimulationSessionCheckpoint& checkpoint,
      const MethodCheckpointMigrationRegistry& migrations,
      std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr);
  bool restore_method_checkpoint(
      const SimulationSessionCheckpoint& checkpoint,
      const SessionCheckpointMigrationRegistry& migrations,
      std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr);
  bool save_method_checkpoint_bytes(
      std::vector<std::uint8_t>& bytes, std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr) const;
  bool restore_method_checkpoint_bytes(
      std::span<const std::uint8_t> bytes, std::string* error = nullptr,
      std::vector<RuntimeDiagnostic>* diagnostics = nullptr);

 private:
  bool fail(const std::string& code, const std::string& message,
            std::string* error,
            std::vector<RuntimeDiagnostic>* diagnostics) const;
  bool restore_method_checkpoint_impl(
      const SimulationSessionCheckpoint& checkpoint,
      const MethodCheckpointMigrationRegistry* migrations,
      const SessionCheckpointMigrationRegistry* session_migrations,
      std::string* error,
      std::vector<RuntimeDiagnostic>* diagnostics);

  std::vector<std::uint8_t> bytes_;
  std::uint64_t model_fingerprint_{0};
  IrModelFile verified_{};
  bool loaded_{false};
  bool active_{false};
  bool all_shared_event_queue_{false};
  SimulationClock clock_;
  std::unique_ptr<BinaryHeapScheduler> scheduler_;
  EventHandlerRegistry handlers_;
  VariableStore variables_;
  std::unique_ptr<RuntimeManager> manager_;
  std::uint64_t dispatched_total_{0};
  SimulationProfiler profiler_;
  SimulationProfile* profile_{nullptr};
};

}  // namespace logicpilot

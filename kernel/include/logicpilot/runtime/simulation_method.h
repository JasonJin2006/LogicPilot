// Method Runtime Layer contract (docs/specs/method-runtime.md, Phase 1).
//
// SimulationMethod is the plugin interface every modeling method implements:
// Process, Agent, SystemDynamics, Statechart, and future third-party methods.
// The kernel drives each method through the same lifecycle (initialize ->
// advance* -> shutdown) and only ever sees this interface plus the generic
// IR container; it never knows method-specific artifacts such as Queue,
// Service, Stock or State.
//
// The Model IR stays method-neutral: every node carries a
// SemanticsRef{library, block} (library == the method name, block == the
// component within that method). build_replication_model() resolves the
// method from the IR and delegates to the registered runtime, so adding a
// second method never touches the kernel again.
#pragma once

#include <memory>
#include <string>
#include <string_view>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/checkpoint.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/method_checkpoint.h"

namespace logicpilot {

class ReplicationModel;
class RuntimeContext;
struct IrModelFile;

// Declares how a runtime participates in kernel time coordination. A shared
// event runtime schedules work into RuntimeContext and can compose with
// other such methods. A driver-advanced runtime still owns a legacy batch
// engine: it is executable as a single method but is not hybrid capable.
enum class MethodExecutionMode {
  kDriverAdvanced,
  kSharedEventQueue,
};

struct MethodCapabilities {
  MethodExecutionMode execution_mode{MethodExecutionMode::kDriverAdvanced};
  bool incremental{false};
  bool checkpoint_restore{false};
};

// One modeling method runtime (Process / Agent / SystemDynamics / ...).
class SimulationMethod {
public:
  virtual ~SimulationMethod() = default;

  // Stable registry key, e.g. "process", "agent", "sd", "statechart".
  [[nodiscard]] virtual std::string_view method_name() const = 0;

  [[nodiscard]] virtual MethodCapabilities capabilities() const { return MethodCapabilities{}; }

  // Lifecycle for one replication: initialize() lowers the model and
  // prepares state, advance(until) steps simulation time forward, and
  // shutdown() releases the replication. The kernel driver calls these in
  // this order and never inspects method internals.
  //
  // Phase 1 note: the legacy flow engines (QueueingFlowSim / ProcessFlowSim)
  // are batch-oriented, so a runtime's first advance() runs the full
  // replication and later advance() calls are no-ops. The modular block
  // runtimes (Phase 3) make advance() truly incremental.
  virtual bool initialize(RuntimeContext& context, const IrModelFile& model,
                          std::string* error) = 0;
  virtual void advance(SimTime until) = 0;
  virtual void shutdown() = 0;

  // Optional failure from an incremental runtime discovered during advance.
  // The kernel checks this after shutdown so a runtime failure cannot be
  // returned as an apparently successful metric set.
  [[nodiscard]] virtual std::string runtime_error() const { return {}; }

  // Optional method-level state checkpoint. The default is explicit refusal;
  // a session must never claim to restore a method whose state contract is
  // unknown.
  [[nodiscard]] virtual bool save_checkpoint(
      DevsCheckpoint&, std::string* error = nullptr) const {
    if (error != nullptr) {
      *error = "method does not support checkpoint_save";
    }
    return false;
  }
  virtual bool restore_checkpoint(const DevsCheckpoint&,
                                  std::string* error = nullptr) {
    if (error != nullptr) {
      *error = "method does not support checkpoint_restore";
    }
    return false;
  }

  [[nodiscard]] virtual bool save_method_checkpoint(
      MethodCheckpoint&, std::string* error = nullptr) const {
    if (error != nullptr) {
      *error = "method does not support a versioned state bundle";
    }
    return false;
  }
  virtual bool restore_method_checkpoint(const MethodCheckpoint&,
                                         std::string* error = nullptr) {
    if (error != nullptr) {
      *error = "method does not support a versioned state bundle";
    }
    return false;
  }

  // Current schema accepted by this runtime. A mismatch is never decoded by
  // accident; migrate_method_checkpoint is the explicit compatibility seam.
  [[nodiscard]] virtual std::uint32_t checkpoint_schema_version() const {
    return 1;
  }
  virtual bool migrate_method_checkpoint(const MethodCheckpoint& source,
                                         std::uint32_t target_schema,
                                         MethodCheckpoint& migrated,
                                         std::string* error = nullptr) const {
    (void)source;
    (void)target_schema;
    (void)migrated;
    if (error != nullptr) *error = "method checkpoint migration unavailable";
    return false;
  }

  // Batch compatibility adapter: lowers `model` to the legacy
  // ReplicationModel contract so existing drivers (lpcli run, lp-server
  // batch path) keep working unchanged while the kernel driver migrates to
  // the lifecycle API. Returns nullptr (with `error`) when the method cannot
  // lower the model.
  [[nodiscard]] virtual std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile& model, std::string* error) = 0;

  // Per-method replication metrics. The SimulationKernel driver collects
  // these after a kernel-driven run (runtimes finalize them in shutdown());
  // defaults to empty metrics for methods that do not report yet.
  [[nodiscard]] virtual ReplicationMetrics replication_metrics() const {
    return ReplicationMetrics{};
  }
};

}  // namespace logicpilot

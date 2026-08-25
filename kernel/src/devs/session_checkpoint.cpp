// Implementation of the legacy structured DEVS checkpoint accessors
// (see session_checkpoint.h).
#include "logicpilot/devs/session_checkpoint.h"

#include <utility>

#include "logicpilot/devs/checkpoint.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_manager.h"
#include "logicpilot/runtime/simulation_method.h"
#include "logicpilot/runtime/simulation_session.h"

namespace logicpilot {
namespace devs {
namespace {

bool fail(const std::string& code, const std::string& message,
          std::string* error,
          std::vector<RuntimeDiagnostic>* diagnostics) {
  if (error != nullptr) *error = message;
  if (diagnostics != nullptr) {
    diagnostics->push_back(
        RuntimeDiagnostic{RuntimeSeverity::kError, code, message});
  }
  return false;
}

const CheckpointedDevRuntime* checkpointed_runtime(
    const SimulationSession& session, std::string* error,
    std::vector<RuntimeDiagnostic>* diagnostics) {
  if (!session.active()) {
    fail("KR1012", "SimulationSession is not active", error, diagnostics);
    return nullptr;
  }
  const SimulationMethod* method =
      session.active_method();  // requires exactly one hosted runtime
  if (method == nullptr) {
    fail("KR1013",
         "session checkpoint currently requires one checkpointable "
         "DEVS runtime (formalism metadata)",
         error, diagnostics);
    return nullptr;
  }
  const MethodRegistry::Descriptor* descriptor =
      MethodRegistry::instance().descriptor(std::string(method->method_name()));
  if (descriptor == nullptr || descriptor->formalism != MethodFormalism::kDevs ||
      !method->capabilities().checkpoint_restore) {
    fail("KR1013",
         "session checkpoint currently requires one checkpointable "
         "DEVS runtime (formalism metadata)",
         error, diagnostics);
    return nullptr;
  }
  return dynamic_cast<const CheckpointedDevRuntime*>(method);
}

}  // namespace

bool save_session_checkpoint(SimulationSession& session,
                             DevsCheckpoint& checkpoint, std::string* error,
                             std::vector<RuntimeDiagnostic>* diagnostics) {
  const auto* runtime = checkpointed_runtime(session, error, diagnostics);
  if (runtime == nullptr) return false;
  std::string local_error;
  if (!runtime->save_checkpoint(checkpoint, &local_error)) {
    return fail("KR1014", local_error.empty() ? "method checkpoint failed"
                                              : local_error,
                error, diagnostics);
  }
  return true;
}

bool restore_session_checkpoint(SimulationSession& session,
                                const DevsCheckpoint& checkpoint,
                                std::string* error,
                                std::vector<RuntimeDiagnostic>* diagnostics) {
  // Restore mutates the runtime; re-resolve through the mutable path.
  if (!session.active()) {
    return fail("KR1012", "SimulationSession is not active", error,
                diagnostics);
  }
  SimulationMethod* mutable_method = session.active_method();
  if (mutable_method == nullptr) {
    return fail("KR1013",
                "session checkpoint currently requires one checkpointable "
                "DEVS runtime (formalism metadata)",
                error, diagnostics);
  }
  const MethodRegistry::Descriptor* descriptor =
      MethodRegistry::instance().descriptor(
          std::string(mutable_method->method_name()));
  if (descriptor == nullptr ||
      descriptor->formalism != MethodFormalism::kDevs ||
      !mutable_method->capabilities().checkpoint_restore) {
    return fail("KR1013",
                "session checkpoint currently requires one checkpointable "
                "DEVS runtime (formalism metadata)",
                error, diagnostics);
  }
  auto* runtime = dynamic_cast<CheckpointedDevRuntime*>(mutable_method);
  if (runtime == nullptr) {
    return fail("KR1013",
                "session checkpoint currently requires one checkpointable "
                "DEVS runtime (formalism metadata)",
                error, diagnostics);
  }
  std::string local_error;
  if (!runtime->restore_checkpoint(checkpoint, &local_error)) {
    return fail("KR1015", local_error.empty() ? "method restore failed"
                                              : local_error,
                error, diagnostics);
  }
  return true;
}

}  // namespace devs
}  // namespace logicpilot

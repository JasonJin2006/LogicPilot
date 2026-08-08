// SimulationKernel implementation (see simulation_kernel.h).
#include "logicpilot/runtime/simulation_kernel.h"

#include <utility>

#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/devs/ir_loader.h"

namespace logicpilot {

bool SimulationKernel::load(const IrModelFile& model, std::string* error) {
  if (model.v2_root == nullptr) {
    if (error != nullptr) {
      *error = "no model to load";
    }
    return false;
  }
  bytes_.assign(model.v2_bytes.begin(), model.v2_bytes.end());
  // Validate once up front: run() reuses this verified view for every
  // replication instead of re-running the verifier per run (--reps N would
  // otherwise verify the buffer N times).
  IrLoadResult loaded = load_model_buffer(bytes_.data(), bytes_.size());
  if (!loaded.ok()) {
    if (error != nullptr) {
      *error = "cannot validate the loaded model: " + loaded.message;
    }
    verified_ = IrModelFile{};
    return false;
  }
  verified_ = std::move(loaded.file);
  return true;
}

std::vector<ReplicationMetrics> SimulationKernel::run(const ReplicationConfig& config,
                                                      TraceRecorder* trace, std::string* error,
                                                      std::vector<RuntimeDiagnostic>* diagnostics,
                                                      DebugRecorder* debug,
                                                      SimulationProfile* profile) {
  const auto fail = [&](const std::string& code, const std::string& message) {
    if (diagnostics != nullptr) {
      diagnostics->push_back(RuntimeDiagnostic{RuntimeSeverity::kError, code, message});
    }
    if (error != nullptr) {
      *error = message;
    }
    return std::vector<ReplicationMetrics>{};
  };
  SimulationProfiler profiler;
  if (profile != nullptr) {
    profiler.begin();
  }
  if (bytes_.empty()) {
    return fail("KR1001", "SimulationKernel has no loaded model");
  }
  if (verified_.v2_root == nullptr) {
    return fail("KR1002", "the loaded model failed validation at load()");
  }
  const std::vector<MethodRequirement> requirements = resolve_method_requirements(verified_);
  if (requirements.empty()) {
    return fail("KR1003", "no executable modeling method under the model root");
  }

  // Fresh per-replication world: one scheduler, empty handler registry and
  // a clean shared variable store.
  register_builtin_methods();
  scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  handlers_.clear();
  variables_.clear();
  clock_.reset();
  RuntimeManager manager{clock_, *scheduler_, handlers_, variables_, config};

  MethodRegistry& registry = MethodRegistry::instance();
  for (const MethodRequirement& requirement : requirements) {
    const std::string& name = requirement.method;
    auto runtime = registry.create(name);
    if (runtime == nullptr) {
      return fail("KR1004", "no registered method runtime for '" + name +
                                "' (link the method library and register it)");
    }
    for (const std::string& version : requirement.semantics_versions) {
      if (!registry.supports_semantics_version(name, version)) {
        return fail("KR1008", "method runtime '" + name + "' does not support semantics version '" +
                                  version + "'");
      }
    }
    if (!manager.add(std::move(runtime), error)) {
      return fail("KR1005", error != nullptr ? *error : "method attach failed");
    }
  }
  if (!manager.initialize(verified_, error)) {
    return fail("KR1006", error != nullptr ? *error : "initialize failed");
  }

  // Select the coordination path from declared runtime capabilities.
  bool all_shared_event_queue = true;
  for (std::size_t i = 0; i < manager.method_count(); ++i) {
    const SimulationMethod* method = manager.method(i);
    if (method == nullptr ||
        method->capabilities().execution_mode != MethodExecutionMode::kSharedEventQueue) {
      all_shared_event_queue = false;
    }
  }
  if (!all_shared_event_queue && manager.method_count() > 1) {
    manager.shutdown();
    return fail("KR1007",
                "multi-method co-simulation requires every runtime to use the "
                "shared event queue; at least one attached runtime is batch-only");
  }

  if (all_shared_event_queue) {
    run_until(*scheduler_, clock_, SimTime::infinity(), [&](const Event& event) {
      if (trace != nullptr) {
        trace->record(event.at, event.type, event.payload);
      }
      if (debug != nullptr) {
        debug->record(event);
      }
      if (profile != nullptr) {
        profiler.record_event(event);
      }
      handlers_.dispatch(event);
    });
  } else {
    // Honest compatibility path for one legacy runtime. This makes native
    // DEVS/Agent/SD executable through SimulationKernel without pretending
    // that their private clocks already support hybrid composition.
    manager.advance(SimTime::infinity());
  }

  // Runtimes finalize their metrics during shutdown().
  manager.shutdown();
  std::vector<ReplicationMetrics> out;
  out.reserve(manager.method_count());
  for (std::size_t i = 0; i < manager.method_count(); ++i) {
    out.push_back(manager.method(i)->replication_metrics());
  }
  if (profile != nullptr) {
    *profile = profiler.end();
  }
  return out;
}

}  // namespace logicpilot

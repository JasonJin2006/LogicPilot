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
  return true;
}

std::vector<ReplicationMetrics> SimulationKernel::run(
    const ReplicationConfig& config, TraceRecorder* trace,
    std::string* error) {
  const auto fail = [&](const std::string& message) {
    if (error != nullptr) {
      *error = message;
    }
    return std::vector<ReplicationMetrics>{};
  };
  if (bytes_.empty()) {
    return fail("SimulationKernel has no loaded model");
  }
  const IrLoadResult loaded =
      load_model_buffer(bytes_.data(), bytes_.size());
  if (!loaded.ok()) {
    return fail("cannot re-validate the loaded model: " + loaded.message);
  }
  const std::vector<std::string> methods = resolve_method_names(loaded.file);
  if (methods.empty()) {
    return fail("no executable modeling method under the model root");
  }

  // Fresh per-replication world: one scheduler, empty handler registry and
  // a clean shared variable store.
  register_builtin_methods();
  scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
  handlers_.clear();
  variables_.clear();
  clock_.reset();
  RuntimeManager manager{clock_, *scheduler_, handlers_, variables_, config};

  for (const std::string& name : methods) {
    auto runtime = MethodRegistry::instance().create(name);
    if (runtime == nullptr) {
      return fail("no registered method runtime for '" + name +
                  "' (link the method library and register it)");
    }
    if (!manager.add(std::move(runtime), error)) {
      return {};
    }
  }
  if (!manager.initialize(loaded.file, error)) {
    return {};
  }

  // One shared event queue: scheduler events dispatch to the runtime that
  // registered the handler (Scheduler 事件 -> 对应 runtime 处理).
  run_until(*scheduler_, clock_, SimTime::infinity(),
            [&](const Event& event) {
              if (trace != nullptr) {
                trace->record(event.at, event.type, event.payload);
              }
              handlers_.dispatch(event);
            });

  // Runtimes finalize their metrics during shutdown() (they were driven by
  // the kernel, not by their own advance()).
  manager.shutdown();
  std::vector<ReplicationMetrics> out;
  out.reserve(manager.method_count());
  for (std::size_t i = 0; i < manager.method_count(); ++i) {
    out.push_back(manager.method(i)->replication_metrics());
  }
  return out;
}

}  // namespace logicpilot

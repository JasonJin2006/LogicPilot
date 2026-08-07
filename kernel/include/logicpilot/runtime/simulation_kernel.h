// SimulationKernel - the kernel owns the simulation world and drives every
// attached modeling method through one shared event queue.
//
// Execution shape (Method Runtime spec, section 8):
//
//   SimulationKernel
//        |
//   RuntimeManager
//        |
//        +---- ProcessRuntime
//        +---- StatechartRuntime
//        +---- (AgentRuntime / SDRuntime / ...)
//
//   Scheduler 事件 -> 对应 runtime 处理
//
// The kernel owns the clock, one BinaryHeapScheduler, the kernel-level
// EventHandlerRegistry and the cross-method VariableStore. run() resolves
// the model's methods (resolve_method_names), attaches one runtime per
// method through the MethodRegistry, lets every runtime schedule its
// initial events into the shared scheduler (RuntimeContext), then dispatches
// events in timestamp order - so multiple methods compose deterministically
// in a single replication and share state through variables().
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_diagnostics.h"
#include "logicpilot/runtime/runtime_manager.h"
#include "logicpilot/runtime/simulation_profiler.h"
#include "logicpilot/runtime/simulation_method.h"
#include "logicpilot/state/variable_store.h"

namespace logicpilot {

class SimulationKernel {
 public:
  SimulationKernel() = default;
  SimulationKernel(const SimulationKernel&) = delete;
  SimulationKernel& operator=(const SimulationKernel&) = delete;

  // Store the model to run (bytes are copied; validation happens at run()).
  bool load(const IrModelFile& model, std::string* error = nullptr);

  // Run one full replication: resolve methods, attach one runtime per method,
  // initialize, dispatch until the scheduler drains, shutdown. Returns one
  // metric set per method (in resolution order). `trace` records every
  // dispatched event (plus each method's final stat bits via shutdown);
  // `diagnostics` receives structured failures (KR1xxx), `debug` captures
  // the ordered event stream, and `profile` reports the event-type histogram
  // and wall time for this replication.
  std::vector<ReplicationMetrics> run(const ReplicationConfig& config,
                                      TraceRecorder* trace = nullptr,
                                      std::string* error = nullptr,
                                      std::vector<RuntimeDiagnostic>* diagnostics = nullptr,
                                      DebugRecorder* debug = nullptr,
                                      SimulationProfile* profile = nullptr);

  // Shared cross-method state (readable between/after runs).
  [[nodiscard]] const VariableStore& variables() const { return variables_; }
  [[nodiscard]] VariableStore& variables() { return variables_; }

  [[nodiscard]] std::size_t method_count() const { return methods_.size(); }

 private:
  std::vector<std::uint8_t> bytes_;
  // Verified, parsed view of `bytes_` (built once in load(); run() reuses it
  // instead of re-running the FlatBuffers verifier on every replication).
  IrModelFile verified_;
  // Facilities owned by the kernel across runs.
  SimulationClock clock_;
  std::unique_ptr<BinaryHeapScheduler> scheduler_;
  EventHandlerRegistry handlers_;
  VariableStore variables_;
  std::vector<std::unique_ptr<SimulationMethod>> methods_;
};

}  // namespace logicpilot

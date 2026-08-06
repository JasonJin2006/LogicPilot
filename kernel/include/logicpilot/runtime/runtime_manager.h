// RuntimeManager - owns the method runtimes of one replication.
//
// Execution shape (Method Runtime spec):
//
//   SimulationKernel
//        |
//   RuntimeManager
//        |
//        +---- ProcessRuntime
//        +---- AgentRuntime
//        +---- SDRuntime
//
// The kernel adds one runtime per method present in the model, then drives
// the whole set through initialize -> advance* -> shutdown. RuntimeManager
// never needs to know which methods are attached.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {
struct IrModelFile;

class RuntimeManager {
 public:
  RuntimeManager(SimulationClock& clock, IEventScheduler& scheduler,
                 VariableStore& variables)
      : context_(clock, scheduler, variables) {}

  RuntimeManager(const RuntimeManager&) = delete;
  RuntimeManager& operator=(const RuntimeManager&) = delete;

  // Attach one method runtime (takes ownership). Duplicate method names are
  // rejected with an error.
  bool add(std::unique_ptr<SimulationMethod> method,
           std::string* error = nullptr);

  // Lifecycle: initialize every attached method, then advance until the
  // horizon (or drain), then shutdown. initialize() fails fast on the first
  // method that cannot lower the model.
  bool initialize(const IrModelFile& model, std::string* error = nullptr);
  void advance(SimTime until);
  void shutdown();

  [[nodiscard]] std::size_t method_count() const { return methods_.size(); }
  [[nodiscard]] RuntimeContext& context() { return context_; }

 private:
  RuntimeContext context_;
  std::vector<std::unique_ptr<SimulationMethod>> methods_;
};

}  // namespace logicpilot

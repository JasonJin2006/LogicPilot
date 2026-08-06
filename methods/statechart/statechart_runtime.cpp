// StatechartRuntime implementation.
#include "statechart_runtime.h"

#include <memory>
#include <string>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "statechart_replication.h"

namespace logicpilot {

bool StatechartRuntime::initialize(RuntimeContext& context,
                                   const IrModelFile& model,
                                   std::string* error) {
  context_ = &context;
  ran_ = false;
  last_metrics_ = ReplicationMetrics{};
  if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return false;
  }
  replication_ = to_replication_model(model, error);
  return replication_ != nullptr;
}

void StatechartRuntime::advance(SimTime until) {
  (void)until;  // Phase 4 batch lifecycle; the first advance() runs one
                // full replication (same as the kernel-native methods).
  if (replication_ != nullptr && !ran_) {
    ReplicationConfig config;  // lifecycle driver defaults
    last_metrics_ = replication_->run(config, nullptr);
    ran_ = true;
  }
}

void StatechartRuntime::shutdown() {
  replication_.reset();
  context_ = nullptr;
  ran_ = false;
}

std::unique_ptr<ReplicationModel> StatechartRuntime::to_replication_model(
    const IrModelFile& model, std::string* error) {
  if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return nullptr;
  }
  auto replication =
      std::make_unique<StatechartReplicationModel>(model.v2_root->root(),
                                                   error);
  if (error != nullptr && !error->empty()) {
    return nullptr;
  }
  return replication;
}

void register_statechart_method() {
  MethodRegistry::instance().register_method(
      "statechart", [] { return std::make_unique<StatechartRuntime>(); });
}

}  // namespace logicpilot

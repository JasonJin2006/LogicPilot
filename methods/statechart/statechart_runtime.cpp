// StatechartRuntime implementation.
#include "statechart_runtime.h"  // statechart semantics v1 registration

#include <memory>
#include <string>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/ir_v2_util.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"

#include "ir_v2_generated.h"
#include "statechart_network.h"
#include "statechart_replication.h"

namespace logicpilot {
namespace {

using logicpilot::ir_v2_util::node_is;

// Locate the statechart node: the root itself when it carries the
// {library: statechart, block: statechart} semantics, otherwise the first
// child with that semantics (multi-method model roots).
const ir::v2::Node* find_statechart_node(const ir::v2::Node* root) {
  if (root == nullptr) {
    return nullptr;
  }
  if (node_is(root, "statechart", "statechart")) {
    return root;
  }
  if (root->children() != nullptr) {
    for (const ir::v2::Node* child : *root->children()) {
      if (node_is(child, "statechart", "statechart")) {
        return child;
      }
    }
  }
  return nullptr;
}

bool has_multiple_statecharts(const ir::v2::Node* root) {
  if (root == nullptr || node_is(root, "statechart", "statechart") ||
      root->children() == nullptr) {
    return false;
  }
  std::size_t count = 0;
  for (const ir::v2::Node* child : *root->children()) {
    if (node_is(child, "statechart", "statechart") && ++count > 1) return true;
  }
  return false;
}

}  // namespace

bool StatechartRuntime::initialize(RuntimeContext& context, const IrModelFile& model,
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
  const ir::v2::Node* node = find_statechart_node(model.v2_root->root());
  if (node == nullptr) {
    if (error != nullptr) {
      *error = "no statechart node under the model root";
    }
    return false;
  }
  if (has_multiple_statecharts(model.v2_root->root())) {
    auto network = std::make_unique<StatechartNetworkReplicationModel>(
        model.v2_root->root(), error);
    if (network == nullptr || (error != nullptr && !error->empty())) {
      return false;
    }
    network->attach(context);
    network->reset(context.config());
    replication_ = std::move(network);
    return true;
  }
  replication_ = std::make_unique<StatechartReplicationModel>(node, error);
  if (replication_ == nullptr || (error != nullptr && !error->empty())) {
    replication_.reset();
    return false;
  }
  auto* chart = dynamic_cast<StatechartReplicationModel*>(replication_.get());
  chart->attach(context);
  chart->reset(context.config());
  return true;
}

void StatechartRuntime::advance(SimTime until) {
  if (replication_ == nullptr) {
    return;
  }
  auto* chart = dynamic_cast<StatechartReplicationModel*>(replication_.get());
  if (chart != nullptr) {
    chart->advance(until, nullptr);
    last_metrics_ = chart->metrics();
    ran_ = true;
    return;
  }
  auto* network =
      dynamic_cast<StatechartNetworkReplicationModel*>(replication_.get());
  if (network == nullptr) return;
  network->advance(until);
  last_metrics_ = network->metrics();
  ran_ = true;
}

void StatechartRuntime::shutdown() {
  if (replication_ != nullptr) {
    auto* chart = dynamic_cast<StatechartReplicationModel*>(replication_.get());
    if (chart != nullptr) {
      last_metrics_ = chart->metrics();
    } else if (auto* network = dynamic_cast<StatechartNetworkReplicationModel*>(
                   replication_.get());
               network != nullptr) {
      last_metrics_ = network->metrics();
    }
  }
  replication_.reset();
  context_ = nullptr;
  ran_ = false;
}

std::unique_ptr<ReplicationModel> StatechartRuntime::to_replication_model(const IrModelFile& model,
                                                                          std::string* error) {
  if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return nullptr;
  }
  const ir::v2::Node* root = model.v2_root->root();
  if (has_multiple_statecharts(root)) {
    auto network = std::make_unique<StatechartNetworkReplicationModel>(root, error);
    if (error != nullptr && !error->empty()) return nullptr;
    return network;
  }
  const ir::v2::Node* node = find_statechart_node(root);
  if (node == nullptr) {
    if (error != nullptr) {
      *error = "no statechart node under the model root";
    }
    return nullptr;
  }
  auto replication = std::make_unique<StatechartReplicationModel>(node, error);
  if (error != nullptr && !error->empty()) {
    return nullptr;
  }
  return replication;
}

void register_statechart_method() {
  MethodRegistry::instance().register_method("statechart",
                                             [] { return std::make_unique<StatechartRuntime>(); });
}

}  // namespace logicpilot

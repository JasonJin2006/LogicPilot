// StatechartRuntime implementation.
#include "statechart_runtime.h"  // statechart semantics v1 registration

#include <memory>
#include <string>

#include "logicpilot/runtime/ir_loader.h"
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
      chart->cancel_pending_events();
    } else if (auto* network = dynamic_cast<StatechartNetworkReplicationModel*>(
                   replication_.get());
               network != nullptr) {
      last_metrics_ = network->metrics();
      network->cancel_pending_events();
    }
  }
  replication_.reset();
  context_ = nullptr;
  ran_ = false;
}

bool StatechartRuntime::save_method_checkpoint(MethodCheckpoint& checkpoint,
                                               std::string* error) const {
  const auto* chart = dynamic_cast<const StatechartReplicationModel*>(
      replication_.get());
  if (chart == nullptr) {
    const auto* network = dynamic_cast<const StatechartNetworkReplicationModel*>(
        replication_.get());
    if (network == nullptr) {
      if (error != nullptr) *error = "statechart runtime has no checkpointable model";
      return false;
    }
    checkpoint = MethodCheckpoint{};
    checkpoint.method = "statechart";
    checkpoint.schema_version = 2;
    checkpoint.now = context_ != nullptr ? context_->clock().now()
                                         : SimTime::zero();
    if (!network->checkpoint_save(checkpoint.state)) {
      if (error != nullptr) *error = "statechart network checkpoint_save failed";
      return false;
    }
    return true;
  }
  checkpoint = MethodCheckpoint{};
  checkpoint.method = "statechart";
  checkpoint.schema_version = 1;
  checkpoint.now = context_ != nullptr ? context_->clock().now()
                                       : SimTime::zero();
  if (!chart->checkpoint_save(checkpoint.state)) {
    if (error != nullptr) *error = "statechart checkpoint_save failed";
    return false;
  }
  return true;
}

bool StatechartRuntime::restore_method_checkpoint(
    const MethodCheckpoint& checkpoint, std::string* error) {
  auto* chart = dynamic_cast<StatechartReplicationModel*>(replication_.get());
  auto* network = dynamic_cast<StatechartNetworkReplicationModel*>(replication_.get());
  if ((chart == nullptr && network == nullptr) || checkpoint.method != "statechart" ||
      (chart != nullptr && checkpoint.schema_version != 1) ||
      (network != nullptr && checkpoint.schema_version != 2)) {
    if (error != nullptr) {
      *error = "unsupported statechart checkpoint bundle";
    }
    return false;
  }
  if (context_ != nullptr) {
    context_->clock().reset(checkpoint.now);
  }
  if (chart != nullptr) {
    if (!chart->checkpoint_restore(checkpoint.state)) {
      if (error != nullptr) *error = "statechart checkpoint_restore failed";
      return false;
    }
  } else if (!network->checkpoint_restore(checkpoint.state)) {
    if (error != nullptr) *error = "statechart network checkpoint_restore failed";
    return false;
  }
  return true;
}

std::uint32_t StatechartRuntime::checkpoint_schema_version() const {
  return dynamic_cast<const StatechartNetworkReplicationModel*>(
             replication_.get()) != nullptr
             ? 2
             : 1;
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
                                             [] { return std::make_unique<StatechartRuntime>(); },
      MethodRegistry::Descriptor{"1", {"1"}, MethodFamily::kDiscreteEvent,
                                 MethodFormalism::kStatechart});
}

}  // namespace logicpilot

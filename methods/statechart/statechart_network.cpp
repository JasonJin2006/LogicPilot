// Composite Statechart runtime implementation.
#include "statechart_network.h"

#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_v2_util.h"
#include "logicpilot/runtime/runtime_context.h"

namespace logicpilot {
namespace {

using logicpilot::ir_v2_util::node_is;
using ir::v2::Coupling;
using ir::v2::Node;

struct Route {
  std::string from_model;
  std::string from_port;
  std::string to_model;
  std::string to_port;
};

const std::string node_name(const Node* node) {
  if (node == nullptr || node->metadata() == nullptr ||
      node->metadata()->name() == nullptr) {
    return {};
  }
  return node->metadata()->name()->str();
}

}  // namespace

struct StatechartNetworkReplicationModel::Impl {
  struct Chart {
    std::string name;
    std::unique_ptr<StatechartReplicationModel> model;
  };

  std::vector<Chart> charts;
  std::vector<Route> routes;
  ReplicationConfig config;
  bool valid{false};
  bool routing_emissions{false};

  void route_emissions() {
    if (routing_emissions) return;
    routing_emissions = true;
    // A message action can synchronously trigger another chart, which can
    // emit again. Bound cascades so a cyclic coupling cannot hang the worker.
    for (std::size_t round = 0; round < 1024; ++round) {
      bool routed = false;
      for (Chart& source : charts) {
        for (const std::string& port : source.model->take_emitted_messages()) {
          for (const Route& route : routes) {
            if (route.from_model != source.name || route.from_port != port) {
              continue;
            }
            for (Chart& target : charts) {
              if (target.name == route.to_model &&
                  target.model->dispatch_message(route.to_port)) {
                routed = true;
              }
            }
          }
        }
      }
      if (!routed) {
        routing_emissions = false;
        return;
      }
    }
    routing_emissions = false;
  }

  bool dispatch_message(const std::string& port) {
    bool dispatched = false;
    for (Chart& chart : charts) {
      dispatched = chart.model->dispatch_message(port) || dispatched;
    }
    route_emissions();
    return dispatched;
  }
};

StatechartNetworkReplicationModel::StatechartNetworkReplicationModel(
    const Node* root, std::string* error)
    : impl_(std::make_unique<Impl>()) {
  const auto fail = [&](const std::string& message) {
    if (error != nullptr) *error = message;
    impl_.reset();
  };
  if (root == nullptr) {
    fail("statechart network has no root");
    return;
  }

  std::vector<const Node*> nodes;
  if (node_is(root, "statechart", "statechart")) {
    nodes.push_back(root);
  } else if (root->children() != nullptr) {
    for (const Node* child : *root->children()) {
      if (node_is(child, "statechart", "statechart")) nodes.push_back(child);
    }
  }
  if (nodes.empty()) {
    fail("statechart network has no statechart children");
    return;
  }
  for (const Node* node : nodes) {
    std::string chart_error;
    auto chart = std::make_unique<StatechartReplicationModel>(node, &chart_error);
    if (!chart_error.empty() || chart == nullptr) {
      fail(chart_error.empty() ? "statechart child failed to build" : chart_error);
      return;
    }
    impl_->charts.push_back(Impl::Chart{node_name(node), std::move(chart)});
  }
  if (root->couplings() != nullptr) {
    for (const Coupling* coupling : *root->couplings()) {
      if (coupling == nullptr || coupling->from_model() == nullptr ||
          coupling->from_port() == nullptr || coupling->to_model() == nullptr ||
          coupling->to_port() == nullptr) {
        continue;
      }
      impl_->routes.push_back(Route{coupling->from_model()->str(),
                                    coupling->from_port()->str(),
                                    coupling->to_model()->str(),
                                    coupling->to_port()->str()});
    }
  }
  // The callback is installed during reset (after every chart has been
  // reset), so immediate condition transitions cannot reach a sibling's old
  // state from the previous replication.
  impl_->valid = true;
}

StatechartNetworkReplicationModel::~StatechartNetworkReplicationModel() = default;

bool StatechartNetworkReplicationModel::reset(const ReplicationConfig& config) {
  if (impl_ == nullptr || !impl_->valid) return false;
  impl_->config = config;
  for (auto& chart : impl_->charts) chart.model->set_emission_callback({});
  for (auto& chart : impl_->charts) chart.model->reset(config);
  for (auto& chart : impl_->charts) {
    chart.model->set_emission_callback([this] { impl_->route_emissions(); });
  }
  impl_->route_emissions();
  return true;
}

void StatechartNetworkReplicationModel::attach(RuntimeContext& context) {
  if (impl_ == nullptr) return;
  for (auto& chart : impl_->charts) chart.model->attach(context);
}

void StatechartNetworkReplicationModel::cancel_pending_events() {
  if (impl_ == nullptr) return;
  for (auto& chart : impl_->charts) chart.model->cancel_pending_events();
}

std::size_t StatechartNetworkReplicationModel::advance(SimTime until) {
  if (impl_ == nullptr || !impl_->valid) return 0;
  std::size_t dispatched = 0;
  for (auto& chart : impl_->charts) {
    dispatched += chart.model->advance(until, nullptr);
  }
  impl_->route_emissions();
  return dispatched;
}

bool StatechartNetworkReplicationModel::dispatch_message(const std::string& port) {
  return impl_ != nullptr && impl_->dispatch_message(port);
}

bool StatechartNetworkReplicationModel::done() const {
  if (impl_ == nullptr || !impl_->valid) return true;
  return std::all_of(impl_->charts.begin(), impl_->charts.end(),
                     [](const Impl::Chart& chart) { return chart.model->done(); });
}

bool StatechartNetworkReplicationModel::has_pending_events() {
  if (impl_ == nullptr || !impl_->valid) return false;
  return std::any_of(impl_->charts.begin(), impl_->charts.end(),
                     [](Impl::Chart& chart) { return chart.model->has_pending_events(); });
}

ReplicationMetrics StatechartNetworkReplicationModel::metrics() const {
  ReplicationMetrics result;
  if (impl_ == nullptr || !impl_->valid) return result;
  for (const auto& chart : impl_->charts) {
    const ReplicationMetrics metrics = chart.model->metrics();
    result.arrivals += metrics.arrivals;
    result.departures += metrics.departures;
    result.horizon_seconds = std::max(result.horizon_seconds, metrics.horizon_seconds);
    if (result.arrivals == metrics.arrivals) result.final_value = metrics.final_value;
  }
  return result;
}

std::vector<StatechartSnapshot>
StatechartNetworkReplicationModel::snapshots() const {
  std::vector<StatechartSnapshot> result;
  if (impl_ == nullptr || !impl_->valid) return result;
  result.reserve(impl_->charts.size());
  for (const auto& chart : impl_->charts) {
    result.push_back(StatechartSnapshot{chart.name, chart.model->current_state_name(),
                                        chart.model->step_count()});
  }
  return result;
}

ReplicationMetrics StatechartNetworkReplicationModel::run(
    const ReplicationConfig& config, TraceRecorder* trace) {
  if (!reset(config)) return ReplicationMetrics{};
  advance(SimTime::infinity());
  const ReplicationMetrics result = metrics();
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(result.horizon_seconds * 1e9));
    trace->absorb(result.arrivals);
  }
  return result;
}

}  // namespace logicpilot

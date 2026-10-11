// Composite Statechart runtime implementation.
#include "statechart_network.h"

#include <algorithm>
#include <cstdint>
#include <limits>
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

constexpr std::uint32_t kNetworkCheckpointMagic = 0x4C50534EU;  // LPSN
constexpr std::uint8_t kNetworkCheckpointVersion = 2;

void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int byte = 0; byte < 4; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}
void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  for (int byte = 0; byte < 8; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}
bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int byte = 0; byte < 4; ++byte) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}
bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int byte = 0; byte < 8; ++byte) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}
void append_string(std::vector<std::uint8_t>& out, const std::string& value) {
  append_u32(out, static_cast<std::uint32_t>(value.size()));
  out.insert(out.end(), value.begin(), value.end());
}
bool read_string(std::span<const std::uint8_t> bytes, std::size_t& offset,
                 std::string& value) {
  std::uint32_t size = 0;
  if (!read_u32(bytes, offset, size) || size > 1'000'000 ||
      size > bytes.size() - offset) return false;
  value.assign(reinterpret_cast<const char*>(bytes.data() + offset), size);
  offset += size;
  return true;
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

  [[nodiscard]] bool failed() const {
    return std::any_of(charts.begin(), charts.end(),
                       [](const Chart& chart) { return chart.model->failed(); });
  }

  [[nodiscard]] const std::string& failure_reason() const {
    static const std::string kNoFailure;
    for (const Chart& chart : charts) {
      if (chart.model->failed()) return chart.model->failure_reason();
    }
    return kNoFailure;
  }

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
  const std::uint64_t chart_count =
      static_cast<std::uint64_t>(impl_->charts.size());
  for (std::size_t index = 0; index < impl_->charts.size(); ++index) {
    ReplicationConfig child_config = config;
    if (chart_count > 0 && config.max_events > 0) {
      const std::uint64_t base = config.max_events / chart_count;
      const std::uint64_t remainder = config.max_events % chart_count;
      child_config.max_events =
          base + (static_cast<std::uint64_t>(index) < remainder ? 1 : 0);
    }
    impl_->charts[index].model->reset(child_config);
  }
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
  if (impl_ == nullptr || !impl_->valid || impl_->failed()) return 0;
  std::size_t dispatched = 0;
  for (auto& chart : impl_->charts) {
    dispatched += chart.model->advance(until, nullptr);
  }
  impl_->route_emissions();
  return dispatched;
}

// See StatechartReplicationModel::inject: the port is the whole message.
bool StatechartNetworkReplicationModel::inject(const std::string& port,
                                               std::uint64_t payload) {
  (void)payload;
  return dispatch_message(port);
}

bool StatechartNetworkReplicationModel::dispatch_message(const std::string& port) {
  return impl_ != nullptr && !impl_->failed() && impl_->dispatch_message(port);
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

bool StatechartNetworkReplicationModel::failed() const {
  return impl_ != nullptr && impl_->failed();
}

const std::string& StatechartNetworkReplicationModel::failure_reason() const {
  static const std::string kNoFailure;
  return impl_ != nullptr ? impl_->failure_reason() : kNoFailure;
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

bool StatechartNetworkReplicationModel::checkpoint_save(
    std::vector<std::uint8_t>& state) const {
  if (impl_ == nullptr || !impl_->valid || impl_->charts.size() >
                                      std::numeric_limits<std::uint32_t>::max()) {
    return false;
  }
  state.clear();
  append_u32(state, kNetworkCheckpointMagic);
  state.push_back(kNetworkCheckpointVersion);
  append_u64(state, impl_->config.seed);
  append_u64(state, impl_->config.arrivals);
  append_u64(state, impl_->config.warmup_arrivals);
  append_u64(state, impl_->config.max_events);
  append_u32(state, static_cast<std::uint32_t>(impl_->charts.size()));
  for (const Impl::Chart& chart : impl_->charts) {
    std::vector<std::uint8_t> child;
    if (!chart.model->checkpoint_save(child) ||
        child.size() > std::numeric_limits<std::uint32_t>::max()) {
      return false;
    }
    append_string(state, chart.name);
    append_u32(state, static_cast<std::uint32_t>(child.size()));
    state.insert(state.end(), child.begin(), child.end());
  }
  return true;
}

bool StatechartNetworkReplicationModel::checkpoint_restore(
    std::span<const std::uint8_t> state) {
  if (impl_ == nullptr || !impl_->valid) return false;
  std::size_t offset = 0;
  std::uint32_t magic = 0, count = 0;
  if (!read_u32(state, offset, magic) || magic != kNetworkCheckpointMagic ||
      offset >= state.size() || state[offset++] != kNetworkCheckpointVersion)
    return false;
  ReplicationConfig config;
  if (!read_u64(state, offset, config.seed) ||
      !read_u64(state, offset, config.arrivals) ||
      !read_u64(state, offset, config.warmup_arrivals) ||
      !read_u64(state, offset, config.max_events) ||
      !read_u32(state, offset, count) || count != impl_->charts.size())
    return false;
  std::vector<std::vector<std::uint8_t>> child_states;
  child_states.reserve(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    std::string name;
    std::uint32_t size = 0;
    if (!read_string(state, offset, name) ||
        !read_u32(state, offset, size) || size > state.size() - offset ||
        name != impl_->charts[index].name) return false;
    child_states.emplace_back(state.begin() + static_cast<std::ptrdiff_t>(offset),
                              state.begin() +
                                  static_cast<std::ptrdiff_t>(offset + size));
    offset += size;
  }
  if (offset != state.size()) return false;
  for (std::size_t index = 0; index < child_states.size(); ++index) {
    if (!impl_->charts[index].model->checkpoint_restore(child_states[index])) {
      return false;
    }
  }
  impl_->config = config;
  impl_->routing_emissions = false;
  for (auto& chart : impl_->charts) {
    chart.model->set_emission_callback([this] { impl_->route_emissions(); });
  }
  return true;
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

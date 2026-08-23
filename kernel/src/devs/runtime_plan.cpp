// DevsRuntimePlan compiler (see runtime_plan.h).
#include "logicpilot/devs/runtime_plan.h"

#include <algorithm>
#include <limits>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace logicpilot {
namespace {

enum class EndpointKind : std::uint8_t { kAtomOut, kAtomIn, kCoupledIn,
                                         kCoupledOut };

struct Endpoint {
  EndpointKind kind{EndpointKind::kAtomOut};
  std::uint32_t node{0};
  PortId port{kInvalidPort};

  bool operator==(const Endpoint&) const = default;
};

struct EndpointHash {
  std::size_t operator()(const Endpoint& endpoint) const {
    const std::uint64_t packed =
        (std::uint64_t{static_cast<std::uint32_t>(endpoint.kind)} << 48) |
        (std::uint64_t{endpoint.node} << 24) | endpoint.port;
    return std::hash<std::uint64_t>{}(packed);
  }
};

struct FlatState {
  std::unordered_map<Endpoint, std::vector<Endpoint>, EndpointHash> edges;
  std::vector<Endpoint> sources;
};

bool endpoint_less(const Endpoint& left, const Endpoint& right) {
  if (left.kind != right.kind) {
    return static_cast<std::uint32_t>(left.kind) <
           static_cast<std::uint32_t>(right.kind);
  }
  if (left.node != right.node) {
    return left.node < right.node;
  }
  return left.port < right.port;
}

bool compatible_port_types(std::string_view from, std::string_view to) {
  if (from.empty() || to.empty() || from == "any" || to == "any" ||
      from == "message" || to == "message") {
    return true;
  }
  return from == to;
}

}  // namespace

DevsRuntimePlan DevsRuntimePlan::compile(CoupledModel& root) {
  DevsRuntimePlan plan;
  FlatState flat;
  std::unordered_map<std::string, PortId> coupled_ports;
  std::uint32_t next_scope = 0;

  const auto intern_port = [&](const std::string& name) -> PortId {
    const auto it = coupled_ports.find(name);
    if (it != coupled_ports.end()) {
      return it->second;
    }
    if (coupled_ports.size() >= std::numeric_limits<PortId>::max()) {
      throw std::overflow_error("DevsRuntimePlan: too many coupled ports");
    }
    const auto id = static_cast<PortId>(coupled_ports.size());
    coupled_ports.emplace(name, id);
    plan.root_port_names_.push_back(name);
    return id;
  };

  const auto flatten_scope = [&](const CoupledModel& model, auto& self,
                                 std::uint32_t scope, bool is_root,
                                 std::size_t depth,
                                 const std::string& prefix) -> void {
    if (depth > 256) {
      throw std::overflow_error(
          "DevsRuntimePlan: coupled-model nesting exceeds 256 levels");
    }

    struct ChildRef {
      std::uint32_t index{0};
      bool is_atomic{false};
    };
    std::unordered_map<std::string, ChildRef> children;
    struct Nested {
      const CoupledModel* model{nullptr};
      std::uint32_t scope{0};
      std::string path;
    };
    std::vector<Nested> nested;

    for (const CoupledModel::Child& child : model.children()) {
      if (child.name.empty()) {
        throw std::logic_error("DevsRuntimePlan: child model name is empty");
      }
      if (child.is_atomic()) {
        if (!children.emplace(child.name,
                              ChildRef{static_cast<std::uint32_t>(
                                           plan.atoms_.size()),
                                       true})
                 .second) {
          throw std::logic_error("DevsRuntimePlan: duplicate child '" +
                                 child.name + "' in '" + model.name() + "'");
        }
        plan.atoms_.push_back(child.atomic.get());
        plan.atom_paths_.push_back(
            prefix.empty() ? child.name : prefix + "." + child.name);
      } else {
        if (child.coupled == nullptr) {
          throw std::logic_error("DevsRuntimePlan: coupled child '" +
                                 child.name + "' has no model");
        }
        const std::uint32_t child_scope = ++next_scope;
        if (!children.emplace(child.name, ChildRef{child_scope, false})
                 .second) {
          throw std::logic_error("DevsRuntimePlan: duplicate child '" +
                                 child.name + "' in '" + model.name() + "'");
        }
        nested.push_back(Nested{child.coupled.get(), child_scope,
                                prefix.empty() ? child.name
                                               : prefix + "." + child.name});
      }
    }

    const auto endpoint_for = [&](const std::string& model_name,
                                  const std::string& port_name,
                                  bool as_source) -> Endpoint {
      if (model_name == ".") {
        return Endpoint{as_source ? EndpointKind::kCoupledIn
                                  : EndpointKind::kCoupledOut,
                        scope, intern_port(port_name)};
      }
      const auto it = children.find(model_name);
      if (it == children.end()) {
        throw std::logic_error(
            "DevsRuntimePlan: coupling references unknown child '" +
            model_name + "' in '" + model.name() + "'");
      }
      if (it->second.is_atomic) {
        AtomicModel* atom = plan.atoms_[it->second.index];
        const PortId port = atom->resolve_port(port_name);
        return Endpoint{as_source ? EndpointKind::kAtomOut
                                  : EndpointKind::kAtomIn,
                        it->second.index, port};
      }
      return Endpoint{as_source ? EndpointKind::kCoupledOut
                                : EndpointKind::kCoupledIn,
                      it->second.index, intern_port(port_name)};
    };

    for (const CouplingSpec& coupling : model.couplings()) {
      Endpoint from = endpoint_for(coupling.from_model, coupling.from_port,
                                   true);
      Endpoint to = endpoint_for(coupling.to_model, coupling.to_port, false);
      flat.edges[from].push_back(to);
    }

    if (is_root) {
      for (const CouplingSpec& coupling : model.couplings()) {
        if (coupling.from_model == ".") {
          flat.sources.push_back(Endpoint{EndpointKind::kCoupledIn, scope,
                                          intern_port(coupling.from_port)});
        }
      }
    }

    for (const Nested& child : nested) {
      self(*child.model, self, child.scope, false, depth + 1, child.path);
    }
  };

  flatten_scope(root, flatten_scope, 0, true, 0, {});

  for (const auto& [endpoint, targets] : flat.edges) {
    if (endpoint.kind == EndpointKind::kAtomOut) {
      flat.sources.push_back(endpoint);
    }
  }
  std::sort(flat.sources.begin(), flat.sources.end(), endpoint_less);
  flat.sources.erase(std::unique(flat.sources.begin(), flat.sources.end()),
                     flat.sources.end());

  plan.output_index_.resize(plan.atoms_.size());
  for (std::size_t atom = 0; atom < plan.atoms_.size(); ++atom) {
    plan.output_index_[atom].resize(plan.atoms_[atom]->port_count());
  }
  plan.root_index_.resize(plan.root_port_names_.size());

  const auto append_route = [](std::vector<RouteSpan>& index,
                               std::vector<RouteTarget>& targets,
                               std::size_t slot,
                               std::vector<RouteTarget> sinks) {
    if (slot >= index.size() || sinks.size() >
                                  std::numeric_limits<std::uint32_t>::max()) {
      throw std::overflow_error("DevsRuntimePlan: route table is too large");
    }
    std::sort(sinks.begin(), sinks.end(), [](const RouteTarget& left,
                                            const RouteTarget& right) {
      if (left.atom != right.atom) {
        return left.atom < right.atom;
      }
      return left.port < right.port;
    });
    const std::size_t begin = targets.size();
    if (begin > std::numeric_limits<std::uint32_t>::max() - sinks.size()) {
      throw std::overflow_error("DevsRuntimePlan: route table is too large");
    }
    targets.insert(targets.end(), sinks.begin(), sinks.end());
    index[slot] = RouteSpan{static_cast<std::uint32_t>(begin),
                            static_cast<std::uint32_t>(sinks.size())};
  };

  for (const Endpoint& source : flat.sources) {
    std::vector<RouteTarget> sinks;
    std::unordered_set<Endpoint, EndpointHash> visited;
    std::vector<Endpoint> stack{source};
    while (!stack.empty()) {
      const Endpoint current = stack.back();
      stack.pop_back();
      if (!visited.insert(current).second) {
        continue;
      }
      if (current.kind == EndpointKind::kAtomIn) {
        sinks.push_back(RouteTarget{current.node, current.port});
        continue;
      }
      const auto it = flat.edges.find(current);
      if (it != flat.edges.end()) {
        for (const Endpoint& next : it->second) {
          stack.push_back(next);
        }
      }
    }

    if (source.kind == EndpointKind::kAtomOut) {
      if (source.node >= plan.output_index_.size() ||
          source.port >= plan.output_index_[source.node].size()) {
        throw std::logic_error("DevsRuntimePlan: invalid atom output port");
      }
      const AtomicModel* source_atom = plan.atoms_[source.node];
      for (const RouteTarget& sink : sinks) {
        const AtomicModel* target_atom = plan.atoms_[sink.atom];
        const std::string_view from_type = source_atom->port_type(source.port);
        const std::string_view to_type = target_atom->port_type(sink.port);
        if (!compatible_port_types(from_type, to_type)) {
          throw std::logic_error(
              "DevsRuntimePlan: incompatible event types on '" +
              plan.atom_paths_[source.node] + "' (" + std::string(from_type) +
              ") -> '" + plan.atom_paths_[sink.atom] + "' (" +
              std::string(to_type) + ")");
        }
      }
      append_route(plan.output_index_[source.node], plan.output_targets_,
                   source.port, std::move(sinks));
    } else {
      if (source.port >= plan.root_index_.size()) {
        throw std::logic_error("DevsRuntimePlan: invalid root input port");
      }
      append_route(plan.root_index_, plan.root_targets_, source.port,
                   std::move(sinks));
    }
  }

  return plan;
}

std::span<const DevsRuntimePlan::RouteTarget>
DevsRuntimePlan::output_targets(std::uint32_t atom, PortId port) const {
  if (atom >= output_index_.size() || port >= output_index_[atom].size()) {
    return {};
  }
  const RouteSpan span = output_index_[atom][port];
  if (!span.valid()) {
    return {};
  }
  return std::span<const RouteTarget>(output_targets_).subspan(span.begin,
                                                                span.count);
}

std::span<const DevsRuntimePlan::RouteTarget>
DevsRuntimePlan::root_targets(PortId port) const {
  if (port >= root_index_.size()) {
    return {};
  }
  const RouteSpan span = root_index_[port];
  if (!span.valid()) {
    return {};
  }
  return std::span<const RouteTarget>(root_targets_).subspan(span.begin,
                                                              span.count);
}

std::optional<PortId> DevsRuntimePlan::root_port_id(
    std::string_view name) const {
  for (PortId id = 0; id < root_port_names_.size(); ++id) {
    if (root_port_names_[id] == name) {
      return id;
    }
  }
  return std::nullopt;
}

}  // namespace logicpilot

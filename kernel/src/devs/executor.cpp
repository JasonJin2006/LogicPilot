// DevsExecutor implementation: coupling-tree flattening + next-event loop.
#include "logicpilot/devs/executor.h"

#include <stdexcept>
#include <unordered_set>
#include <utility>

namespace logicpilot {
namespace {

constexpr EventType kInternalEvent = 1;
constexpr EventType kExternalEvent = 2;

// Endpoint of the flattened routing graph.
enum class EpKind : std::uint8_t { kAtomOut, kAtomIn, kCplIn, kCplOut };

struct Endpoint {
  EpKind kind;
  std::uint32_t node;  // atom index (Atom*) or coupled scope id (Cpl*)
  PortId port;

  bool operator==(const Endpoint&) const = default;
};

struct EndpointHash {
  std::size_t operator()(const Endpoint& e) const {
    const std::uint64_t packed =
        (std::uint64_t{static_cast<std::uint32_t>(e.kind)} << 48) |
        (std::uint64_t{e.node} << 24) | e.port;
    return std::hash<std::uint64_t>{}(packed);
  }
};

struct FlatState {
  // Adjacency over endpoints (cold-path maps; load-time only).
  std::unordered_map<Endpoint, std::vector<Endpoint>, EndpointHash> edges;
  std::vector<Endpoint> sources;  // AtomOut + root CplIn endpoints
};

}  // namespace

DevsExecutor::DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock)
    : scheduler_{scheduler}, clock_{clock} {
  dispatch_handler_ = handlers_.add(
      [this](const Event& event) { this->on_event(event); });
}

PortId DevsExecutor::intern_port(const std::string& name) {
  // Coupled-scope (pass-through) ports only; atom ports resolve through the
  // owning AtomicModel's own declare_port/resolve_port table.
  const auto it = cpl_port_ids_.find(name);
  if (it != cpl_port_ids_.end()) {
    return it->second;
  }
  const auto id = static_cast<PortId>(cpl_port_ids_.size());
  cpl_port_ids_.emplace(name, id);
  return id;
}

std::size_t DevsExecutor::load(CoupledModel& root) {
  atoms_.clear();
  cpl_port_ids_.clear();
  out_routes_.clear();
  root_in_routes_.clear();
  pending_.clear();
  ext_inputs_.clear();
  dispatched_ = 0;

  FlatState flat;
  std::uint32_t next_scope = 0;

  // Recursive flattening: registers atoms, creates endpoint edges per scope.
  const auto flatten_scope = [&](const CoupledModel& model, auto& self,
                                 std::uint32_t scope, bool is_root) -> void {
    // Child name -> (atom index | child scope, is_atomic).
    struct ChildRef {
      std::uint32_t index;
      bool is_atomic;
    };
    std::unordered_map<std::string, ChildRef> children;
    std::vector<std::pair<const CoupledModel*, std::uint32_t>> nested;

    for (const CoupledModel::Child& child : model.children()) {
      if (child.is_atomic()) {
        const auto idx = static_cast<std::uint32_t>(atoms_.size());
        atoms_.push_back(child.atomic.get());
        children.emplace(child.name, ChildRef{idx, true});
      } else {
        const std::uint32_t child_scope = ++next_scope;
        children.emplace(child.name, ChildRef{child_scope, false});
        nested.emplace_back(child.coupled.get(), child_scope);
      }
    }

    const auto endpoint_for = [&](const std::string& model_name,
                                  const std::string& port_name,
                                  bool as_source) -> Endpoint {
      if (model_name == ".") {
        return Endpoint{as_source ? EpKind::kCplIn : EpKind::kCplOut, scope,
                        intern_port(port_name)};
      }
      const auto it = children.find(model_name);
      if (it == children.end()) {
        throw std::logic_error("DevsExecutor: coupling references unknown "
                               "child '" + model_name + "' in '" +
                               model.name() + "'");
      }
      if (it->second.is_atomic) {
        // Atom ports are model-local: resolve through the atom's own table.
        const PortId port =
            atoms_[it->second.index]->resolve_port(port_name);
        return Endpoint{as_source ? EpKind::kAtomOut : EpKind::kAtomIn,
                        it->second.index, port};
      }
      const PortId port = intern_port(port_name);
      return Endpoint{as_source ? EpKind::kCplOut : EpKind::kCplIn,
                      it->second.index, port};
    };

    for (const CouplingSpec& c : model.couplings()) {
      Endpoint from = endpoint_for(c.from_model, c.from_port, true);
      Endpoint to = endpoint_for(c.to_model, c.to_port, false);
      flat.edges[from].push_back(to);
    }

    if (is_root) {
      // Root-level input ports become injectable sources.
      for (const CouplingSpec& c : model.couplings()) {
        if (c.from_model == ".") {
          flat.sources.push_back(
              Endpoint{EpKind::kCplIn, scope, intern_port(c.from_port)});
        }
      }
    }

    for (auto& [child_model, child_scope] : nested) {
      self(*child_model, self, child_scope, false);
    }
  };
  flatten_scope(root, flatten_scope, 0, true);

  // Collect AtomOut sources (every output coupling origin).
  for (const auto& [ep, targets] : flat.edges) {
    if (ep.kind == EpKind::kAtomOut) {
      flat.sources.push_back(ep);
    }
  }

  // Resolve each source through the endpoint graph down to AtomIn sinks.
  for (const Endpoint& source : flat.sources) {
    std::vector<RouteTarget> sinks;
    std::unordered_set<Endpoint, EndpointHash> visited;
    std::vector<Endpoint> stack{source};
    while (!stack.empty()) {
      const Endpoint cur = stack.back();
      stack.pop_back();
      if (!visited.insert(cur).second) {
        continue;
      }
      if (cur.kind == EpKind::kAtomIn) {
        sinks.push_back(RouteTarget{cur.node, cur.port});
        continue;  // AtomIn is terminal
      }
      const auto it = flat.edges.find(cur);
      if (it != flat.edges.end()) {
        for (const Endpoint& next : it->second) {
          stack.push_back(next);
        }
      }
    }
    if (source.kind == EpKind::kAtomOut) {
      out_routes_[route_key(source.node, source.port)] = std::move(sinks);
    } else {  // root CplIn
      root_in_routes_[source.port] = std::move(sinks);
    }
  }

  // Initial scheduling: every active atom gets its first internal event.
  pending_.assign(atoms_.size(), EventToken{});
  for (std::uint32_t i = 0; i < atoms_.size(); ++i) {
    reschedule(i);
  }
  return atoms_.size();
}

bool DevsExecutor::inject(const std::string& root_port,
                          std::uint64_t payload) {
  const auto it = cpl_port_ids_.find(root_port);
  if (it == cpl_port_ids_.end()) {
    return false;
  }
  const auto routes = root_in_routes_.find(it->second);
  if (routes == root_in_routes_.end()) {
    return false;
  }
  for (const RouteTarget& t : routes->second) {
    deliver_external(t.atom, PortEvent{t.port, payload});
  }
  return true;
}

std::size_t DevsExecutor::run(SimTime horizon) {
  const std::size_t n = run_until(scheduler_, clock_, horizon,
                                  [this](const Event& event) {
                                    handlers_.dispatch(event);
                                  });
  dispatched_ += n;
  return n;
}

void DevsExecutor::on_event(const Event& event) {
  if (event.type == kInternalEvent) {
    deliver_internal(static_cast<std::uint32_t>(event.payload));
  } else {
    // External inputs are delivered synchronously inside deliver_internal /
    // inject(); scheduler-driven external events use this side channel.
    const ExtInput& in = ext_inputs_.at(event.payload);
    deliver_external(in.atom, in.event);
  }
}

void DevsExecutor::deliver_internal(std::uint32_t atom) {
  AtomicModel& model = *atoms_[atom];
  const SimTime now = clock_.now();
  pending_[atom] = EventToken{};

  model.internal_transition(now);

  // Route staged outputs synchronously through the flattened routing table.
  for (const PortEvent& out : model.staged_outputs()) {
    const auto it = out_routes_.find(route_key(atom, out.port));
    if (it == out_routes_.end()) {
      continue;  // unconnected output port: dropped by design
    }
    for (const RouteTarget& t : it->second) {
      deliver_external(t.atom, PortEvent{t.port, out.payload});
    }
  }
  model.clear_outputs();

  reschedule(atom);
}

void DevsExecutor::deliver_external(std::uint32_t atom,
                                    const PortEvent& input) {
  AtomicModel& model = *atoms_[atom];
  const SimTime now = clock_.now();
  // External input preempts the pending internal transition (DEVS-lite: the
  // model restarts its full ta(); elapsed-time carryover is not modeled).
  if (pending_[atom].valid()) {
    scheduler_.cancel(pending_[atom]);
    pending_[atom] = EventToken{};
  }
  model.external_transition(now, input.port, input.payload);
  reschedule(atom);
}

void DevsExecutor::reschedule(std::uint32_t atom) {
  const SimTime ta = atoms_[atom]->time_advance();
  if (ta.is_infinity()) {
    return;  // passive model
  }
  const SimTime at = clock_.now() + ta;
  pending_[atom] = scheduler_.schedule(at, kInternalEvent, dispatch_handler_,
                                       atom);
}

}  // namespace logicpilot

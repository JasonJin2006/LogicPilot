// Phase 1 platform contracts: hand-written utilities (version gate, dependency
// resolution). Types live in contracts_generated.h; do not redeclare them here.
#include "logicpilot/contracts/contracts.h"

#include <algorithm>
#include <map>
#include <set>

namespace logicpilot::contracts {

bool is_supported_plugin_api_version(std::int64_t version) { return version == 1; }

ActivationOrderResult resolve_activation_order(const std::vector<PluginManifest>& manifests) {
  ActivationOrderResult result;

  std::map<std::string, const PluginManifest*> by_id;
  std::set<std::string> ids;
  for (const auto& manifest : manifests) ids.insert(manifest.id);
  for (const auto& manifest : manifests) {
    if (!by_id.emplace(manifest.id, &manifest).second) {
      result.cycles.push_back("duplicate plugin id: " + manifest.id);
      return result;
    }
  }

  for (const auto& [id, manifest] : by_id) {
    for (const auto& dep : manifest->requires_) {
      if (dep.optional.has_value() && *dep.optional) continue;
      if (ids.count(dep.id) == 0) result.missing.push_back(id + " -> " + dep.id);
    }
  }
  if (!result.missing.empty()) {
    std::sort(result.missing.begin(), result.missing.end());
    return result;
  }

  // DFS with an on-stack marker; iteration over std::map keeps the order
  // deterministic.
  enum class State { kUnvisited, kVisiting, kDone };
  std::map<std::string, State> state;
  std::vector<std::string> stack;

  struct Visitor {
    std::map<std::string, State>* state;
    std::vector<std::string>* stack;
    std::vector<std::string>* order;
    std::vector<std::string>* cycles;
    std::map<std::string, const PluginManifest*>* by_id;

    void visit(const std::string& id) {
      auto& marker = (*state)[id];
      if (marker == State::kDone) return;
      if (marker == State::kVisiting) {
        auto start = std::find(stack->begin(), stack->end(), id);
        std::vector<std::string> loop(start != stack->end() ? start : stack->begin(), stack->end());
        loop.push_back(id);
        std::string path;
        for (std::size_t i = 0; i < loop.size(); ++i) {
          if (i > 0) path += " -> ";
          path += loop[i];
        }
        cycles->push_back(path);
        return;
      }
      auto it = by_id->find(id);
      if (it == by_id->end()) return;
      marker = State::kVisiting;
      stack->push_back(id);
      for (const auto& dep : it->second->requires_) visit(dep.id);
      stack->pop_back();
      marker = State::kDone;
      order->push_back(id);
    }
  };

  Visitor visitor{&state, &stack, &result.order, &result.cycles, &by_id};
  for (const auto& [id, manifest] : by_id) {
    (void)manifest;
    visitor.visit(id);
  }

  if (!result.cycles.empty()) {
    result.order.clear();
    std::sort(result.cycles.begin(), result.cycles.end());
  }
  return result;
}

}  // namespace logicpilot::contracts

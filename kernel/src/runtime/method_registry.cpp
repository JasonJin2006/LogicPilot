// MethodRegistry implementation (see method_registry.h).
#include "logicpilot/runtime/method_registry.h"

#include <utility>

#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {

MethodRegistry& MethodRegistry::instance() {
  static MethodRegistry registry;
  return registry;
}

void MethodRegistry::register_method(std::string method, Factory factory) {
  for (const Entry& entry : entries_) {
    if (entry.method == method) {
      return;  // idempotent: first registration wins
    }
  }
  entries_.push_back(Entry{std::move(method), std::move(factory)});
}

std::unique_ptr<SimulationMethod> MethodRegistry::create(
    const std::string& method) const {
  for (const Entry& entry : entries_) {
    if (entry.method == method) {
      return entry.factory();
    }
  }
  return nullptr;
}

bool MethodRegistry::contains(const std::string& method) const {
  for (const Entry& entry : entries_) {
    if (entry.method == method) {
      return true;
    }
  }
  return false;
}

std::vector<std::string> MethodRegistry::methods() const {
  std::vector<std::string> out;
  out.reserve(entries_.size());
  for (const Entry& entry : entries_) {
    out.push_back(entry.method);
  }
  return out;
}

}  // namespace logicpilot

// Built-in model registry implementation.
#include "builtin_registry.h"

#include "logicpilot/devs/mm1.h"

namespace logicpilot::cli {

BuiltinModelRegistry& BuiltinModelRegistry::instance() {
  static BuiltinModelRegistry registry;
  return registry;
}

void BuiltinModelRegistry::add(std::string name, Factory factory) {
  for (const Entry& entry : entries_) {
    if (entry.name == name) {
      return;  // idempotent
    }
  }
  entries_.push_back(Entry{std::move(name), std::move(factory)});
}

std::unique_ptr<ReplicationModel> BuiltinModelRegistry::create(
    const std::string& name, const ModelBuildParams& params) const {
  for (const Entry& entry : entries_) {
    if (entry.name == name) {
      return entry.factory(params);
    }
  }
  return nullptr;
}

std::vector<std::string> BuiltinModelRegistry::names() const {
  std::vector<std::string> out;
  out.reserve(entries_.size());
  for (const Entry& entry : entries_) {
    out.push_back(entry.name);
  }
  return out;
}

bool BuiltinModelRegistry::contains(const std::string& name) const {
  for (const Entry& entry : entries_) {
    if (entry.name == name) {
      return true;
    }
  }
  return false;
}

void register_builtin_models() {
  BuiltinModelRegistry::instance().add(
      "mm1", [](const ModelBuildParams& params) {
        return std::make_unique<Mm1Simulator>(
            Mm1Params{params.lambda, params.mu});
      });
}

}  // namespace logicpilot::cli

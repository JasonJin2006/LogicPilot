// MethodRegistry implementation (see method_registry.h).
#include "logicpilot/runtime/method_registry.h"

#include <utility>

#include "logicpilot/runtime/method_plugin_manifest.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {

MethodRegistry& MethodRegistry::instance() {
  static MethodRegistry registry;
  return registry;
}

void MethodRegistry::register_method(std::string method, Factory factory, Descriptor descriptor) {
  for (const Entry& entry : entries_) {
    if (entry.method == method) {
      return;  // idempotent: first registration wins
    }
  }
  entries_.push_back(Entry{std::move(method), std::move(factory), std::move(descriptor)});
}

bool MethodRegistry::register_manifest(const MethodPluginManifest& manifest, Factory factory,
                                       std::string* error) {
  if (!factory) {
    if (error != nullptr)
      *error = "MP1013: plugin factory is empty";
    return false;
  }
  if (contains(manifest.method)) {
    if (error != nullptr) {
      *error = "MP1014: method '" + manifest.method + "' is already registered";
    }
    return false;
  }
  std::unique_ptr<SimulationMethod> probe = factory();
  if (probe == nullptr || probe->method_name() != manifest.method) {
    if (error != nullptr) {
      *error = "MP1015: factory method identity does not match manifest method '" +
               manifest.method + "'";
    }
    return false;
  }
  register_method(manifest.method, std::move(factory),
                  Descriptor{manifest.runtime_version, manifest.semantics_versions});
  return true;
}

std::unique_ptr<SimulationMethod> MethodRegistry::create(const std::string& method) const {
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

const MethodRegistry::Descriptor* MethodRegistry::descriptor(const std::string& method) const {
  for (const Entry& entry : entries_) {
    if (entry.method == method)
      return &entry.descriptor;
  }
  return nullptr;
}

bool MethodRegistry::supports_semantics_version(const std::string& method,
                                                const std::string& version) const {
  // Empty is the pre-versioning IR spelling and remains compatible.
  if (version.empty())
    return contains(method);
  const Descriptor* info = descriptor(method);
  if (info == nullptr)
    return false;
  for (const std::string& supported : info->semantics_versions) {
    if (supported == version)
      return true;
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

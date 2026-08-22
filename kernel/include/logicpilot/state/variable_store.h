// Shared state across method runtimes (kernel/state, Method Runtime spec).
//
// A multi-method model connects its methods through shared variables: a
// ProcessRuntime may `inventory += produced`, an AgentRuntime may
// `inventory -= consumed`, and a SystemDynamics runtime may integrate
// `dInventory/dt = input - output`. The kernel owns the store; every method
// runtime reads/writes through the RuntimeContext it receives at
// initialize().
#pragma once

#include <algorithm>
#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

namespace logicpilot {

using VariableValue = std::variant<bool, std::int64_t, double, std::string>;

struct VariableDeclaration {
  std::string owner;
  std::string unit;
  std::vector<std::string> readers;
  std::vector<std::string> writers;

  bool operator==(const VariableDeclaration&) const = default;
};

class VariableStore {
 public:
  // Declarations are replication-scoped metadata. Re-declaring the same
  // variable with identical metadata is idempotent; conflicting declarations
  // are rejected before a value can be written.
  bool declare(std::string_view name, VariableDeclaration declaration) {
    if (name.empty() || declaration.owner.empty() ||
        declaration.writers.empty()) {
      return false;
    }
    const std::string key{name};
    const auto it = declarations_.find(key);
    if (it != declarations_.end()) return it->second == declaration;
    declarations_.emplace(key, std::move(declaration));
    return true;
  }

  [[nodiscard]] const VariableDeclaration* declaration(
      std::string_view name) const {
    const auto it = declarations_.find(std::string(name));
    return it == declarations_.end() ? nullptr : &it->second;
  }

  // Method-scoped writes require an explicit declaration and writer grant.
  bool set_by(std::string_view accessor, std::string_view name,
              VariableValue value) {
    const auto* metadata = declaration(name);
    if (metadata == nullptr || !allowed(metadata->writers, accessor)) {
      return false;
    }
    values_[std::string(name)] = std::move(value);
    return true;
  }

  // Method-scoped reads require a reader grant. Host code may continue using
  // get() as an administrative/debug view of the store.
  [[nodiscard]] const VariableValue* get_by(std::string_view accessor,
                                            std::string_view name) const {
    const auto* metadata = declaration(name);
    if (metadata == nullptr || !allowed(metadata->readers, accessor)) {
      return nullptr;
    }
    return get(name);
  }

  void set(std::string_view name, VariableValue value) {
    values_[std::string(name)] = std::move(value);
  }

  // Returns nullptr when the variable is not set.
  [[nodiscard]] const VariableValue* get(std::string_view name) const {
    const auto it = values_.find(std::string(name));
    return it == values_.end() ? nullptr : &it->second;
  }

  [[nodiscard]] bool has(std::string_view name) const {
    return values_.count(std::string(name)) > 0;
  }

  // One replication starts from a clean store.
  void clear() {
    values_.clear();
    declarations_.clear();
  }

  [[nodiscard]] std::size_t size() const { return values_.size(); }

 private:
  static bool allowed(const std::vector<std::string>& grants,
                      std::string_view accessor) {
    return std::find(grants.begin(), grants.end(), accessor) != grants.end();
  }

  std::unordered_map<std::string, VariableValue> values_;
  std::unordered_map<std::string, VariableDeclaration> declarations_;
};

}  // namespace logicpilot

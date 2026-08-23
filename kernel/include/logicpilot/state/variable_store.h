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
#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <optional>
#include <set>
#include <span>
#include <utility>
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

struct VariableSnapshot {
  std::string name;
  VariableDeclaration declaration;
  std::optional<VariableValue> value;
};

class VariableSnapshotMigrationPlan {
 public:
  using Converter = std::function<bool(const VariableValue& source,
                                       VariableValue& target,
                                       std::string* error)>;

  bool rename(std::string source, std::string target) {
    if (source.empty() || target.empty()) return false;
    renames_[std::move(source)] = std::move(target);
    return true;
  }
  bool convert(std::string name, Converter converter) {
    if (name.empty() || !converter) return false;
    converters_[std::move(name)] = std::move(converter);
    return true;
  }

  bool apply(std::span<const VariableSnapshot> source,
             std::vector<VariableSnapshot>& target,
             std::string* error = nullptr) const {
    if (error != nullptr) error->clear();
    target.clear();
    std::set<std::string> names;
    for (const VariableSnapshot& original : source) {
      VariableSnapshot migrated = original;
      if (const auto rename_it = renames_.find(migrated.name);
          rename_it != renames_.end()) {
        migrated.name = rename_it->second;
      }
      if (const auto converter_it = converters_.find(migrated.name);
          converter_it != converters_.end() && migrated.value.has_value()) {
        VariableValue converted;
        std::string conversion_error;
        if (!converter_it->second(*migrated.value, converted,
                                  &conversion_error)) {
          if (error != nullptr) {
            *error = conversion_error.empty() ? "variable value conversion failed"
                                               : conversion_error;
          }
          target.clear();
          return false;
        }
        migrated.value = std::move(converted);
      }
      if (migrated.name.empty() || !names.insert(migrated.name).second) {
        if (error != nullptr) *error = "variable migration name collision";
        target.clear();
        return false;
      }
      target.push_back(std::move(migrated));
    }
    return true;
  }

 private:
  std::map<std::string, std::string> renames_;
  std::map<std::string, Converter> converters_;
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

  [[nodiscard]] std::vector<VariableSnapshot> snapshot() const {
    std::set<std::string> names;
    for (const auto& [name, declaration] : declarations_) names.insert(name);
    for (const auto& [name, value] : values_) names.insert(name);
    std::vector<VariableSnapshot> result;
    result.reserve(names.size());
    for (const std::string& name : names) {
      VariableSnapshot snapshot;
      snapshot.name = name;
      if (const auto declaration = declarations_.find(name);
          declaration != declarations_.end()) {
        snapshot.declaration = declaration->second;
      }
      if (const auto value = values_.find(name); value != values_.end()) {
        snapshot.value = value->second;
      }
      result.push_back(std::move(snapshot));
    }
    return result;
  }

  bool restore(std::span<const VariableSnapshot> snapshots) {
    clear();
    std::set<std::string> names;
    for (const VariableSnapshot& snapshot : snapshots) {
      if (snapshot.name.empty() || !names.insert(snapshot.name).second) {
        clear();
        return false;
      }
      if (!snapshot.declaration.owner.empty() &&
          !declare(snapshot.name, snapshot.declaration)) {
        clear();
        return false;
      }
      if (snapshot.value.has_value()) {
        values_[snapshot.name] = *snapshot.value;
      }
    }
    return true;
  }

 private:
  static bool allowed(const std::vector<std::string>& grants,
                      std::string_view accessor) {
    return std::find(grants.begin(), grants.end(), accessor) != grants.end();
  }

  std::unordered_map<std::string, VariableValue> values_;
  std::unordered_map<std::string, VariableDeclaration> declarations_;
};

}  // namespace logicpilot

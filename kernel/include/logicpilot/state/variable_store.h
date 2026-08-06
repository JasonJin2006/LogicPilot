// Shared state across method runtimes (kernel/state, Method Runtime spec).
//
// A multi-method model connects its methods through shared variables: a
// ProcessRuntime may `inventory += produced`, an AgentRuntime may
// `inventory -= consumed`, and a SystemDynamics runtime may integrate
// `dInventory/dt = input - output`. The kernel owns the store; every method
// runtime reads/writes through the RuntimeContext it receives at
// initialize().
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>

namespace logicpilot {

using VariableValue = std::variant<bool, std::int64_t, double, std::string>;

class VariableStore {
 public:
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
  void clear() { values_.clear(); }

  [[nodiscard]] std::size_t size() const { return values_.size(); }

 private:
  std::unordered_map<std::string, VariableValue> values_;
};

}  // namespace logicpilot

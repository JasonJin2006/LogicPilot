// MethodRegistry - the plugin registry behind the Method Runtime Layer.
//
// The kernel resolves a model's method from its IR (SemanticsRef.library)
// and asks the registry for the corresponding runtime; it never switches on
// method names itself. Third-party methods register a factory under their
// method name and become first-class citizens:
//
//   MethodRegistry::instance().register_method(
//       "traffic", [] { return std::make_unique<TrafficRuntime>(); });
//
// Registration is idempotent: re-registering an existing name keeps the
// first factory (built-in registration is safe to call more than once).
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace logicpilot {

class SimulationMethod;

class MethodRegistry {
 public:
  using Factory = std::function<std::unique_ptr<SimulationMethod>()>;

  static MethodRegistry& instance();

  void register_method(std::string method, Factory factory);
  [[nodiscard]] std::unique_ptr<SimulationMethod> create(
      const std::string& method) const;
  [[nodiscard]] bool contains(const std::string& method) const;
  [[nodiscard]] std::vector<std::string> methods() const;

 private:
  struct Entry {
    std::string method;
    Factory factory;
  };
  std::vector<Entry> entries_;
};

// Registers the kernel-native method runtimes ("devs", "agent", "sd").
// Idempotent; safe to call from any driver or test before lowering.
void register_builtin_methods();

}  // namespace logicpilot

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
struct MethodPluginManifest;

class MethodRegistry {
public:
  using Factory = std::function<std::unique_ptr<SimulationMethod>()>;

  struct Descriptor {
    // Runtime package version is informational today; semantics_versions is
    // enforced against SemanticsRef.version before a model is initialized.
    std::string runtime_version{"1"};
    std::vector<std::string> semantics_versions{"1"};
  };

  static MethodRegistry& instance();

  void register_method(std::string method, Factory factory, Descriptor descriptor = Descriptor{});
  // Validates that a host-resolved factory matches its package manifest and
  // admits it to the same registry as built-ins. Dynamic C-ABI/WASM adapters
  // can supply the factory without changing kernel method discovery.
  bool register_manifest(const MethodPluginManifest& manifest, Factory factory,
                         std::string* error = nullptr);
  [[nodiscard]] std::unique_ptr<SimulationMethod> create(const std::string& method) const;
  [[nodiscard]] bool contains(const std::string& method) const;
  [[nodiscard]] const Descriptor* descriptor(const std::string& method) const;
  [[nodiscard]] bool supports_semantics_version(const std::string& method,
                                                const std::string& version) const;
  [[nodiscard]] std::vector<std::string> methods() const;

private:
  struct Entry {
    std::string method;
    Factory factory;
    Descriptor descriptor;
  };
  std::vector<Entry> entries_;
};

// Registers the kernel-native method runtimes ("devs", "agent", "sd").
// Idempotent; safe to call from any driver or test before lowering.
void register_builtin_methods();

}  // namespace logicpilot

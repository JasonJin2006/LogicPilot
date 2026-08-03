// lpcli built-in model registry.
//
// Maps "built-in:<name>" identifiers to executable replication models.
// Registration happens once at startup (register_builtin_models()); Phase 2
// adds the compile subcommand without touching this registry.
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/replication.h"

namespace logicpilot::cli {

// Parameters a built-in factory may consume (unused fields keep defaults).
struct ModelBuildParams {
  double lambda{0.8};
  double mu{1.0};
};

class BuiltinModelRegistry {
 public:
  using Factory =
      std::function<std::unique_ptr<ReplicationModel>(const ModelBuildParams&)>;

  static BuiltinModelRegistry& instance();

  void add(std::string name, Factory factory);
  [[nodiscard]] std::unique_ptr<ReplicationModel> create(
      const std::string& name, const ModelBuildParams& params) const;
  [[nodiscard]] std::vector<std::string> names() const;
  [[nodiscard]] bool contains(const std::string& name) const;

 private:
  struct Entry {
    std::string name;
    Factory factory;
  };
  std::vector<Entry> entries_;
};

// Registers the Phase 1b built-ins ("mm1"). Idempotent.
void register_builtin_models();

// Prefix used on the command line: --model built-in:mm1
inline constexpr const char* kBuiltinPrefix = "built-in:";

}  // namespace logicpilot::cli

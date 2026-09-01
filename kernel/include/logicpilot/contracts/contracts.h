// Phase 1 platform contracts: hand-written utilities layered on top of the
// generated types. The generated header stays the only type authority; this
// file only implements version gates and dependency resolution.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/contracts/contracts_generated.h"

namespace logicpilot::contracts {

// Plugin API versions this build of the platform understands. Bumping is a
// breaking contract change and must be accompanied by a baseline refresh
// (schemas/contracts/baseline + scripts/check-contract-conform.mjs).
[[nodiscard]] bool is_supported_plugin_api_version(std::int64_t version);

struct ActivationOrderResult {
  std::vector<std::string> order;    // dependencies before dependents
  std::vector<std::string> missing;  // "dependent -> missing-required"
  std::vector<std::string> cycles;   // "a -> b -> a"

  [[nodiscard]] bool ok() const { return missing.empty() && cycles.empty(); }
};

// Deterministic activation ordering (stable by plugin id). Rejects missing
// non-optional dependencies and dependency cycles before any activation.
[[nodiscard]] ActivationOrderResult resolve_activation_order(
    const std::vector<PluginManifest>& manifests);

}  // namespace logicpilot::contracts

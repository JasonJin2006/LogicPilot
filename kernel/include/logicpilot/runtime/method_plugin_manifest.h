// Portable discovery metadata for an installable modeling-method runtime.
//
// The manifest deliberately does not expose C++ class layouts. `runtime.kind`
// selects a host adapter (linked today; stable C ABI and WASM adapters can be
// added without changing the manifest or the kernel registry contract).
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace logicpilot {

enum class PluginRuntimeKind : std::uint8_t {
  kLinked,
  kCAbi,
  kWasm,
};

struct MethodPluginManifest {
  std::string package;
  std::string method;
  std::string runtime_version;
  std::vector<std::string> semantics_versions;
  PluginRuntimeKind runtime_kind{PluginRuntimeKind::kLinked};
  std::string entrypoint;
  std::string artifact;
  std::vector<std::string> dsl_libraries;
};

struct MethodPluginManifestResult {
  MethodPluginManifest manifest;
  std::string error;

  [[nodiscard]] bool ok() const { return error.empty(); }
};

// Parses and validates the version-1 JSON manifest. Unknown fields are
// accepted so append-only metadata remains forward compatible.
[[nodiscard]] MethodPluginManifestResult parse_method_plugin_manifest(std::string_view json);

// Convenience filesystem boundary used by launchers and package scanners.
[[nodiscard]] MethodPluginManifestResult load_method_plugin_manifest(const std::string& path);

}  // namespace logicpilot

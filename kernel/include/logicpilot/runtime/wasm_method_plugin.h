#pragma once

#include <filesystem>
#include <string>

#include "logicpilot/runtime/method_plugin_manifest.h"

namespace logicpilot {

class MethodRegistry;

// Loads a sandboxed WebAssembly method plugin. The implementation uses
// Wasmtime when LogicPilot is configured with LOGICPILOT_WASMTIME_ROOT.
bool load_wasm_method_plugin(const MethodPluginManifest& manifest,
                             const std::filesystem::path& manifest_directory,
                             MethodRegistry& registry, std::string* error = nullptr);

[[nodiscard]] bool wasm_method_host_available();

}  // namespace logicpilot

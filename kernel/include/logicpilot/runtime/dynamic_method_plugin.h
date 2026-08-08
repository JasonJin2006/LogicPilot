#pragma once

#include <filesystem>
#include <string>

#include "logicpilot/runtime/method_plugin_manifest.h"

namespace logicpilot {

class MethodRegistry;

// Loads a native plugin artifact, validates its stable C ABI and registers a
// factory. Relative artifact paths resolve against `manifest_directory`.
// The library remains resident for as long as the registered factory exists.
bool load_dynamic_method_plugin(const MethodPluginManifest& manifest,
                                const std::filesystem::path& manifest_directory,
                                MethodRegistry& registry, std::string* error = nullptr);

}  // namespace logicpilot

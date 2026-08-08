#include "logicpilot/runtime/method_plugin_manifest.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iterator>
#include <nlohmann/json.hpp>
#include <unordered_set>
#include <utility>

namespace logicpilot {
namespace {

MethodPluginManifestResult fail(std::string message) {
  MethodPluginManifestResult result;
  result.error = std::move(message);
  return result;
}

bool valid_identifier(std::string_view value) {
  if (value.empty())
    return false;
  if (std::islower(static_cast<unsigned char>(value.front())) == 0 &&
      std::isdigit(static_cast<unsigned char>(value.front())) == 0) {
    return false;
  }
  return std::all_of(value.begin() + 1, value.end(), [](unsigned char c) {
    return std::islower(c) != 0 || std::isdigit(c) != 0 || c == '-' || c == '_' || c == '.';
  });
}

bool read_required_string(const nlohmann::json& object, const char* field, std::string* out,
                          std::string* error) {
  const auto it = object.find(field);
  if (it == object.end() || !it->is_string() || it->get_ref<const std::string&>().empty()) {
    *error = std::string("MP1002: '") + field + "' must be a non-empty string";
    return false;
  }
  *out = it->get<std::string>();
  return true;
}

}  // namespace

MethodPluginManifestResult parse_method_plugin_manifest(std::string_view text) {
  nlohmann::json root;
  try {
    root = nlohmann::json::parse(text);
  } catch (const nlohmann::json::parse_error& error) {
    return fail("MP1001: invalid JSON: " + std::string(error.what()));
  }
  if (!root.is_object())
    return fail("MP1001: manifest root must be an object");
  const auto schema = root.find("schema");
  const auto schema_version = root.find("schemaVersion");
  if (schema == root.end() || !schema->is_string() || *schema != "logicpilot.method-plugin" ||
      schema_version == root.end() || !schema_version->is_number_integer() ||
      *schema_version != 1) {
    return fail("MP1003: expected logicpilot.method-plugin schema version 1");
  }

  MethodPluginManifestResult result;
  auto& manifest = result.manifest;
  if (!read_required_string(root, "package", &manifest.package, &result.error) ||
      !read_required_string(root, "method", &manifest.method, &result.error) ||
      !read_required_string(root, "runtimeVersion", &manifest.runtime_version, &result.error)) {
    return result;
  }
  if (!valid_identifier(manifest.package) || !valid_identifier(manifest.method)) {
    return fail("MP1004: package and method must use lowercase identifier characters");
  }

  const auto versions = root.find("semanticsVersions");
  if (versions == root.end() || !versions->is_array() || versions->empty()) {
    return fail("MP1005: semanticsVersions must be a non-empty string array");
  }
  std::unordered_set<std::string> seen_versions;
  for (const auto& version : *versions) {
    if (!version.is_string() || version.get_ref<const std::string&>().empty()) {
      return fail("MP1005: semanticsVersions must contain non-empty strings");
    }
    std::string value = version.get<std::string>();
    if (!seen_versions.insert(value).second) {
      return fail("MP1006: duplicate semantics version '" + value + "'");
    }
    manifest.semantics_versions.push_back(std::move(value));
  }

  const auto runtime = root.find("runtime");
  if (runtime == root.end() || !runtime->is_object()) {
    return fail("MP1007: runtime must be an object");
  }
  std::string kind;
  if (!read_required_string(*runtime, "kind", &kind, &result.error) ||
      !read_required_string(*runtime, "entrypoint", &manifest.entrypoint, &result.error)) {
    return result;
  }
  if (kind == "linked") {
    manifest.runtime_kind = PluginRuntimeKind::kLinked;
  } else if (kind == "c-abi") {
    manifest.runtime_kind = PluginRuntimeKind::kCAbi;
  } else if (kind == "wasm") {
    manifest.runtime_kind = PluginRuntimeKind::kWasm;
  } else {
    return fail("MP1008: runtime.kind must be linked, c-abi, or wasm");
  }
  if (const auto artifact = runtime->find("artifact"); artifact != runtime->end()) {
    if (!artifact->is_string())
      return fail("MP1009: runtime.artifact must be a string");
    manifest.artifact = artifact->get<std::string>();
  }
  if (manifest.runtime_kind != PluginRuntimeKind::kLinked && manifest.artifact.empty()) {
    return fail("MP1010: c-abi and wasm runtimes require runtime.artifact");
  }

  if (const auto libraries = root.find("dslLibraries"); libraries != root.end()) {
    if (!libraries->is_array())
      return fail("MP1011: dslLibraries must be an array");
    for (const auto& library : *libraries) {
      if (!library.is_string() || library.get_ref<const std::string&>().empty()) {
        return fail("MP1011: dslLibraries must contain non-empty strings");
      }
      manifest.dsl_libraries.push_back(library.get<std::string>());
    }
  }
  return result;
}

MethodPluginManifestResult load_method_plugin_manifest(const std::string& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input)
    return fail("MP1012: cannot open method plugin manifest '" + path + "'");
  const std::string text{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
  return parse_method_plugin_manifest(text);
}

}  // namespace logicpilot

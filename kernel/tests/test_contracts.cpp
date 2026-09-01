// Phase 1 contract gates, C++ side: round-trip, unknown field rejection,
// version checks and dependency cycles against the generated contract types.
#include <catch2/catch_test_macros.hpp>

#include <string>

#include "logicpilot/contracts/contracts.h"

namespace {

using namespace logicpilot::contracts;

const char* kValidManifest = R"JSON({
  "schema": "logicpilot.plugin-manifest/v2",
  "contractVersion": 1,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "apiVersion": 1,
  "provides": ["paradigm.process"],
  "requires": [{"id": "logicpilot.graph2d"}],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t0"}
})JSON";

const char* kValidLockfile = R"JSON({
  "schema": "logicpilot.plugin-lock/v1",
  "contractVersion": 1,
  "plugins": [
    {
      "id": "logicpilot.process",
      "version": "1.0.0",
      "apiVersion": 1,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "source": "builtin",
      "trust": "t0",
      "permissions": [{"permissionId": "knowledge.draft.write", "granted": true}]
    }
  ]
})JSON";

PluginManifest parse_manifest_or_fail(const std::string& text) {
  PluginManifest manifest;
  std::string error;
  REQUIRE(parse(text, manifest, error));
  return manifest;
}

}  // namespace

TEST_CASE("contract round-trip preserves the manifest", "[contracts]") {
  auto manifest = parse_manifest_or_fail(kValidManifest);

  CHECK(manifest.id == "logicpilot.process");
  CHECK(manifest.api_version == 1);
  CHECK(manifest.trust.min_level == TrustLevel::kT0);
  REQUIRE(manifest.requires_.size() == 1);
  CHECK(manifest.requires_[0].id == "logicpilot.graph2d");
  CHECK_FALSE(manifest.requires_[0].optional.has_value());

  const auto dumped = dump(manifest);
  auto reparsed = parse_manifest_or_fail(dumped);
  CHECK(reparsed == manifest);
  CHECK(dump(reparsed) == dumped);
}

TEST_CASE("contract round-trip covers lockfiles with nested entries", "[contracts]") {
  PluginLockfile lockfile;
  std::string error;
  REQUIRE(parse(kValidLockfile, lockfile, error));

  const auto dumped = dump(lockfile);
  PluginLockfile reparsed;
  REQUIRE(parse(dumped, reparsed, error));
  CHECK(reparsed == lockfile);
  CHECK(dump(reparsed) == dumped);
  REQUIRE(reparsed.plugins.size() == 1);
  CHECK(reparsed.plugins[0].trust == TrustLevel::kT0);
  REQUIRE(reparsed.plugins[0].permissions.size() == 1);
  CHECK(reparsed.plugins[0].permissions[0].permission_id == PermissionId::kKnowledgeDraftWrite);
}

TEST_CASE("unknown fields are rejected", "[contracts]") {
  PluginManifest manifest;
  std::string error;
  const char* bad = R"JSON({
  "schema": "logicpilot.plugin-manifest/v2",
  "contractVersion": 1,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "apiVersion": 1,
  "unknownFutureField": true,
  "provides": ["paradigm.process"],
  "requires": [{"id": "logicpilot.graph2d"}],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t0"}
})JSON";
  REQUIRE_FALSE(parse(std::string(bad), manifest, error));
  CHECK(error.find("unknown field") != std::string::npos);
  CHECK(error.find("unknownFutureField") != std::string::npos);
}

TEST_CASE("const version fields are enforced", "[contracts]") {
  PluginManifest manifest;
  std::string error;

  SECTION("schema identifier mismatch is rejected") {
    const char* bad = R"JSON({
  "schema": "logicpilot.plugin-manifest/v3",
  "contractVersion": 1,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "apiVersion": 1,
  "provides": ["paradigm.process"],
  "requires": [],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t0"}
})JSON";
    REQUIRE_FALSE(parse(std::string(bad), manifest, error));
    CHECK(error.find("expected constant") != std::string::npos);
  }

  SECTION("contractVersion bump is rejected") {
    const char* bad = R"JSON({
  "schema": "logicpilot.plugin-manifest/v2",
  "contractVersion": 2,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "apiVersion": 1,
  "provides": ["paradigm.process"],
  "requires": [],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t0"}
})JSON";
    REQUIRE_FALSE(parse(std::string(bad), manifest, error));
    CHECK(error.find("expected constant") != std::string::npos);
  }

  SECTION("invalid enum values are rejected") {
    const char* bad = R"JSON({
  "schema": "logicpilot.plugin-manifest/v2",
  "contractVersion": 1,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "apiVersion": 1,
  "provides": ["paradigm.process"],
  "requires": [],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t9"}
})JSON";
    REQUIRE_FALSE(parse(std::string(bad), manifest, error));
    CHECK(error.find("TrustLevel") != std::string::npos);
  }

  SECTION("missing required fields are rejected") {
    const char* bad = R"JSON({
  "schema": "logicpilot.plugin-manifest/v2",
  "contractVersion": 1,
  "id": "logicpilot.process",
  "version": "1.0.0",
  "provides": ["paradigm.process"],
  "requires": [],
  "entrypoints": {"data": "plugins/process/"},
  "permissions": ["knowledge.draft.write"],
  "trust": {"minLevel": "t0"}
})JSON";
    REQUIRE_FALSE(parse(std::string(bad), manifest, error));
    CHECK(error.find("apiVersion") != std::string::npos);
  }
}

TEST_CASE("unsupported plugin apiVersion is rejected by the host gate", "[contracts]") {
  CHECK(is_supported_plugin_api_version(1));
  CHECK_FALSE(is_supported_plugin_api_version(2));
  CHECK_FALSE(is_supported_plugin_api_version(0));
}

TEST_CASE("activation order places dependencies first", "[contracts]") {
  auto graph2d = parse_manifest_or_fail(kValidManifest);
  graph2d.id = "logicpilot.graph2d";
  graph2d.requires_.clear();

  auto process = parse_manifest_or_fail(kValidManifest);
  process.id = "logicpilot.process";

  auto sysml = parse_manifest_or_fail(kValidManifest);
  sysml.id = "logicpilot.sysml";
  sysml.requires_.clear();
  PluginDependency edge;
  edge.id = "logicpilot.graph2d";
  sysml.requires_.push_back(edge);

  const auto result = resolve_activation_order({sysml, process, graph2d});
  REQUIRE(result.ok());
  REQUIRE(result.order.size() == 3);
  CHECK(result.order[0] == "logicpilot.graph2d");
  CHECK(result.order[1] == "logicpilot.process");
  CHECK(result.order[2] == "logicpilot.sysml");
}

TEST_CASE("dependency cycles are detected", "[contracts]") {
  auto a = parse_manifest_or_fail(kValidManifest);
  a.id = "logicpilot.a";
  a.requires_.clear();
  PluginDependency a_edge;
  a_edge.id = "logicpilot.b";
  a.requires_.push_back(a_edge);

  auto b = parse_manifest_or_fail(kValidManifest);
  b.id = "logicpilot.b";
  b.requires_.clear();
  PluginDependency b_edge;
  b_edge.id = "logicpilot.a";
  b.requires_.push_back(b_edge);

  const auto result = resolve_activation_order({a, b});
  REQUIRE_FALSE(result.ok());
  REQUIRE(result.cycles.size() == 1);
  CHECK(result.cycles[0].find("logicpilot.a") != std::string::npos);
  CHECK(result.cycles[0].find("logicpilot.b") != std::string::npos);
}

TEST_CASE("missing non-optional dependencies are reported, optional ones skipped", "[contracts]") {
  auto plugin = parse_manifest_or_fail(kValidManifest);
  plugin.id = "logicpilot.c";
  plugin.requires_.clear();
  PluginDependency missing_dep;
  missing_dep.id = "logicpilot.ghost";
  plugin.requires_.push_back(missing_dep);
  PluginDependency optional_dep;
  optional_dep.id = "logicpilot.also-ghost";
  optional_dep.optional = true;
  plugin.requires_.push_back(optional_dep);

  const auto result = resolve_activation_order({plugin});
  REQUIRE_FALSE(result.ok());
  REQUIRE(result.missing.size() == 1);
  CHECK(result.missing[0] == "logicpilot.c -> logicpilot.ghost");
}

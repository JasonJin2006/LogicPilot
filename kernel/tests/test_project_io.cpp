// Unit tests for the *.lpproj bundle reader (kernel/apps/lpcli/project_io.h).
#include <catch2/catch_test_macros.hpp>

#include "../apps/lpcli/project_io.h"

namespace {

using logicpilot::cli::ProjectBundleInfo;
using logicpilot::cli::read_project_bundle;

}  // namespace

TEST_CASE("project bundle: extracts manifest name and model source") {
  // The DSL newlines are JSON-escaped (\n), as the IDE's bundle writer
  // (JSON.stringify) produces.
  const std::string bundle =
      "{\n"
      "  \"schema\": \"logicpilot.project\",\n"
      "  \"format\": \"bundle\",\n"
      "  \"version\": 1,\n"
      "  \"manifest\": {\n"
      "    \"name\": \"MM1\",\n"
      "    \"model\": \"model/main.lp\",\n"
      "    \"presentation\": \"presentation/main.canvas.json\",\n"
      "    \"defaultExperiment\": null,\n"
      "    \"defaults\": { \"seed\": 42, \"schemaVersion\": 2 }\n"
      "  },\n"
      "  \"files\": {\n"
      "    \"model/main.lp\": \"model MM1 {\\n  use process\\n  param "
      "arrival_rate: float = 0.8\\n}\\n\",\n"
      "    \"presentation/main.canvas.json\": \"{\\\"name\\\":\\\"MM1\\\"}\"\n"
      "  }\n"
      "}";

  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_bundle(bundle, info, error));
  CHECK(info.name == "MM1");
  CHECK(info.model_path == "model/main.lp");
  CHECK(info.model_source ==
        "model MM1 {\n  use process\n  param arrival_rate: float = 0.8\n}\n");
}

TEST_CASE("project bundle: decodes escaped quotes and backslashes in DSL") {
  // A DSL string literal with an escaped quote and a backslash.
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"format\":\"bundle\","
      "\"version\":1,\"manifest\":{\"name\":\"Q\"},"
      "\"files\":{\"model/main.lp\":\"model Q {\\n  source A { "
      "tag = \\\"a\\\\\\\"b\\\" }\\n}\\n\"}}";

  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_bundle(bundle, info, error));
  CHECK(info.model_source ==
        "model Q {\n  source A { tag = \"a\\\"b\" }\n}\n");
}

TEST_CASE("project bundle: rejects a wrong schema marker") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.something-else\",\"files\":{}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE_FALSE(read_project_bundle(bundle, info, error));
  CHECK(error.find("unsupported project schema") != std::string::npos);
}

TEST_CASE("project bundle: rejects a bundle without a files table") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"manifest\":{\"name\":\"X\"}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE_FALSE(read_project_bundle(bundle, info, error));
  CHECK(error.find("files") != std::string::npos);
}

TEST_CASE("project bundle: rejects a bundle missing the model source") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"manifest\":{\"name\":\"X\"},"
      "\"files\":{\"model/main.lp\":\"\"}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE_FALSE(read_project_bundle(bundle, info, error));
  CHECK(error.find("missing model source") != std::string::npos);
}

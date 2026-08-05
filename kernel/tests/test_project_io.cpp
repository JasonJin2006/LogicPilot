// Unit tests for the *.lpproj bundle reader (kernel/apps/lpcli/project_io.h).
#include <catch2/catch_test_macros.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>

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

TEST_CASE("project bundle: merges model part fragments before compiling") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"format\":\"bundle\",\"version\":1,"
      "\"manifest\":{\"name\":\"M\",\"model\":\"model/main.lp\","
      "\"modelParts\":[\"model/resources.lp\",\"model/process.lp\"],"
      "\"defaults\":{\"seed\":42,\"schemaVersion\":2}},"
      "\"files\":{"
      "\"model/main.lp\":\"model M {\\n}\\n\","
      "\"model/resources.lp\":\"  resource Server {\\n    capacity = 1\\n  }\\n\","
      "\"model/process.lp\":\"  queue Q {\\n      "
      "capacity = 10\\n    }\\n\""
      "}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_bundle(bundle, info, error));
  CHECK(info.model_source.find("model M {") != std::string::npos);
  CHECK(info.model_source.find("resource Server") != std::string::npos);
  CHECK(info.model_source.find("queue Q") != std::string::npos);
  CHECK(info.part_paths.size() == 2);
}

TEST_CASE("project bundle: merge keeps a single-file bundle unchanged") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"manifest\":{\"name\":\"M\","
      "\"model\":\"model/main.lp\"},"
      "\"files\":{\"model/main.lp\":\"model M {\\n  resource R {\\n  }\\n}\\n\"}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_bundle(bundle, info, error));
  CHECK(info.model_source.find("resource R") != std::string::npos);
  CHECK(info.part_paths.empty());
}

TEST_CASE("project dir: reads logicpilot.json, files and merges the parts") {
  const auto dir = std::filesystem::temp_directory_path() /
                   ("lpcli_project_dir_test_" +
                    std::to_string(std::chrono::steady_clock::now()
                                       .time_since_epoch()
                                       .count()));
  std::filesystem::create_directories(dir / "model");
  {
    std::ofstream out(dir / "logicpilot.json");
    out << R"({"schema":"logicpilot.project","name":"MM1",)"
           R"("model":"model/main.lp",)"
           R"("modelParts":["model/resources.lp","model/process.lp"])";
  }
  {
    std::ofstream out(dir / "model/main.lp");
    out << "model MM1 {\n}\n";
  }
  {
    std::ofstream out(dir / "model/resources.lp");
    out << "  resource Server {\n    capacity = 1\n  }\n";
  }
  {
    std::ofstream out(dir / "model/process.lp");
    out << "  queue Q {\n    capacity = 10\n  }\n";
  }

  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_dir(dir.string(), info, error));
  CHECK(info.name == "MM1");
  CHECK(info.model_path == "model/main.lp");
  CHECK(info.model_source.find("model MM1 {") != std::string::npos);
  CHECK(info.model_source.find("resource Server") != std::string::npos);
  CHECK(info.model_source.find("queue Q") != std::string::npos);
  CHECK(info.part_paths.size() == 2);

  std::filesystem::remove_all(dir);
}

TEST_CASE("project bundle: resolves instance members from scene files") {
  const std::string bundle =
      "{\"schema\":\"logicpilot.project\",\"manifest\":{\"name\":\"M\","
      "\"model\":\"model/main.lp\","
      "\"modelParts\":[\"model/resources.lp\"]},"
      "\"files\":{"
      "\"model/main.lp\":\"model M {\\n  instance Drone = \\\"model/scenes/Drone.lp\\\"\\n}\\n\","
      "\"model/resources.lp\":\"  resource Server {\\n    capacity = 1\\n  }\\n\","
      "\"model/scenes/Drone.lp\":\"  agent Drone {\\n    count = 2\\n  }\\n\""
      "}}";
  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_bundle(bundle, info, error));
  CHECK(info.model_source.find("resource Server") != std::string::npos);
  CHECK(info.model_source.find("agent Drone") != std::string::npos);
  CHECK(info.model_source.find("count = 2") != std::string::npos);
  // The instance line itself is expanded away.
  CHECK(info.model_source.find("instance Drone") == std::string::npos);
}

TEST_CASE("project dir: agent-centric layout expands nested containers") {
  // Agent-centric: process blocks live flat in main.lp; nested containers
  // (agent/experiment) are scene files referenced by instance members.
  const auto dir = std::filesystem::temp_directory_path() /
                   ("lpcli_project_v2_test_" +
                    std::to_string(std::chrono::steady_clock::now()
                                       .time_since_epoch()
                                       .count()));
  std::filesystem::create_directories(dir / "model" / "scenes");
  {
    std::ofstream out(dir / "logicpilot.json");
    out << R"({"schema":"logicpilot.project","name":"MM1",)"
           R"("model":"model/main.lp","modelParts":[])";
  }
  {
    std::ofstream out(dir / "model/main.lp");
    out << "model MM1 {\n"
           "  queue Q {\n    capacity = 10\n  }\n"
           "  instance Drone = \"model/scenes/Drone.lp\"\n"
           "  instance Tune = \"model/scenes/Tune.lp\"\n"
           "}\n";
  }
  {
    std::ofstream out(dir / "model/scenes/Drone.lp");
    out << "  agent Drone {\n    count = 2\n  }\n";
  }
  {
    std::ofstream out(dir / "model/scenes/Tune.lp");
    out << "  experiment Tune {\n    budget = 20\n  }\n";
  }

  ProjectBundleInfo info;
  std::string error;
  REQUIRE(read_project_dir(dir.string(), info, error));
  CHECK(info.name == "MM1");
  CHECK(info.part_paths.empty());
  CHECK(info.model_source.find("queue Q") != std::string::npos);
  CHECK(info.model_source.find("agent Drone") != std::string::npos);
  CHECK(info.model_source.find("count = 2") != std::string::npos);
  CHECK(info.model_source.find("experiment Tune") != std::string::npos);
  CHECK(info.model_source.find("instance Drone") == std::string::npos);
}

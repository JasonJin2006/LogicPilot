// Block-shape registry tests: the embedded standard process library
// (libraries/process.lplib) must load and expose the five blocks with the
// expected shapes; LibraryRegistry::load parses arbitrary library sources.
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/dsl/registry.h"

using namespace logicpilot::dsl;

TEST_CASE("registry: embedded process library loads the five blocks",
          "[dsl][registry]") {
  const LibraryRegistry& registry = builtin_process_registry();
  REQUIRE(registry.blocks().size() == 5);
  REQUIRE(registry.has_block("resource"));
  REQUIRE(registry.has_block("source"));
  REQUIRE(registry.has_block("queue"));
  REQUIRE(registry.has_block("service"));
  REQUIRE(registry.has_block("sink"));

  const BlockShape* resource = registry.block("resource");
  REQUIRE(resource != nullptr);
  const BlockParamSpec* capacity = resource->param("capacity");
  REQUIRE(capacity != nullptr);
  REQUIRE(capacity->type == BlockParamType::kInt);
  REQUIRE(capacity->required);
  const BlockParamSpec* failure_rate = resource->param("failure_rate");
  REQUIRE(failure_rate != nullptr);
  REQUIRE(failure_rate->type == BlockParamType::kFloat);
  REQUIRE(!failure_rate->required);

  const BlockShape* service = registry.block("service");
  REQUIRE(service->param("resource")->type == BlockParamType::kRef);
  REQUIRE(!service->param("resource")->required);
  REQUIRE(service->param("time")->type == BlockParamType::kDistribution);
  REQUIRE(service->param("time")->required);

  REQUIRE(registry.block("source")->param("arrival")->required);
  REQUIRE(registry.block("queue")->param("capacity")->required);
  REQUIRE(registry.block("sink")->params.empty());
}

TEST_CASE("registry: load parses a library source into shapes",
          "[dsl][registry]") {
  LibraryRegistry registry;
  std::vector<Diagnostic> diagnostics;
  const std::string source =
      "library test {\n"
      "  block widget {\n"
      "    width: int\n"
      "    label: string = \"x\"\n"
      "  }\n"
      "}\n";
  REQUIRE(registry.load(source, &diagnostics));
  REQUIRE(diagnostics.empty());
  REQUIRE(registry.has_block("widget"));
  const BlockShape* widget = registry.block("widget");
  REQUIRE(widget->params.size() == 2);
  REQUIRE(widget->param("width")->required);
  REQUIRE(widget->param("width")->type == BlockParamType::kInt);
  REQUIRE(!widget->param("label")->required);
  REQUIRE(widget->param("label")->type == BlockParamType::kString);
}

TEST_CASE("registry: malformed library source fails to load",
          "[dsl][registry]") {
  LibraryRegistry registry;
  std::vector<Diagnostic> diagnostics;
  REQUIRE_FALSE(registry.load("library broken { block { } }", &diagnostics));
  REQUIRE(!diagnostics.empty());
}

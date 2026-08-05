// Block-shape registry tests: the embedded standard process library
// (libraries/process.lplib, generated from libraries/pml-catalog.json) must
// load and expose all 23 blocks with the expected shapes; LibraryRegistry
// parses ports (with `when` conditions) and typed params.
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/dsl/registry.h"

using namespace logicpilot::dsl;

TEST_CASE("registry: embedded process library loads the 23 blocks",
          "[dsl][registry]") {
  const LibraryRegistry& registry = builtin_process_registry();
  REQUIRE(registry.blocks().size() == 23);
  for (const char* kind : {"resource", "source", "queue", "delay", "service",
                           "split", "combine", "batch", "unbatch", "seize",
                           "release", "wait", "hold", "match", "selectOutput",
                           "enter", "exit", "moveTo", "timeMeasureStart",
                           "timeMeasureEnd", "assembler", "count", "sink"}) {
    REQUIRE(registry.has_block(kind));
  }

  const BlockShape* resource = registry.block("resource");
  REQUIRE(resource != nullptr);
  const BlockParamSpec* capacity = resource->param("capacity");
  REQUIRE(capacity != nullptr);
  REQUIRE(capacity->type == BlockParamType::kInt);
  REQUIRE(!capacity->required);  // catalog default 1
  const BlockParamSpec* failure_rate = resource->param("failure_rate");
  REQUIRE(failure_rate != nullptr);
  REQUIRE(failure_rate->type == BlockParamType::kFloat);
  REQUIRE(!failure_rate->required);
  REQUIRE(resource->ports.empty());  // ResourcePool has no ports

  const BlockShape* service = registry.block("service");
  REQUIRE(service->param("resource")->type == BlockParamType::kRef);
  REQUIRE(!service->param("resource")->required);
  REQUIRE(service->param("time")->type == BlockParamType::kDistribution);
  REQUIRE(!service->param("time")->required);
  REQUIRE(service->ports.size() == 4);
  REQUIRE(service->port("in")->direction == "in");
  REQUIRE(service->port("out")->direction == "out");
  REQUIRE(service->port("outTimeout")->condition == "enableTimeout");
  REQUIRE(service->port("outPreempted")->condition == "enablePreemption");

  const BlockShape* source = registry.block("source");
  REQUIRE(source->param("arrival")->type == BlockParamType::kDistribution);
  REQUIRE(!source->param("arrival")->required);
  REQUIRE(source->ports.size() == 1);
  REQUIRE(source->port("out")->direction == "out");

  const BlockShape* queue = registry.block("queue");
  REQUIRE(queue->param("capacity")->type == BlockParamType::kInt);
  REQUIRE(!queue->param("capacity")->required);
  REQUIRE(queue->ports.size() == 4);
  REQUIRE(queue->port("outTimeout")->condition == "enableTimeout");
  REQUIRE(queue->port("outPreempted")->condition == "enablePreemption");

  const BlockShape* select_output = registry.block("selectOutput");
  REQUIRE(select_output->port("in")->direction == "in");
  REQUIRE(select_output->port("outT")->direction == "out");
  REQUIRE(select_output->port("outF")->direction == "out");

  const BlockShape* sink = registry.block("sink");
  REQUIRE(sink->ports.size() == 1);
  REQUIRE(sink->port("in")->direction == "in");
  REQUIRE_FALSE(sink->has_output_ports());
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

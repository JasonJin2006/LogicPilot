// Block-shape registry tests: the embedded standard process library
// (libraries/process.lplib, generated from libraries/pml-catalog.json) must
// load and expose all 26 blocks with the expected shapes; LibraryRegistry
// parses ports (with `when` conditions) and typed params.
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "logicpilot/dsl/registry.h"

using namespace logicpilot::dsl;

TEST_CASE("registry: embedded process library loads the 26 blocks", "[dsl][registry]") {
  const LibraryRegistry& registry = builtin_process_registry();
  REQUIRE(registry.blocks().size() == 26);
  for (const char* kind : {"resource",
                           "source",
                           "queue",
                           "delay",
                           "service",
                           "split",
                           "combine",
                           "batch",
                           "unbatch",
                           "seize",
                           "release",
                           "wait",
                           "hold",
                           "match",
                           "selectOutput",
                           "selectOutput5",
                           "selectOutputOut",
                           "selectOutputIn",
                           "enter",
                           "exit",
                           "moveTo",
                           "timeMeasureStart",
                           "timeMeasureEnd",
                           "assembler",
                           "count",
                           "sink"}) {
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

  const BlockShape* select_output5 = registry.block("selectOutput5");
  REQUIRE(select_output5->port("in")->direction == "in");
  REQUIRE(select_output5->ports.size() == 6);
  REQUIRE(select_output5->port("out5")->direction == "out");
  REQUIRE(select_output5->param("type")->type == BlockParamType::kString);
  REQUIRE(select_output5->param("condition1")->type == BlockParamType::kExpression);
  REQUIRE(select_output5->param("exitNumber")->type == BlockParamType::kExpression);

  const BlockShape* select_output_in = registry.block("selectOutputIn");
  REQUIRE(select_output_in->ports.size() == 1);
  REQUIRE(select_output_in->port("in")->direction == "in");
  REQUIRE_FALSE(select_output_in->has_output_ports());
  REQUIRE(select_output_in->param("conditionIsProbabilistic")->type == BlockParamType::kBool);
  REQUIRE(select_output_in->param("choice")->type == BlockParamType::kExpression);

  const BlockShape* select_output_out = registry.block("selectOutputOut");
  REQUIRE(select_output_out->ports.size() == 1);
  REQUIRE(select_output_out->port("out")->direction == "out");
  REQUIRE_FALSE(select_output_out->has_input_ports());
  REQUIRE(select_output_out->param("selectOutputIn")->type == BlockParamType::kRef);
  REQUIRE(select_output_out->param("probability")->type == BlockParamType::kFloat);

  const BlockShape* sink = registry.block("sink");
  REQUIRE(sink->ports.size() == 1);
  REQUIRE(sink->port("in")->direction == "in");
  REQUIRE_FALSE(sink->has_output_ports());
}

TEST_CASE("registry: load parses a library source into shapes", "[dsl][registry]") {
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
  REQUIRE(widget->library == "test");
  REQUIRE(widget->library_version == 1);
  REQUIRE(widget->params.size() == 2);
  REQUIRE(widget->param("width")->required);
  REQUIRE(widget->param("width")->type == BlockParamType::kInt);
  REQUIRE(!widget->param("label")->required);
  REQUIRE(widget->param("label")->type == BlockParamType::kString);
}

TEST_CASE("registry: duplicate short names require a qualified lookup", "[dsl][registry]") {
  LibraryRegistry registry;
  std::vector<Diagnostic> diagnostics;
  REQUIRE(registry.load("library alpha { block shared { } }", &diagnostics));
  REQUIRE(registry.merge("library beta { block shared { } }", &diagnostics));
  REQUIRE(diagnostics.empty());
  REQUIRE(registry.is_ambiguous("shared"));
  REQUIRE(registry.block("shared") == nullptr);
  REQUIRE(registry.block("alpha::shared")->library == "alpha");
  REQUIRE(registry.block("beta::shared")->library == "beta");
}

TEST_CASE("registry: duplicate qualified identity is rejected", "[dsl][registry]") {
  LibraryRegistry registry;
  std::vector<Diagnostic> diagnostics;
  REQUIRE(registry.load("library alpha { block shared { } }", &diagnostics));
  REQUIRE_FALSE(registry.merge("library alpha { block shared { } }", &diagnostics));
  REQUIRE(diagnostics.size() == 1);
  REQUIRE(diagnostics.front().code == "LP2012");
}

TEST_CASE("registry: malformed library source fails to load", "[dsl][registry]") {
  LibraryRegistry registry;
  std::vector<Diagnostic> diagnostics;
  REQUIRE_FALSE(registry.load("library broken { block { } }", &diagnostics));
  REQUIRE(!diagnostics.empty());
}

// Parser front-end tests: clean parse of the canonical example, generic
// Node extraction, and syntax-error diagnostics.
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/dsl/ast.h"
#include "logicpilot/dsl/parser.h"
#include "expect_json.h"  // read_text_file (shared test utility)

using namespace logicpilot::dsl;

namespace {

constexpr const char* kMm1Path = LOGICPILOT_EXAMPLES_DIR "/mm1.lp";

const char* kMm1Source = R"(
model MM1 {
  resource Server {
    capacity = 1
  }

  source Arrivals {
    arrival = poisson(0.8)
  }
  queue WaitLine {
    capacity = 1000000
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
}
)";

const Node* member_of(const ModelAst& model, const char* kind) {
  for (const Node& member : model.members) {
    if (member.kind == kind) {
      return &member;
    }
  }
  return nullptr;
}

const Field* field_of(const Node& node, const char* name) {
  for (const Field& field : node.fields) {
    if (field.name == name) {
      return &field;
    }
  }
  return nullptr;
}

}  // namespace

TEST_CASE("parser: mm1 example parses into a generic node tree",
          "[dsl][parser]") {
  const ParseOutput parsed = parse_source(kMm1Source, "mm1.lp");
  REQUIRE(parsed.diagnostics.empty());
  REQUIRE(parsed.model.has_value());

  const ModelAst& model = *parsed.model;
  REQUIRE(model.name == "MM1");
  REQUIRE(model.members.size() == 4);  // resource + source + queue + service

  const Node* server = member_of(model, "resource");
  REQUIRE(server != nullptr);
  REQUIRE(server->name == "Server");
  const Field* capacity = field_of(*server, "capacity");
  REQUIRE(capacity != nullptr);
  REQUIRE(capacity->value.kind == ValueKind::kInt);
  REQUIRE(capacity->value.int_value == 1);
  REQUIRE(field_of(*server, "failure_rate") == nullptr);

  const Node* arrivals_ptr = member_of(model, "source");
  REQUIRE(arrivals_ptr != nullptr);
  const Node& arrivals = *arrivals_ptr;
  REQUIRE(arrivals.kind == "source");
  REQUIRE(arrivals.name == "Arrivals");
  Distribution arrival;
  REQUIRE(distribution_from_value(field_of(arrivals, "arrival")->value,
                                  arrival));
  REQUIRE(arrival.kind == DistKind::kPoisson);
  REQUIRE(arrival.params.size() == 1);
  REQUIRE(arrival.params[0] == 0.8);

  const Node& wait_line = *member_of(model, "queue");
  REQUIRE(wait_line.kind == "queue");
  REQUIRE(field_of(wait_line, "capacity")->value.int_value == 1000000);

  const Node& service = *member_of(model, "service");
  REQUIRE(service.kind == "service");
  REQUIRE(field_of(service, "resource") != nullptr);
  REQUIRE(field_of(service, "resource")->value.kind == ValueKind::kIdentifier);
  REQUIRE(field_of(service, "resource")->value.string_value == "Server");
  Distribution service_time;
  REQUIRE(distribution_from_value(field_of(service, "time")->value,
                                  service_time));
  REQUIRE(service_time.kind == DistKind::kExponential);
  REQUIRE(service_time.params[0] == 1.0);
}

TEST_CASE("parser: mm1.lp on disk matches the in-memory parse",
          "[dsl][parser]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  REQUIRE(!source.empty());
  const ParseOutput parsed = parse_source(source, kMm1Path);
  REQUIRE(parsed.ok());
  REQUIRE(parsed.model->name == "MM1");
}

TEST_CASE("parser: comments, use and model-level param are extracted",
          "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "// leading comment\nmodel M { /* block */ use process\n"
      "param arrival_rate: float = 0.8\n"
      "resource R { capacity = 2 // trailing\n } }",
      "inline.lp");
  REQUIRE(parsed.ok());
  REQUIRE(parsed.model->used_libraries.size() == 1);
  REQUIRE(parsed.model->used_libraries[0] == "process");
  REQUIRE(parsed.model->params.size() == 1);
  REQUIRE(parsed.model->params[0].keyword == "param");
  REQUIRE(parsed.model->params[0].name == "arrival_rate");
  REQUIRE(parsed.model->params[0].type == "float");
  REQUIRE(parsed.model->params[0].value.float_value == 0.8);
  REQUIRE(member_of(*parsed.model, "resource")->children.empty());
}

TEST_CASE("parser: all service-time distributions extract", "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  source A { arrival = poisson(2.5) }\n"
      "  queue Q { capacity = 0 }\n"
      "  service R { time = normal(10, 0.5) }\n"
      "}\n",
      "inline.lp");
  REQUIRE(parsed.ok());
  const Node& service = *member_of(*parsed.model, "service");
  Distribution normal;
  REQUIRE(distribution_from_value(field_of(service, "time")->value, normal));
  REQUIRE(normal.kind == DistKind::kNormal);
  REQUIRE(normal.params.size() == 2);
  REQUIRE(normal.params[0] == 10.0);
  REQUIRE(normal.params[1] == 0.5);

  const ParseOutput constant = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  source A { arrival = rate(1) }\n"
      "  service R { time = constant(3.25) }\n"
      "}\n",
      "inline.lp");
  REQUIRE(constant.ok());
  const Node& fixed_service = *member_of(*constant.model, "service");
  Distribution fixed;
  REQUIRE(distribution_from_value(field_of(fixed_service, "time")->value,
                                  fixed));
  REQUIRE(fixed.kind == DistKind::kConstant);
  REQUIRE(fixed.params[0] == 3.25);
}

TEST_CASE("parser: v2 behaviors extract trigger, port and effects",
          "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  atomic Cell {\n"
      "    state busy = false\n"
      "    time_advance = constant(1.0)\n"
      "    in job_in: Signal\n"
      "    on_input job_in { busy = true }\n"
      "    on_timeout { busy = false; emit done }\n"
      "  }\n"
      "  agent Drone {\n"
      "    count = 2\n"
      "    on_tick { flip active; bounce }\n"
      "  }\n"
      "}\n",
      "inline.lp");
  REQUIRE(parsed.ok());

  const Node& atomic = *member_of(*parsed.model, "atomic");
  REQUIRE(atomic.ports.size() == 1);
  REQUIRE(atomic.ports[0].direction == "in");
  REQUIRE(atomic.ports[0].name == "job_in");
  REQUIRE(atomic.ports[0].type == "Signal");
  REQUIRE(atomic.behaviors.size() == 2);
  REQUIRE(atomic.behaviors[0].trigger == "input");
  REQUIRE(atomic.behaviors[0].port == "job_in");
  REQUIRE(atomic.behaviors[0].effects.size() == 1);
  REQUIRE(atomic.behaviors[0].effects[0].kind == Effect::Kind::kAssign);
  REQUIRE(atomic.behaviors[1].trigger == "timeout");
  REQUIRE(atomic.behaviors[1].effects.size() == 2);
  REQUIRE(atomic.behaviors[1].effects[1].kind == Effect::Kind::kEmit);
  REQUIRE(atomic.behaviors[1].effects[1].name == "done");

  const Node& agent = *member_of(*parsed.model, "agent");
  REQUIRE(agent.behaviors.size() == 1);
  REQUIRE(agent.behaviors[0].trigger == "tick");
  REQUIRE(agent.behaviors[0].effects.size() == 2);
  REQUIRE(agent.behaviors[0].effects[0].name == "flip");
  REQUIRE(agent.behaviors[0].effects[0].arg == "active");
  REQUIRE(agent.behaviors[0].effects[1].name == "bounce");
}

TEST_CASE("parser: expressions extract as expression trees", "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  param k: float = 2.0\n"
      "  source A { arrival = rate(k * 2) }\n"
      "  queue Q { capacity = 100 + 1 }\n"
      "}\n",
      "inline.lp");
  REQUIRE(parsed.ok());

  // Model-level param value is a plain float literal.
  REQUIRE(parsed.model->params.size() == 1);
  REQUIRE(parsed.model->params[0].value.kind == ValueKind::kFloat);
  REQUIRE(parsed.model->params[0].value.float_value == 2.0);

  const Node* source = member_of(*parsed.model, "source");
  // rate(k * 2): call arg is a kMul expression (k * 2).
  const Value& arrival = field_of(*source, "arrival")->value;
  REQUIRE(arrival.kind == ValueKind::kCall);
  REQUIRE(arrival.call_name == "rate");
  REQUIRE(arrival.call_args.size() == 1);
  REQUIRE(arrival.call_args[0].kind == ValueKind::kMul);
  REQUIRE(arrival.call_args[0].operands.size() == 2);
  REQUIRE(arrival.call_args[0].operands[0].kind == ValueKind::kIdentifier);
  REQUIRE(arrival.call_args[0].operands[0].string_value == "k");
  REQUIRE(arrival.call_args[0].operands[1].kind == ValueKind::kInt);
  REQUIRE(arrival.call_args[0].operands[1].int_value == 2);

  // capacity = 100 + 1: kAdd with two int operands.
  const Value& capacity =
      field_of(*member_of(*parsed.model, "queue"), "capacity")->value;
  REQUIRE(capacity.kind == ValueKind::kAdd);
  REQUIRE(capacity.operands.size() == 2);
  REQUIRE(capacity.operands[0].int_value == 100);
  REQUIRE(capacity.operands[1].int_value == 1);
}

TEST_CASE("parser: library declarations extract block shapes", "[dsl][parser]") {
  const ParseLibraryOutput parsed = parse_library_source(
      "library process {\n"
      "  version = 1\n"
      "  block resource {\n"
      "    capacity: int\n"
      "    failure_rate: float = 0.0\n"
      "  }\n"
      "  block service {\n"
      "    in: Job\n"
      "    resource: ref = \"\"\n"
      "  }\n"
      "}\n",
      "process.lplib");
  REQUIRE(parsed.ok());
  REQUIRE(parsed.library->name == "process");
  REQUIRE(parsed.library->version == 1);
  REQUIRE(parsed.library->blocks.size() == 2);

  const LibraryBlock& resource = parsed.library->blocks[0];
  REQUIRE(resource.kind == "resource");
  REQUIRE(resource.params.size() == 2);
  REQUIRE(resource.params[0].name == "capacity");
  REQUIRE(resource.params[0].type == "int");
  REQUIRE(!resource.params[0].has_default);
  REQUIRE(resource.params[1].name == "failure_rate");
  REQUIRE(resource.params[1].type == "float");
  REQUIRE(resource.params[1].has_default);

  const LibraryBlock& service = parsed.library->blocks[1];
  REQUIRE(service.ports.size() == 1);
  REQUIRE(service.ports[0].direction == "in");
  REQUIRE(service.ports[0].type == "Job");
  REQUIRE(service.params[0].name == "resource");
  REQUIRE(service.params[0].type == "ref");
  REQUIRE(service.params[0].has_default);
}

TEST_CASE("parser: syntax errors become LP0001 diagnostics", "[dsl][parser]") {
  SECTION("missing closing brace") {
    const ParseOutput parsed =
        parse_source("model M { resource R { capacity = 1 }", "bad.lp");
    REQUIRE(!parsed.ok());
    REQUIRE(!parsed.diagnostics.empty());
    REQUIRE(parsed.diagnostics.front().code == "LP0001");
    REQUIRE(parsed.diagnostics.front().span.line >= 1);
  }
  SECTION("garbage token") {
    const ParseOutput parsed =
        parse_source("model M { resource @ }", "bad.lp");
    REQUIRE(!parsed.ok());
    REQUIRE(parsed.diagnostics.front().code == "LP0001");
  }
  SECTION("empty input") {
    const ParseOutput parsed = parse_source("", "bad.lp");
    REQUIRE(!parsed.ok());
    REQUIRE(!parsed.diagnostics.empty());
  }
  SECTION("no model declaration") {
    const ParseOutput parsed =
        parse_source("resource R { capacity = 1 }", "bad.lp");
    REQUIRE(!parsed.ok());
  }
}

// Parser front-end tests: clean parse of the canonical example, structure
// extraction, and syntax-error diagnostics.
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

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)
    }
    queue WaitLine {
      capacity = 1000000
    }
    service Server {
      time = exponential(1.0)
    }
  }
}
)";

}  // namespace

TEST_CASE("parser: mm1 example parses cleanly", "[dsl][parser]") {
  const ParseOutput parsed = parse_source(kMm1Source, "mm1.lp");
  REQUIRE(parsed.diagnostics.empty());
  REQUIRE(parsed.model.has_value());

  const ModelAst& model = *parsed.model;
  REQUIRE(model.name == "MM1");
  REQUIRE(model.resources.size() == 1);
  REQUIRE(model.processes.size() == 1);

  const ResourceDecl& server = model.resources[0];
  REQUIRE(server.name == "Server");
  REQUIRE(server.has_capacity);
  REQUIRE(server.capacity == 1);
  REQUIRE(!server.has_failure_rate);

  const ProcessDecl& flow = model.processes[0];
  REQUIRE(flow.name == "Flow");
  REQUIRE(flow.stages.size() == 3);
  REQUIRE(flow.stages[0].kind == StageDecl::Kind::kSource);
  REQUIRE(flow.stages[0].name == "Arrivals");
  REQUIRE(flow.stages[0].has_arrival);
  REQUIRE(flow.stages[0].arrival.kind == DistKind::kPoisson);
  REQUIRE(flow.stages[0].arrival.params.size() == 1);
  REQUIRE(flow.stages[0].arrival.params[0] == 0.8);

  REQUIRE(flow.stages[1].kind == StageDecl::Kind::kQueue);
  REQUIRE(flow.stages[1].has_capacity);
  REQUIRE(flow.stages[1].capacity == 1000000);

  REQUIRE(flow.stages[2].kind == StageDecl::Kind::kService);
  REQUIRE(flow.stages[2].has_time);
  REQUIRE(flow.stages[2].service_time.kind == DistKind::kExponential);
  REQUIRE(flow.stages[2].service_time.params[0] == 1.0);
}

TEST_CASE("parser: mm1.lp on disk matches the in-memory parse",
          "[dsl][parser]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  REQUIRE(!source.empty());
  const ParseOutput parsed = parse_source(source, kMm1Path);
  REQUIRE(parsed.ok());
  REQUIRE(parsed.model->name == "MM1");
}

TEST_CASE("parser: comments and blank lines are ignored", "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "// leading comment\n\nmodel M { /* block */ resource R { capacity = "
      "2 // trailing\n } }",
      "inline.lp");
  REQUIRE(parsed.ok());
  REQUIRE(parsed.model->resources.size() == 1);
  REQUIRE(parsed.model->resources[0].capacity == 2);
}

TEST_CASE("parser: all service-time distributions extract", "[dsl][parser]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(2.5) }\n"
      "    queue Q { capacity = 0 }\n"
      "    service R { time = normal(10, 0.5) }\n"
      "  }\n"
      "}\n",
      "inline.lp");
  REQUIRE(parsed.ok());
  const Distribution& normal = parsed.model->processes[0].stages[2]
                                   .service_time;
  REQUIRE(normal.kind == DistKind::kNormal);
  REQUIRE(normal.params.size() == 2);
  REQUIRE(normal.params[0] == 10.0);
  REQUIRE(normal.params[1] == 0.5);

  const ParseOutput constant = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    service R { time = constant(3.25) }\n"
      "  }\n"
      "}\n",
      "inline.lp");
  REQUIRE(constant.ok());
  const Distribution& fixed = constant.model->processes[0].stages[1]
                                  .service_time;
  REQUIRE(fixed.kind == DistKind::kConstant);
  REQUIRE(fixed.params[0] == 3.25);
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

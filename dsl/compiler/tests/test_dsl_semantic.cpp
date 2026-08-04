// Semantic analysis tests: structured checks + golden diagnostic snapshots
// (dsl/compiler/tests/golden/diag_*.txt).
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "golden.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/diagnostics.h"
#include "logicpilot/dsl/parser.h"
#include "logicpilot/dsl/semantic.h"

using namespace logicpilot::dsl;

namespace {

constexpr const char* kGoldenDir = LOGICPILOT_DSL_GOLDEN_DIR;

// Compile `source` under a fixed virtual path, expecting failures, and
// snapshot the rendered diagnostics against a golden file.
void expect_diagnostic_snapshot(const std::string& source,
                                const std::string& golden_name) {
  const CompileResult result = compile_source(source, "input.lp");
  REQUIRE(!result.ok);
  REQUIRE(!result.diagnostics.empty());
  const std::string snapshot =
      format_diagnostics("input.lp", result.diagnostics) + "\n";
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/" + golden_name,
                         snapshot);
}

}  // namespace

TEST_CASE("semantic: well-formed model passes analysis", "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource Machine { capacity = 3 failure_rate = 0.01 }\n"
      "  process Production {\n"
      "    source Orders { arrival = poisson(5) }\n"
      "    queue Buffer { capacity = 50 }\n"
      "    service Machine { time = normal(10, 2) }\n"
      "  }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: queue capacity 0 is legal (no buffering)",
          "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    queue Q { capacity = 0 }\n"
      "    service R { time = exponential(1) }\n"
      "  }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic snapshot: missing required fields", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Server {\n"
      "  }\n"
      "  process Flow {\n"
      "    source Arrivals {\n"
      "    }\n"
      "    queue WaitLine {\n"
      "    }\n"
      "    service Server {\n"
      "    }\n"
      "  }\n"
      "}\n",
      "diag_missing_required_fields.txt");
}

TEST_CASE("semantic snapshot: duplicate declarations", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  resource R { capacity = 2 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    queue B { capacity = 4 }\n"
      "    service R { time = exponential(1) }\n"
      "    source A { arrival = poisson(2) }\n"
      "  }\n"
      "}\n",
      "diag_duplicate_declarations.txt");
}

TEST_CASE("semantic snapshot: duplicate fields", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R {\n"
      "    capacity = 1\n"
      "    capacity = 2\n"
      "    failure_rate = 0.1\n"
      "    failure_rate = 0.2\n"
      "  }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) arrival = poisson(2) }\n"
      "    queue B { capacity = 1 capacity = 2 }\n"
      "    service R { time = exponential(1) time = exponential(2) }\n"
      "  }\n"
      "}\n",
      "diag_duplicate_fields.txt");
}

TEST_CASE("semantic snapshot: unresolved resource reference",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    service Worker { time = exponential(1) }\n"
      "  }\n"
      "}\n",
      "diag_unresolved_resource.txt");
}

TEST_CASE("semantic snapshot: unresolved explicit resource reference",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    service Worker { resource = Missing; time = exponential(1) }\n"
      "  }\n"
      "}\n",
      "diag_unresolved_resource_ref.txt");
}

TEST_CASE("semantic: explicit resource reference resolves to a declared "
          "resource", "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(1) }\n"
      "    service Worker { resource = Machine; time = exponential(1) }\n"
      "  }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic snapshot: numeric ranges", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R {\n"
      "    capacity = 0\n"
      "    failure_rate = 1.5\n"
      "  }\n"
      "  process P {\n"
      "    source A { arrival = poisson(0) }\n"
      "    queue B { capacity = 3 }\n"
      "    service R { time = normal(0, 2) }\n"
      "  }\n"
      "}\n",
      "diag_numeric_ranges.txt");
}

TEST_CASE("semantic snapshot: process structure", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  process Empty {\n"
      "  }\n"
      "  process TwoSources {\n"
      "    source A { arrival = poisson(1) }\n"
      "    source B { arrival = poisson(1) }\n"
      "    queue C { capacity = 2 }\n"
      "    service R { time = exponential(1) }\n"
      "  }\n"
      "}\n",
      "diag_process_structure.txt");
}

TEST_CASE("semantic: diagnostics carry spans and machine-readable codes",
          "[dsl][semantic]") {
  const CompileResult result = compile_source(
      "model M {\n"
      "  resource R { }\n"
      "}\n",
      "input.lp");
  REQUIRE(!result.ok);
  REQUIRE(result.diagnostics.size() == 1);
  const Diagnostic& diagnostic = result.diagnostics.front();
  REQUIRE(diagnostic.code == "LP2001");
  REQUIRE(diagnostic.severity == Severity::kError);
  REQUIRE(diagnostic.span.line == 2);
  REQUIRE(diagnostic.span.column >= 1);
  REQUIRE(format_diagnostic("input.lp", diagnostic) ==
          "input.lp:2:3: error[LP2001]: missing required field 'capacity' "
          "in resource 'R'");
}

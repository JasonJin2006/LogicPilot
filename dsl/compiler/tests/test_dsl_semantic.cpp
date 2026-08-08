// Semantic analysis tests: structured checks + golden diagnostic snapshots
// (dsl/compiler/tests/golden/diag_*.txt).
#include <algorithm>
#include <set>
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
      "  source Orders { arrival = poisson(5) }\n"
      "  queue Buffer { capacity = 50 }\n"
      "  service Handle { resource = Machine; time = normal(10, 2) }\n"
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
      "  source A { arrival = poisson(1) }\n"
      "  queue Q { capacity = 0 }\n"
      "  service S { resource = R; time = exponential(1) }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: empty process blocks pass with registry defaults",
          "[dsl][semantic]") {
  // The catalog-driven process library gives every field a default, so a
  // block with no fields is legal (the kernel applies the defaults).
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource Server {\n"
      "  }\n"
      "  source Arrivals {\n"
      "  }\n"
      "  queue WaitLine {\n"
      "  }\n"
      "  service Handle {\n"
      "    resource = Server\n"
      "  }\n"
      "}\n",
      "input.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: comparison queue requires a valid pair expression",
          "[dsl][semantic][queue]") {
  const auto missing = compile_source(
      "model M { use process source S { arrival = rate(1) state size: int = 1 } "
      "queue Q { capacity = 1 queuing = queuing_comparison } "
      "sink K { } couple S.out -> Q.in couple Q.out -> K.in }",
      "comparison-missing.lp");
  CHECK_FALSE(missing.ok);
  CHECK(std::any_of(missing.diagnostics.begin(), missing.diagnostics.end(),
                    [](const Diagnostic& diagnostic) {
                      return diagnostic.code == "LP2001" &&
                             diagnostic.message.find(
                                 "agent1IsPreferredToAgent2") != std::string::npos;
                    }));

  const auto unknown_attribute = compile_source(
      "model M { use process source S { arrival = rate(1) state size: int = 1 } "
      "queue Q { capacity = 1 queuing = queuing_comparison "
      "agent1IsPreferredToAgent2 = agent1.missing > agent2.missing } "
      "sink K { } couple S.out -> Q.in couple Q.out -> K.in }",
      "comparison-unknown.lp");
  CHECK_FALSE(unknown_attribute.ok);
  CHECK(std::any_of(
      unknown_attribute.diagnostics.begin(), unknown_attribute.diagnostics.end(),
      [](const Diagnostic& diagnostic) { return diagnostic.code == "LP5006"; }));

  const auto unknown_mode = compile_source(
      "model M { use process source S { arrival = rate(1) } "
      "queue Q { capacity = 1 queuing = fastest_first } "
      "sink K { } couple S.out -> Q.in couple Q.out -> K.in }",
      "queue-mode-unknown.lp");
  CHECK_FALSE(unknown_mode.ok);
  CHECK(std::any_of(unknown_mode.diagnostics.begin(),
                    unknown_mode.diagnostics.end(),
                    [](const Diagnostic& diagnostic) {
                      return diagnostic.code == "LP3001" &&
                             diagnostic.message.find("queuing must be") !=
                                 std::string::npos;
                    }));
}

TEST_CASE("semantic: DES cardinalities and timeouts reject silent clamping",
          "[dsl][semantic][process]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 2 repair_rate = 0 }\n"
      "  source A { arrival = rate(1); agentsPerArrival = 0; "
      "maxArrivals = -1; firstArrivalTime = -2 }\n"
      "  service S { resource = R; numberOfUnits = 0; queueCapacity = -1; "
      "timeout = 0; time = constant(1) }\n"
      "}\n",
      "bad.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diagnostics = analyze_model(*parsed.model);
  REQUIRE(diagnostics.size() == 7);
  for (const Diagnostic& diagnostic : diagnostics) {
    CHECK(diagnostic.code == "LP3001");
  }
}

TEST_CASE("semantic: failure_rate is a nonnegative exponential rate",
          "[dsl][semantic][process]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 failure_rate = 2.5 repair_rate = 3 }\n"
      "  source A { arrival = rate(1) }\n"
      "  service S { resource = R; time = constant(1) }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: process coupling validates ports and conditions",
          "[dsl][semantic]") {
  // A valid couple compiles; a missing/conditional port is rejected.
  const ParseOutput valid = parse_source(
      "model M {\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(1) }\n"
      "  queue Q { capacity = 4 enableTimeout = true }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "  couple A.out -> Q.in\n"
      "  couple Q.outTimeout -> R.in\n"
      "}\n",
      "input.lp");
  REQUIRE(valid.ok());
  REQUIRE(analyze_model(*valid.model).empty());

  // Conditional port used without enabling its field -> LP5003.
  const ParseOutput conditional = parse_source(
      "model M {\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(1) }\n"
      "  queue Q { capacity = 4 }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "  couple A.out -> Q.in\n"
      "  couple Q.outTimeout -> R.in\n"
      "}\n",
      "input.lp");
  REQUIRE(conditional.ok());
  const std::vector<Diagnostic> conditional_diags =
      analyze_model(*conditional.model);
  REQUIRE(conditional_diags.size() == 1);
  REQUIRE(conditional_diags.front().code == "LP5003");

  // Unknown port / wrong direction -> LP5003.
  const ParseOutput bad_port = parse_source(
      "model M {\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(1) }\n"
      "  queue Q { capacity = 4 }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "  couple A.nope -> Q.in\n"
      "  couple Q.out -> R.in\n"
      "}\n",
      "input.lp");
  REQUIRE(bad_port.ok());
  const std::vector<Diagnostic> bad_port_diags = analyze_model(*bad_port.model);
  REQUIRE(bad_port_diags.size() == 1);
  REQUIRE(bad_port_diags.front().code == "LP5003");
}

TEST_CASE("semantic: agent-centric flows live in the model root or agent",
          "[dsl][semantic]") {
  // A flat model: process-library blocks + couplings directly under the
  // model root (no `process` wrapper).
  const ParseOutput flat = parse_source(
      "model M {\n"
      "  use process\n"
      "  param rate: float = 0.8\n"
      "  resource Server { capacity = 1 }\n"
      "  source In { arrival = rate(rate) }\n"
      "  queue Q { capacity = 100 }\n"
      "  service S { resource = Server; time = exponential(1.0) }\n"
      "  sink K { }\n"
      "  couple In.out -> Q.in\n"
      "  couple Q.out -> S.in\n"
      "  couple S.out -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(flat.ok());
  REQUIRE(analyze_model(*flat.model).empty());

  // An agent body can hold its own flow members + couplings.
  const ParseOutput agent = parse_source(
      "model M {\n"
      "  use process\n"
      "  agent Worker {\n"
      "    count = 1\n"
      "    resource Tool { capacity = 1 }\n"
      "    source In { arrival = rate(1.0) }\n"
      "    service S { resource = Tool; time = exponential(1.0) }\n"
      "    sink K { }\n"
      "    couple In.out -> S.in\n"
      "    couple S.out -> K.in\n"
      "  }\n"
      "}\n",
      "input.lp");
  REQUIRE(agent.ok());
  REQUIRE(analyze_model(*agent.model).empty());

  // A flat model without a source is rejected (LP2002).
  const ParseOutput no_source = parse_source(
      "model M {\n"
      "  use process\n"
      "  queue Q { capacity = 1 }\n"
      "  sink K { }\n"
      "}\n",
      "input.lp");
  REQUIRE(no_source.ok());
  const std::vector<Diagnostic> no_source_diags =
      analyze_model(*no_source.model);
  REQUIRE(!no_source_diags.empty());
  REQUIRE(no_source_diags.front().code == "LP2002");
}

TEST_CASE("semantic snapshot: duplicate declarations", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  resource R { capacity = 2 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  queue B { capacity = 4 }\n"
      "  service R { time = exponential(1) }\n"
      "  source A { arrival = poisson(2) }\n"
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
      "  source A { arrival = poisson(1) arrival = poisson(2) }\n"
      "  queue B { capacity = 1 capacity = 2 }\n"
      "  service R { time = exponential(1) time = exponential(2) }\n"
      "}\n",
      "diag_duplicate_fields.txt");
}

TEST_CASE("semantic snapshot: unresolved resource reference",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  service Worker { time = exponential(1) }\n"
      "}\n",
      "diag_unresolved_resource.txt");
}

TEST_CASE("semantic snapshot: unresolved explicit resource reference",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  service Worker { resource = Missing; time = exponential(1) }\n"
      "}\n",
      "diag_unresolved_resource_ref.txt");
}

TEST_CASE("semantic: explicit resource reference resolves to a declared "
          "resource", "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource Machine { capacity = 1 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  service Worker { resource = Machine; time = exponential(1) }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: parameter references and constant folding",
          "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  param arrival_rate: float = 0.4\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(arrival_rate * 2) }\n"
      "  queue Q { capacity = 100 + 1 }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic snapshot: undeclared identifier in an expression",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  param k = 1\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(missing) }\n"
      "  queue Q { capacity = 100 }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "}\n",
      "diag_undeclared_identifier.txt");
}

TEST_CASE("semantic: experiment variable references a declared model param",
          "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  param arrival_rate = 0.8\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "  experiment Tune {\n"
      "    objective = minimize\n"
      "    metric = Wq\n"
      "    variable = arrival_rate\n"
      "    range = 1..4\n"
      "  }\n"
      "}\n",
      "ok.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
}

TEST_CASE("semantic: simulation experiment accepts reproducible replications",
          "[dsl][semantic][experiment]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  experiment Baseline {\n"
      "    type = simulation\n"
      "    replications = 12\n"
      "    seed = 42\n"
      "  }\n"
      "}\n",
      "simulation.lp");
  REQUIRE(parsed.ok());
  REQUIRE(analyze_model(*parsed.model).empty());
  REQUIRE(parsed.model->experiments.size() == 1);
  CHECK(parsed.model->experiments[0].kind == "simulation");
  CHECK(parsed.model->experiments[0].replications == 12);
  CHECK(parsed.model->experiments[0].seed == 42);
}

TEST_CASE("semantic: simulation experiment rejects invalid statistics",
          "[dsl][semantic][experiment]") {
  const ParseOutput parsed = parse_source(
      "model M { experiment Bad { type = simulation replications = 0 seed = -1 } }",
      "simulation_bad.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diagnostics = analyze_model(*parsed.model);
  REQUIRE(diagnostics.size() == 2);
  CHECK(diagnostics[0].code == "LP3001");
  CHECK(diagnostics[1].code == "LP2006");
}

TEST_CASE("semantic: simulation experiment rejects unknown fields",
          "[dsl][semantic][experiment]") {
  const ParseOutput parsed = parse_source(
      "model M { experiment Bad { type = simulation repetitions = 5 } }",
      "simulation_unknown.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diagnostics = analyze_model(*parsed.model);
  REQUIRE(diagnostics.size() == 1);
  CHECK(diagnostics[0].code == "LP2005");
  CHECK(diagnostics[0].message.find("repetitions") != std::string::npos);
}

TEST_CASE("semantic: precision simulation experiment validates confidence settings",
          "[dsl][semantic][experiment]") {
  const auto valid = compile_source(
      "model M { experiment Adaptive { type = simulation seed_mode = random "
      "replication_mode = precision min_replications = 5 max_replications = 40 "
      "confidence = 0.9 error_percent = 3.5 metric = Wq } }",
      "adaptive.lp");
  REQUIRE(valid.ok);

  const auto invalid = compile_source(
      "model M { experiment Bad { type = simulation replication_mode = precision "
      "min_replications = 1 max_replications = 0 confidence = 1 "
      "error_percent = 0 } }",
      "adaptive-bad.lp");
  CHECK_FALSE(invalid.ok);
  CHECK(invalid.diagnostics.size() >= 5);
}

TEST_CASE("semantic: parameter variation validates axes and top-level params",
          "[dsl][semantic][experiment][variation]") {
  const auto valid = compile_source(
      "model M { param rate: float = 0.5 param count: int = 1 "
      "experiment Sweep { type = parameter_variation metric = Wq replications = 3 "
      "axis Rate { variable = rate range = 0.5..1.0 step = 0.25 } "
      "axis Count { variable = count range = 1..3 step = 1 } } }",
      "variation.lp");
  REQUIRE(valid.ok);

  const auto invalid = compile_source(
      "model M { param rate: float = 0.5 experiment Bad { "
      "type = parameter_variation metric = Wq "
      "axis A { variable = missing range = 1..0 step = 0 } "
      "axis B { variable = rate range = 0..1 step = 1 } "
      "axis C { variable = rate range = 0..1 step = 1 } } }",
      "variation-bad.lp");
  CHECK_FALSE(invalid.ok);
  CHECK(invalid.diagnostics.size() >= 3);

  const auto non_integer_axis = compile_source(
      "model M { param count: int = 1 experiment Bad { "
      "type = parameter_variation metric = Wq "
      "axis Count { variable = count range = 1..2 step = 0.5 } } }",
      "variation-int-bad.lp");
  CHECK_FALSE(non_integer_axis.ok);
  CHECK(std::any_of(non_integer_axis.diagnostics.begin(),
                    non_integer_axis.diagnostics.end(),
                    [](const Diagnostic& diagnostic) {
                      return diagnostic.code == "LP3001" &&
                             diagnostic.message.find("integer range") != std::string::npos;
                    }));
}

TEST_CASE("semantic snapshot: experiment variable must be a declared param",
          "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = poisson(1) }\n"
      "  service R { resource = Server; time = exponential(1) }\n"
      "  experiment Tune {\n"
      "    objective = minimize\n"
      "    metric = Wq\n"
      "    variable = missing_param\n"
      "    range = 1..4\n"
      "  }\n"
      "}\n",
      "diag_experiment_variable_undeclared.txt");
}

TEST_CASE("semantic snapshot: numeric ranges", "[dsl][semantic]") {
  expect_diagnostic_snapshot(
      "model M {\n"
      "  resource R {\n"
      "    capacity = 0\n"
      "    failure_rate = 1.5\n"
      "  }\n"
      "  source A { arrival = poisson(0) }\n"
      "  queue B { capacity = 3 }\n"
      "  service R { time = normal(0, 2) }\n"
      "}\n",
      "diag_numeric_ranges.txt");
}

TEST_CASE("semantic: process containers are rejected", "[dsl][semantic]") {
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource R { capacity = 1 }\n"
      "  process Flow {\n"
      "    source A { arrival = poisson(1) }\n"
      "  }\n"
      "}\n",
      "input.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diags = analyze_model(*parsed.model);
  REQUIRE(diags.size() == 1);
  REQUIRE(diags.front().code == "LP2004");
  REQUIRE(diags.front().message.find("process containers were removed") !=
          std::string::npos);
}

TEST_CASE("semantic: diagnostics carry spans and machine-readable codes",
          "[dsl][semantic]") {
  const CompileResult result = compile_source(
      "model M {\n"
      "  resource R { bogus = 1 }\n"
      "}\n",
      "input.lp");
  REQUIRE(!result.ok);
  REQUIRE(result.diagnostics.size() == 1);
  const Diagnostic& diagnostic = result.diagnostics.front();
  REQUIRE(diagnostic.code == "LP2005");
  REQUIRE(diagnostic.severity == Severity::kError);
  REQUIRE(diagnostic.span.line == 2);
  REQUIRE(diagnostic.span.column >= 1);
  REQUIRE(format_diagnostic("input.lp", diagnostic) ==
          "input.lp:2:16: error[LP2005]: unknown field 'bogus' in resource "
          "'R'");
}

TEST_CASE("semantic: independent errors are all reported, not fail-fast",
          "[dsl][semantic]") {
  // Unknown kind, unknown field and an undeclared identifier in one model:
  // the analyzer accumulates every independent diagnostic (sorted by span).
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  wat X { foo = 1 }\n"
      "  resource Server { nope = 1 }\n"
      "  source A { arrival = rate(bogus) }\n"
      "}\n",
      "input.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diags = analyze_model(*parsed.model);
  std::set<std::string> codes;
  for (const Diagnostic& diagnostic : diags) {
    codes.insert(diagnostic.code);
  }
  REQUIRE(codes.count("LP2004") == 1);  // unknown kind
  REQUIRE(codes.count("LP2005") == 1);  // unknown field
  REQUIRE(codes.count("LP2006") == 1);  // undeclared identifier
}

TEST_CASE("semantic: unreachable process stage is flagged LP5004",
          "[dsl][semantic]") {
  // queue Q is declared but never coupled: with an explicit coupling graph
  // it can never receive an entity.
  const ParseOutput parsed = parse_source(
      "model M {\n"
      "  resource Server { capacity = 1 }\n"
      "  source A { arrival = rate(1) }\n"
      "  queue Q { capacity = 4 }\n"
      "  service S { resource = Server; time = exponential(1) }\n"
      "  couple A.out -> S.in\n"
      "}\n",
      "input.lp");
  REQUIRE(parsed.ok());
  const std::vector<Diagnostic> diags = analyze_model(*parsed.model);
  int lp5004 = 0;
  for (const Diagnostic& diagnostic : diags) {
    if (diagnostic.code == "LP5004") {
      ++lp5004;
      REQUIRE(diagnostic.message.find("Q") != std::string::npos);
    }
  }
  REQUIRE(lp5004 == 1);
}

TEST_CASE("semantic: custom block extending an unknown built-in is LP2011",
          "[dsl][semantic][library]") {
  const std::string fixtures =
      std::string(kGoldenDir) + "/../fixtures";  // golden/.. = tests dir
  const std::vector<std::string> library_dirs = {fixtures};
  const CompileResult result = compile_source(
      "model M {\n"
      "  use badlib\n"
      "  Gadget G { }\n"
      "}\n",
      "input.lp", library_dirs);
  REQUIRE_FALSE(result.ok);
  const std::vector<Diagnostic> diags = result.diagnostics;
  bool has_lp2011 = false;
  for (const Diagnostic& diagnostic : diags) {
    if (diagnostic.code == "LP2011") {
      has_lp2011 = true;
    }
  }
  REQUIRE(has_lp2011);
}

TEST_CASE("semantic: runtime condition identifiers are validated (LP5006)",
          "[dsl][semantic][condition]") {
  // Valid: t and the block's own numeric field are in scope.
  const ParseOutput valid = parse_source(
      "model M {\n"
      "  source In { arrival = rate(1) }\n"
      "  selectOutput G {\n"
      "    threshold = 0.8\n"
      "    condition = threshold > 0.5\n"
      "  }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.outT -> K.in\n"
      "  couple G.outF -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(valid.ok());
  const std::vector<Diagnostic> valid_diags = analyze_model(*valid.model);
  bool has_lp5006 = false;
  for (const Diagnostic& diagnostic : valid_diags) {
    if (diagnostic.code == "LP5006") {
      has_lp5006 = true;
    }
  }
  REQUIRE_FALSE(has_lp5006);

  // Invalid: an undeclared identifier evaluates to 0.0 silently at runtime.
  const ParseOutput invalid = parse_source(
      "model M {\n"
      "  source In { arrival = rate(1) }\n"
      "  hold G { blockingCondition = queueLevel > 5 }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.out -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(invalid.ok());
  const std::vector<Diagnostic> invalid_diags = analyze_model(*invalid.model);
  int lp5006 = 0;
  for (const Diagnostic& diagnostic : invalid_diags) {
    if (diagnostic.code == "LP5006") {
      ++lp5006;
      REQUIRE(diagnostic.message.find("queueLevel") != std::string::npos);
    }
  }
  REQUIRE(lp5006 >= 1);
}

TEST_CASE("semantic: source entity attributes are routable in conditions",
          "[dsl][semantic][condition][attributes]") {
  // A `state` declared on a source is an entity attribute default; runtime
  // conditions may reference it.
  const ParseOutput valid = parse_source(
      "model M {\n"
      "  source In {\n"
      "    arrival = rate(1)\n"
      "    state size: int = 10\n"
      "  }\n"
      "  selectOutput G {\n"
      "    condition = size > 5\n"
      "  }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.outT -> K.in\n"
      "  couple G.outF -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(valid.ok());
  const std::vector<Diagnostic> valid_diags = analyze_model(*valid.model);
  for (const Diagnostic& diagnostic : valid_diags) {
    REQUIRE_FALSE(diagnostic.code == "LP5006");
    REQUIRE_FALSE(diagnostic.code == "LP2005");
  }

  // Unknown identifiers are still LP5006 even with attributes in scope.
  const ParseOutput unknown = parse_source(
      "model M {\n"
      "  source In {\n"
      "    arrival = rate(1)\n"
      "    state size: int = 10\n"
      "  }\n"
      "  hold G { blockingCondition = missing > 5 }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.out -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(unknown.ok());
  int lp5006 = 0;
  for (const Diagnostic& diagnostic : analyze_model(*unknown.model)) {
    if (diagnostic.code == "LP5006") {
      ++lp5006;
    }
  }
  REQUIRE(lp5006 >= 1);

  // `state` on a non-source process block stays LP2005.
  const ParseOutput misplaced = parse_source(
      "model M {\n"
      "  source In { arrival = rate(1) }\n"
      "  queue Q { capacity = 5; state x = 1 }\n"
      "  sink K { }\n"
      "  couple In.out -> Q.in\n"
      "  couple Q.out -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(misplaced.ok());
  int lp2005 = 0;
  for (const Diagnostic& diagnostic : analyze_model(*misplaced.model)) {
    if (diagnostic.code == "LP2005") {
      ++lp2005;
    }
  }
  REQUIRE(lp2005 >= 1);
}

TEST_CASE("semantic: equality comparisons and match attribute pairing compile",
          "[dsl][semantic][condition][match]") {
  const ParseOutput output = parse_source(
      "model M {\n"
      "  source In {\n"
      "    arrival = rate(1)\n"
      "    state priority: float = 5\n"
      "    state kind: int = 1\n"
      "  }\n"
      "  selectOutput G { condition = priority == 5 }\n"
      "  match Sync { matchCondition = kind }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.outT -> Sync.in1\n"
      "  couple G.outF -> Sync.in2\n"
      "  couple Sync.out1 -> K.in\n"
      "  couple Sync.out2 -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(output.ok());
  const std::vector<Diagnostic> diagnostics = analyze_model(*output.model);
  for (const Diagnostic& diagnostic : diagnostics) {
    REQUIRE_FALSE(diagnostic.code == "LP5006");
    REQUIRE_FALSE(diagnostic.code == "LP2005");
    REQUIRE_FALSE(diagnostic.code == "LP1002");
  }

  // Unknown identifiers in equality conditions are still LP5006.
  const ParseOutput unknown = parse_source(
      "model M {\n"
      "  source In { arrival = rate(1) }\n"
      "  selectOutput G { condition = mystery == 5 }\n"
      "  sink K { }\n"
      "  couple In.out -> G.in\n"
      "  couple G.outT -> K.in\n"
      "  couple G.outF -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(unknown.ok());
  int lp5006 = 0;
  for (const Diagnostic& diagnostic : analyze_model(*unknown.model)) {
    if (diagnostic.code == "LP5006") {
      ++lp5006;
    }
  }
  REQUIRE(lp5006 >= 1);
}

TEST_CASE("semantic: match field expressions validate agent1/agent2 attributes",
          "[dsl][semantic][match]") {
  const ParseOutput valid = parse_source(
      "model M {\n"
      "  source In {\n"
      "    arrival = rate(1)\n"
      "    state kind: int = 1\n"
      "  }\n"
      "  match Sync { matchCondition = agent1.kind == agent2.kind }\n"
      "  sink K { }\n"
      "  couple In.out -> Sync.in1\n"
      "  couple In.out -> Sync.in2\n"
      "  couple Sync.out1 -> K.in\n"
      "  couple Sync.out2 -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(valid.ok());
  const std::vector<Diagnostic> valid_diags = analyze_model(*valid.model);
  for (const Diagnostic& diagnostic : valid_diags) {
    REQUIRE_FALSE(diagnostic.code == "LP5006");
  }

  const ParseOutput unknown = parse_source(
      "model M {\n"
      "  source In {\n"
      "    arrival = rate(1)\n"
      "    state kind: int = 1\n"
      "  }\n"
      "  match Sync { matchCondition = agent1.mystery == agent2.kind }\n"
      "  sink K { }\n"
      "  couple In.out -> Sync.in1\n"
      "  couple In.out -> Sync.in2\n"
      "  couple Sync.out1 -> K.in\n"
      "  couple Sync.out2 -> K.in\n"
      "}\n",
      "input.lp");
  REQUIRE(unknown.ok());
  int lp5006 = 0;
  for (const Diagnostic& diagnostic : analyze_model(*unknown.model)) {
    if (diagnostic.code == "LP5006") {
      ++lp5006;
    }
  }
  REQUIRE(lp5006 >= 1);
}

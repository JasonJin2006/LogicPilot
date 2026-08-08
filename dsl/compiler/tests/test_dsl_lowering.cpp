// IR lowering tests: DSL -> v2 ModelFile buffer -> ir_loader acceptance,
// plus structural-dump goldens (FlatBuffers bytes are order-sensitive, so
// the golden compares the deterministic text rendering).
#include <algorithm>
#include <cmath>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/ir_dump.h"
#include "logicpilot/runtime/method_registry.h"

#include "expect_json.h"  // read_text_file
#include "golden.h"
#include "ir_v2_generated.h"
#include "process_runtime.h"

using namespace logicpilot;
using namespace logicpilot::dsl;
namespace v2 = logicpilot::ir::v2;

namespace {

// Register the method runtimes (process + kernel-native) once per process;
// the lowering test runs the compiled process model through the registry.
struct EnsureMethodsRegistered {
  EnsureMethodsRegistered() { register_all_methods(); }
} ensure_methods_registered;

constexpr const char* kGoldenDir = LOGICPILOT_DSL_GOLDEN_DIR;
constexpr const char* kMm1Path = LOGICPILOT_EXAMPLES_DIR "/mm1.lp";

// Note: return the whole IrLoadResult - IrModelFile.v2_root is a zero-copy
// pointer into IrModelFile.v2_bytes, so moving the struct alone would dangle.
IrLoadResult compile_and_load(const std::string& source, const std::string& path) {
  const CompileResult result = compile_source(source, path);
  INFO(format_diagnostics(path, result.diagnostics));
  REQUIRE(result.ok);
  IrLoadResult loaded = load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

TEST_CASE("lowering: simulation experiment carries kind seed and replications",
          "[dsl][lowering][experiment]") {
  IrLoadResult loaded = compile_and_load(
      "model M { experiment Baseline { type = simulation replications = 12 seed = 7 } }",
      "simulation.lp");
  REQUIRE(loaded.file.v2_root->experiments() != nullptr);
  REQUIRE(loaded.file.v2_root->experiments()->size() == 1);
  const v2::Experiment* experiment =
      loaded.file.v2_root->experiments()->Get(0);
  CHECK(experiment->kind() == v2::ExperimentKind_Simulation);
  CHECK(experiment->name()->str() == "Baseline");
  CHECK(experiment->replications() == 12);
  CHECK(experiment->seed() == 7);
}

TEST_CASE("lowering: adaptive experiment carries seed and replication policies",
          "[dsl][lowering][experiment]") {
  const auto compiled = compile_source(
      "model M { experiment Adaptive { type = simulation seed_mode = random "
      "replication_mode = precision min_replications = 4 max_replications = 25 "
      "confidence = 0.9 error_percent = 2.5 metric = Wq } }",
      "adaptive.lp");
  REQUIRE(compiled.ok);
  const auto* file = logicpilot::ir::v2::GetModelFile(compiled.v2_bytes.data());
  REQUIRE(file->experiments() != nullptr);
  REQUIRE(file->experiments()->size() == 1);
  const auto* experiment = file->experiments()->Get(0);
  CHECK(experiment->seed_policy() == logicpilot::ir::v2::SeedPolicy_Random);
  CHECK(experiment->replication_policy() ==
        logicpilot::ir::v2::ReplicationPolicy_Precision);
  CHECK(experiment->min_replications() == 4);
  CHECK(experiment->max_replications() == 25);
  CHECK(std::abs(experiment->confidence() - 0.9) < 1e-12);
  CHECK(std::abs(experiment->error_percent() - 2.5) < 1e-12);
  REQUIRE(experiment->precision_metric() != nullptr);
  CHECK(experiment->precision_metric()->str() == "Wq");
}

TEST_CASE("lowering: parameter variation carries multiple axes",
          "[dsl][lowering][experiment][variation]") {
  const std::string source =
      "model M { param rate: float = 0.5 param count: int = 1 "
      "experiment Sweep { type = parameter_variation metric = Wq "
      "axis Rate { variable = rate range = 0.5..1.0 step = 0.25 } "
      "axis Count { variable = count range = 1..3 step = 1 } } }";
  const auto compiled = compile_source(source, "variation.lp");
  REQUIRE(compiled.ok);
  const auto* file = logicpilot::ir::v2::GetModelFile(compiled.v2_bytes.data());
  const auto* experiment = file->experiments()->Get(0);
  CHECK(experiment->kind() ==
        logicpilot::ir::v2::ExperimentKind_ParameterVariation);
  REQUIRE(experiment->axes() != nullptr);
  REQUIRE(experiment->axes()->size() == 2);
  CHECK(experiment->axes()->Get(0)->variable()->str() == "rate");
  CHECK(experiment->axes()->Get(0)->range_min() == 0.5);
  CHECK(experiment->axes()->Get(0)->step() == 0.25);

  const auto overridden = compile_source(
      source, "variation.lp", {}, {{"rate", 0.75}, {"count", 2.0}});
  REQUIRE(overridden.ok);
  CHECK(overridden.v2_bytes != compiled.v2_bytes);
  CHECK_FALSE(compile_source(source, "variation.lp", {}, {{"count", 1.5}}).ok);
  CHECK_FALSE(compile_source(source, "variation.lp", {}, {{"missing", 1.0}}).ok);
}

}  // namespace

TEST_CASE("lowering: mm1.lp produces a valid v2 ModelFile", "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  REQUIRE(!source.empty());

  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  REQUIRE(result.model_name == "MM1");

  IrLoadResult loaded = load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.v2_root != nullptr);
  REQUIRE(loaded.file.v2_root->schema_version() == 2);
  const v2::Node* root = loaded.file.v2_root->root();
  REQUIRE(root != nullptr);
  REQUIRE(root->metadata()->name()->str() == "MM1");
  // Agent-centric: one resource block + four flat flow blocks under the root,
  // connected by the root's own couplings (no `process Flow` container).
  REQUIRE(root->children() != nullptr);
  REQUIRE(root->children()->size() == 5);
  REQUIRE(root->children()->Get(0)->semantics()->block()->str() == "resource");
  REQUIRE(root->children()->Get(1)->semantics()->block()->str() == "source");
  REQUIRE(root->children()->Get(2)->semantics()->block()->str() == "queue");
  REQUIRE(root->children()->Get(3)->semantics()->block()->str() == "service");
  REQUIRE(root->children()->Get(4)->semantics()->block()->str() == "sink");
  REQUIRE(root->couplings() != nullptr);
  REQUIRE(root->couplings()->size() == 3);

  // Structural dump golden.
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/mm1_ir_dump.txt", dump_ir(loaded.file));
}

TEST_CASE("lowering: flat process blocks keep declaration order and couples", "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model Demo {\n"
      "  resource Server { capacity = 2 failure_rate = 0.25 }\n"
      "  source In { arrival = poisson(1.5) }\n"
      "  queue Buf { capacity = 7 }\n"
      "  service Handle { resource = Server; time = normal(3, 0.5) }\n"
      "  couple In.out -> Buf.in\n"
      "  couple Buf.out -> Handle.in\n"
      "}\n",
      "demo.lp");

  const v2::Node* root = loaded.file.v2_root->root();
  REQUIRE(root->children() != nullptr);
  REQUIRE(root->children()->size() == 4);
  REQUIRE(root->children()->Get(1)->metadata()->name()->str() == "In");
  REQUIRE(root->children()->Get(2)->metadata()->name()->str() == "Buf");
  REQUIRE(root->children()->Get(3)->metadata()->name()->str() == "Handle");
  REQUIRE(root->children()->Get(1)->semantics()->block()->str() == "source");
  REQUIRE(root->children()->Get(2)->semantics()->block()->str() == "queue");
  REQUIRE(root->children()->Get(3)->semantics()->block()->str() == "service");

  // Source arrival distribution (Poisson = kind 4).
  const v2::Var* arrival = root->children()->Get(1)->params()->Get(0);
  REQUIRE(arrival->name()->str() == "arrival");
  REQUIRE(arrival->distribution()->kind() == 4);
  // Queue capacity.
  const v2::Var* capacity = root->children()->Get(2)->params()->Get(0);
  REQUIRE(capacity->name()->str() == "capacity");
  REQUIRE(capacity->int_value() == 7);
  // Service params: the explicit `resource` reference + the written field
  // `time` (Normal = kind 2); servers are resolved by the kernel from the
  // referenced resource node (no synthetic `servers` param anymore).
  const v2::Node* service = root->children()->Get(3);
  REQUIRE(service->params()->size() == 2);
  REQUIRE(service->params()->Get(0)->name()->str() == "resource");
  REQUIRE(service->params()->Get(0)->string_value()->str() == "Server");
  REQUIRE(service->params()->Get(1)->name()->str() == "time");
  REQUIRE(service->params()->Get(1)->distribution()->kind() == 2);

  // Registered ports land on the IR nodes (queue has outTimeout etc).
  REQUIRE(root->children()->Get(1)->ports()->size() == 1);
  REQUIRE(root->children()->Get(2)->ports()->size() == 4);

  // Root couplings: In.out -> Buf.in, Buf.out -> Server.in.
  REQUIRE(root->couplings() != nullptr);
  REQUIRE(root->couplings()->size() == 2);
  REQUIRE(root->couplings()->Get(0)->from_model()->str() == "In");
  REQUIRE(root->couplings()->Get(0)->to_model()->str() == "Buf");
  REQUIRE(root->couplings()->Get(1)->from_model()->str() == "Buf");
  REQUIRE(root->couplings()->Get(1)->to_model()->str() == "Handle");

  // Resource block carries the typed capacity/failure_rate params.
  const v2::Node* resource = root->children()->Get(0);
  REQUIRE(resource->metadata()->name()->str() == "Server");
  REQUIRE(resource->params()->size() == 2);
}

TEST_CASE("lowering: constant service time maps to Constant distribution", "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model C {\n"
      "  resource R { capacity = 1 }\n"
      "  source A { arrival = poisson(2) }\n"
      "  service S { resource = R; time = constant(1.25) }\n"
      "}\n",
      "const.lp");
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/const_ir_dump.txt", dump_ir(loaded.file));
}

TEST_CASE(
    "lowering: explicit resource reference decouples the service "
    "name from the resource",
    "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model Demo {\n"
      "  resource Server { capacity = 3 failure_rate = 0.1 }\n"
      "  source In { arrival = poisson(1.5) }\n"
      "  service Handle { resource = Server; time = exponential(2) }\n"
      "  couple In.out -> Handle.in\n"
      "}\n",
      "demo.lp");

  const v2::Node* root = loaded.file.v2_root->root();
  const v2::Node* service = root->children()->Get(2);
  REQUIRE(service->metadata()->name()->str() == "Handle");
  // Written fields land in order: resource (ref), time (distribution).
  REQUIRE(service->params()->size() == 2);
  REQUIRE(service->params()->Get(0)->name()->str() == "resource");
  REQUIRE(service->params()->Get(0)->string_value()->str() == "Server");
  REQUIRE(service->params()->Get(1)->name()->str() == "time");
  // The kernel resolves the server count from the referenced resource's
  // capacity (3), not from a synthetic `servers` param.
  const v2::Node* resource = root->children()->Get(0);
  REQUIRE(resource->params()->Get(0)->int_value() == 3);
  REQUIRE(root->couplings()->Get(0)->to_model()->str() == "Handle");
}

TEST_CASE(
    "lowering: expressions and parameter references fold before the "
    "IR",
    "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model M {\n"
      "  param arrival_rate: float = 0.4\n"
      "  param service_rate: float = 2.0\n"
      "  resource Server { capacity = 1 + 1 }\n"
      "  source A { arrival = rate(arrival_rate * 2) }\n"
      "  queue Q { capacity = 100 + 1 }\n"
      "  service R { resource = Server; time = exponential(service_rate) }\n"
      "  couple A.out -> Q.in\n"
      "  couple Q.out -> R.in\n"
      "}\n",
      "fold.lp");

  // Assert on the deterministic structural dump (stable string rendering of
  // the same zero-copy FlatBuffers view the kernel reads).
  const std::string dump = dump_ir(loaded.file);
  REQUIRE(dump.find("param arrival_rate = float(0.4)") != std::string::npos);
  REQUIRE(dump.find("param service_rate = float(2)") != std::string::npos);
  REQUIRE(dump.find("param capacity = int(2)") != std::string::npos);  // 1+1
  REQUIRE(dump.find("param arrival = distribution(Poisson params=[0.8])") !=
          std::string::npos);  // rate(arrival_rate * 2)
  REQUIRE(dump.find("param capacity = int(101)") != std::string::npos);
  REQUIRE(dump.find("param time = distribution(Exponential params=[2])") !=
          std::string::npos);  // exponential(service_rate)
}

TEST_CASE("lowering: integer literals use the declared float field type",
          "[dsl][lowering][types]") {
  const IrLoadResult loaded = compile_and_load(
      "model TypedFields {\n"
      "  use process\n"
      "  source In { arrival = constant(1) }\n"
      "  queue Buffer { capacity = 2 timeout = 1 }\n"
      "  sink Out { }\n"
      "  couple In.out -> Buffer.in\n"
      "  couple Buffer.out -> Out.in\n"
      "}\n",
      "typed_fields.lp");

  const v2::Node* queue = loaded.file.v2_root->root()->children()->Get(1);
  REQUIRE(queue->params() != nullptr);

  const v2::Var* timeout = nullptr;
  for (const v2::Var* param : *queue->params()) {
    if (param->name() != nullptr && param->name()->str() == "timeout") {
      timeout = param;
      break;
    }
  }
  REQUIRE(timeout != nullptr);
  REQUIRE(timeout->type() == v2::VarType_Float);
  REQUIRE(timeout->float_value() == 1.0);
}

TEST_CASE("lowering: ir_loader consumes the DSL output end to end", "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  IrLoadResult loaded = load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 2000;
  config.warmup_arrivals = 400;
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.departures > 1200);
  REQUIRE(metrics.mean_wait > 0.5);
  REQUIRE(metrics.mean_sojourn > metrics.mean_wait);
}

TEST_CASE("lowering: standalone library semantics and version survive into IR",
          "[dsl][lowering][extension]") {
  const std::vector<std::string> library_dirs = {LOGICPILOT_DSL_FIXTURE_DIR};
  const CompileResult result = compile_source(
      "model Net {\n"
      "  use petri\n"
      "  place Buffer { tokens = 4 }\n"
      "}\n",
      "petri_model.lp", library_dirs);
  INFO(format_diagnostics("petri_model.lp", result.diagnostics));
  REQUIRE(result.ok);

  IrLoadResult loaded = load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());
  const v2::Node* place = loaded.file.v2_root->root()->children()->Get(0);
  REQUIRE(place->semantics()->library()->str() == "petri");
  REQUIRE(place->semantics()->block()->str() == "place");
  REQUIRE(place->semantics()->version()->str() == "3");

  const std::vector<std::string> methods = resolve_method_names(loaded.file);
  REQUIRE(methods == std::vector<std::string>{"petri"});

  MethodRegistry::instance().register_method(
      "petri", [] { return std::unique_ptr<SimulationMethod>{}; },
      MethodRegistry::Descriptor{"0.1.0", {"2"}});
  std::string error;
  REQUIRE(build_replication_model(loaded.file, &error) == nullptr);
  REQUIRE(error.find("does not support semantics version '3'") != std::string::npos);
}

TEST_CASE("lowering: qualified blocks disambiguate equal names across libraries",
          "[dsl][lowering][extension]") {
  const std::vector<std::string> library_dirs = {LOGICPILOT_DSL_FIXTURE_DIR};
  const CompileResult result = compile_source(
      "model Qualified {\n"
      "  use alpha\n"
      "  use beta\n"
      "  alpha::shared A { value = 1 }\n"
      "  beta::shared B { value = 2 }\n"
      "}\n",
      "qualified.lp", library_dirs);
  INFO(format_diagnostics("qualified.lp", result.diagnostics));
  REQUIRE(result.ok);

  IrLoadResult loaded = load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());
  const auto* children = loaded.file.v2_root->root()->children();
  REQUIRE(children->Get(0)->semantics()->library()->str() == "alpha");
  REQUIRE(children->Get(0)->semantics()->block()->str() == "shared");
  REQUIRE(children->Get(1)->semantics()->library()->str() == "beta");
  REQUIRE(children->Get(1)->semantics()->block()->str() == "shared");

  const CompileResult ambiguous =
      compile_source("model Ambiguous { use alpha use beta shared X { value = 1 } }",
                     "ambiguous.lp", library_dirs);
  REQUIRE_FALSE(ambiguous.ok);
  REQUIRE(std::any_of(ambiguous.diagnostics.begin(), ambiguous.diagnostics.end(),
                      [](const Diagnostic& d) { return d.code == "LP2013"; }));
}

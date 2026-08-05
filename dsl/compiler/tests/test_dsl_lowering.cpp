// IR lowering tests: DSL -> v2 ModelFile buffer -> ir_loader acceptance,
// plus structural-dump goldens (FlatBuffers bytes are order-sensitive, so
// the golden compares the deterministic text rendering).
#include <cstdint>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "expect_json.h"  // read_text_file
#include "golden.h"
#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/ir_dump.h"

using namespace logicpilot;
using namespace logicpilot::dsl;
namespace v2 = logicpilot::ir::v2;

namespace {

constexpr const char* kGoldenDir = LOGICPILOT_DSL_GOLDEN_DIR;
constexpr const char* kMm1Path = LOGICPILOT_EXAMPLES_DIR "/mm1.lp";

// Note: return the whole IrLoadResult - IrModelFile.v2_root is a zero-copy
// pointer into IrModelFile.v2_bytes, so moving the struct alone would dangle.
IrLoadResult compile_and_load(const std::string& source,
                              const std::string& path) {
  const CompileResult result = compile_source(source, path);
  REQUIRE(result.ok);
  IrLoadResult loaded =
      load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("lowering: mm1.lp produces a valid v2 ModelFile", "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  REQUIRE(!source.empty());

  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  REQUIRE(result.model_name == "MM1");

  IrLoadResult loaded =
      load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
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
  REQUIRE(root->children()->Get(0)->semantics()->block()->str() ==
          "resource");
  REQUIRE(root->children()->Get(1)->semantics()->block()->str() == "source");
  REQUIRE(root->children()->Get(2)->semantics()->block()->str() == "queue");
  REQUIRE(root->children()->Get(3)->semantics()->block()->str() == "service");
  REQUIRE(root->children()->Get(4)->semantics()->block()->str() == "sink");
  REQUIRE(root->couplings() != nullptr);
  REQUIRE(root->couplings()->size() == 3);

  // Structural dump golden.
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/mm1_ir_dump.txt",
                         dump_ir(loaded.file));
}

TEST_CASE("lowering: flat process blocks keep declaration order and couples",
          "[dsl][lowering]") {
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
  REQUIRE(root->children()->Get(3)->semantics()->block()->str() ==
          "service");

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

TEST_CASE("lowering: constant service time maps to Constant distribution",
          "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model C {\n"
      "  resource R { capacity = 1 }\n"
      "  source A { arrival = poisson(2) }\n"
      "  service S { resource = R; time = constant(1.25) }\n"
      "}\n",
      "const.lp");
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/const_ir_dump.txt",
                         dump_ir(loaded.file));
}

TEST_CASE("lowering: explicit resource reference decouples the service "
          "name from the resource", "[dsl][lowering]") {
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

TEST_CASE("lowering: expressions and parameter references fold before the "
          "IR", "[dsl][lowering]") {
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

TEST_CASE("lowering: ir_loader consumes the DSL output end to end",
          "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  IrLoadResult loaded =
      load_model_buffer(result.v2_bytes.data(), result.v2_bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
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

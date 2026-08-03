// IR lowering tests: DSL -> ModelFile buffer -> ir_loader acceptance, plus
// a structural-dump golden (FlatBuffers bytes are order-sensitive, so the
// golden compares the deterministic text rendering).
#include <cstdint>
#include <string>
#include <vector>

#include <catch2/catch_test_macros.hpp>

#include "golden.h"
#include "ir_generated.h"  // flatc-generated IR view (F1)
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/ir_dump.h"
#include "expect_json.h"  // read_text_file

using namespace logicpilot;
using namespace logicpilot::dsl;

namespace {

constexpr const char* kGoldenDir = LOGICPILOT_DSL_GOLDEN_DIR;
constexpr const char* kMm1Path = LOGICPILOT_EXAMPLES_DIR "/mm1.lp";

// Note: return the whole IrLoadResult - IrModelFile.root is a zero-copy
// pointer into IrModelFile.bytes, so moving the struct alone would dangle.
IrLoadResult compile_and_load(const std::string& source,
                              const std::string& path) {
  const CompileResult result = compile_source(source, path);
  REQUIRE(result.ok);
  IrLoadResult loaded =
      load_model_buffer(result.ir_bytes.data(), result.ir_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("lowering: mm1.lp produces a valid ModelFile", "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  REQUIRE(!source.empty());

  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  REQUIRE(result.model_name == "MM1");

  IrLoadResult loaded =
      load_model_buffer(result.ir_bytes.data(), result.ir_bytes.size());
  REQUIRE(loaded.ok());
  REQUIRE(loaded.file.root->schema_version() == 1);
  REQUIRE(loaded.file.root->root() != nullptr);
  REQUIRE(loaded.file.root->root()->kind_type() ==
          ir::ModelKind_CoupledModel);

  const ir::CoupledModel* coupled =
      loaded.file.root->root()->kind_as_CoupledModel();
  REQUIRE(coupled->metadata()->name()->str() == "MM1");
  // One resource (AtomicModel) + one process (ProcessModel).
  REQUIRE(coupled->children()->size() == 2);
  REQUIRE(coupled->children()->Get(0)->kind_type() ==
          ir::ModelKind_AtomicModel);
  REQUIRE(coupled->children()->Get(1)->kind_type() ==
          ir::ModelKind_ProcessModel);

  // Structural dump golden.
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/mm1_ir_dump.txt",
                         dump_ir(loaded.file));
}

TEST_CASE("lowering: process nodes keep declaration order and chain",
          "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model Demo {\n"
      "  resource Server { capacity = 2 failure_rate = 0.25 }\n"
      "  process Flow {\n"
      "    source In { arrival = poisson(1.5) }\n"
      "    queue Buf { capacity = 7 }\n"
      "    service Server { time = normal(3, 0.5) }\n"
      "  }\n"
      "}\n",
      "demo.lp");

  const ir::CoupledModel* coupled =
      loaded.file.root->root()->kind_as_CoupledModel();
  const ir::ProcessModel* process =
      coupled->children()->Get(1)->kind_as_ProcessModel();
  REQUIRE(process->nodes()->size() == 3);
  REQUIRE(process->nodes()->Get(0)->name()->str() == "In");
  REQUIRE(process->nodes()->Get(1)->name()->str() == "Buf");
  REQUIRE(process->nodes()->Get(2)->name()->str() == "Server");
  REQUIRE(process->nodes()->Get(0)->kind_type() ==
          ir::ProcessNodeKind_SourceNode);
  REQUIRE(process->nodes()->Get(0)->kind_as_SourceNode()->arrival()->kind() ==
          ir::DistributionKind_Poisson);
  REQUIRE(process->nodes()->Get(1)->kind_as_QueueNode()->capacity() == 7);
  const ir::ServiceNode* service =
      process->nodes()->Get(2)->kind_as_ServiceNode();
  REQUIRE(service->resource()->str() == "Server");
  REQUIRE(service->servers() == 2);  // inherited from resource capacity
  REQUIRE(service->service_time()->kind() == ir::DistributionKind_Normal);

  // Chain couplings: In.out -> Buf.in, Buf.out -> Server.in.
  REQUIRE(process->couplings()->size() == 2);
  REQUIRE(process->couplings()->Get(0)->from_model()->str() == "In");
  REQUIRE(process->couplings()->Get(0)->to_model()->str() == "Buf");
  REQUIRE(process->couplings()->Get(1)->from_model()->str() == "Buf");
  REQUIRE(process->couplings()->Get(1)->to_model()->str() == "Server");

  // Resource lowered as a passive AtomicModel with the parameter table.
  const ir::AtomicModel* resource =
      coupled->children()->Get(0)->kind_as_AtomicModel();
  REQUIRE(resource->metadata()->name()->str() == "Server");
  REQUIRE(resource->ta()->kind() == ir::TimeAdvanceKind_Infinite);
  REQUIRE(resource->params()->size() == 2);
}

TEST_CASE("lowering: constant service time maps to Constant distribution",
          "[dsl][lowering]") {
  const IrLoadResult loaded = compile_and_load(
      "model C {\n"
      "  resource R { capacity = 1 }\n"
      "  process P {\n"
      "    source A { arrival = poisson(2) }\n"
      "    service R { time = constant(1.25) }\n"
      "  }\n"
      "}\n",
      "const.lp");
  REQUIRE_MATCHES_GOLDEN(std::string(kGoldenDir) + "/const_ir_dump.txt",
                         dump_ir(loaded.file));
}

TEST_CASE("lowering: ir_loader consumes the DSL output end to end",
          "[dsl][lowering]") {
  const std::string source = logicpilot::testing::read_text_file(kMm1Path);
  const CompileResult result = compile_source(source, "examples/mm1.lp");
  REQUIRE(result.ok);
  IrLoadResult loaded =
      load_model_buffer(result.ir_bytes.data(), result.ir_bytes.size());
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

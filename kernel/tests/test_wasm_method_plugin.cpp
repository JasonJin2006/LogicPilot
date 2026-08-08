#include <flatbuffers/flatbuffers.h>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <string>
#include <vector>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "logicpilot/runtime/wasm_method_plugin.h"

#include "ir_v2_generated.h"

using namespace logicpilot;
using Catch::Approx;
namespace v2 = logicpilot::ir::v2;

namespace {

IrLoadResult wasm_model() {
  flatbuffers::FlatBufferBuilder builder;
  const auto root = v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString("WASM test"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("wasm_test_method"),
                             builder.CreateString("model"), builder.CreateString("1"), 0),
      0, 0, 0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return load_model_buffer(builder.GetBufferPointer(), builder.GetSize());
}

}  // namespace

TEST_CASE("WASM plugin executes in Wasmtime and participates in the shared queue") {
  REQUIRE(wasm_method_host_available());
  MethodRegistry& registry = MethodRegistry::instance();
  if (!registry.contains("wasm_test_method")) {
    MethodPluginManifest manifest{
        "test.wasm",      "wasm_test_method",    "1.0.0", {"1"}, PluginRuntimeKind::kWasm,
        "lp_abi_version", TEST_WASM_PLUGIN_PATH, {}};
    std::string error;
    REQUIRE(load_wasm_method_plugin(manifest, std::filesystem::path{}, registry, &error));
    REQUIRE(error.empty());
  }
  IrLoadResult loaded = wasm_model();
  REQUIRE(loaded.ok());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));
  const auto metrics = kernel.run(ReplicationConfig{91, 5, 0}, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  CHECK(metrics.front().arrivals == 5);
  CHECK(metrics.front().departures == 5);
  CHECK(metrics.front().horizon_seconds == Approx(5e-9));
  CHECK(metrics.front().final_value == Approx(5.0));
  const VariableValue* value = kernel.variables().get("wasm_test_method::value");
  REQUIRE(value != nullptr);
  CHECK(std::get<double>(*value) == Approx(5.0));
}

#include <flatbuffers/flatbuffers.h>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/dynamic_method_plugin.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/simulation_kernel.h"

#include "ir_v2_generated.h"

using namespace logicpilot;
using Catch::Approx;
namespace v2 = logicpilot::ir::v2;

namespace {

IrLoadResult plugin_model() {
  flatbuffers::FlatBufferBuilder builder;
  const auto root = v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString("C ABI test"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("cabi_test_method"),
                             builder.CreateString("model"), builder.CreateString("1"), 0),
      0, 0, 0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return load_model_buffer(builder.GetBufferPointer(), builder.GetSize());
}

MethodPluginManifest manifest() {
  return MethodPluginManifest{"test.cabi",
                              "cabi_test_method",
                              "1.0.0",
                              {"1"},
                              PluginRuntimeKind::kCAbi,
                              "logicpilot_test_method_v1",
                              TEST_CABI_PLUGIN_PATH,
                              {}};
}

}  // namespace

TEST_CASE("stable C ABI plugin is loaded and runs on the shared scheduler") {
  MethodRegistry& registry = MethodRegistry::instance();
  if (!registry.contains("cabi_test_method")) {
    std::string error;
    REQUIRE(load_dynamic_method_plugin(manifest(), std::filesystem::path{}, registry, &error));
    REQUIRE(error.empty());
  }

  IrLoadResult loaded = plugin_model();
  REQUIRE(loaded.ok());
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));
  const auto metrics = kernel.run(ReplicationConfig{17, 4, 0}, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  CHECK(metrics.front().arrivals == 4);
  CHECK(metrics.front().departures == 4);
  CHECK(metrics.front().horizon_seconds == Approx(4e-9));
  CHECK(metrics.front().final_value == Approx(4.0));
  const VariableValue* count = kernel.variables().get("cabi::count");
  REQUIRE(count != nullptr);
  CHECK(std::get<double>(*count) == Approx(4.0));
}

TEST_CASE("C ABI loader rejects a missing entrypoint") {
  MethodPluginManifest bad = manifest();
  bad.method = "cabi_missing_entrypoint";
  bad.entrypoint = "does_not_exist";
  std::string error;
  CHECK_FALSE(
      load_dynamic_method_plugin(bad, std::filesystem::path{}, MethodRegistry::instance(), &error));
  CHECK(error.find("MP1104") != std::string::npos);
}

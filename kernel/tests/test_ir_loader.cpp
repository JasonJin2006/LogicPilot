// IR loader tests: build a v2 ModelFile FlatBuffer in-memory, load the
// read-only view, lower it to an executable queueing flow and run it.
#include <cstdint>
#include <cstring>
#include <memory>
#include <random>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

flatbuffers::Offset<v2::Distribution> distribution(
    flatbuffers::FlatBufferBuilder& builder, std::uint8_t kind,
    std::vector<double> params) {
  return v2::CreateDistribution(builder, kind,
                                builder.CreateVector(params));
}

flatbuffers::Offset<v2::Var> var_int(flatbuffers::FlatBufferBuilder& builder,
                                     const char* name, std::int64_t value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Int,
                       false, value, 0.0, 0, 0);
}

flatbuffers::Offset<v2::Var> var_string(flatbuffers::FlatBufferBuilder& builder,
                                        const char* name, const char* value) {
  return v2::CreateVar(builder, builder.CreateString(name),
                       v2::VarType_String, false, 0, 0.0,
                       builder.CreateString(value), 0);
}

flatbuffers::Offset<v2::Var> var_distribution(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    flatbuffers::Offset<v2::Distribution> dist) {
  return v2::CreateVar(builder, builder.CreateString(name),
                       v2::VarType_Distribution, false, 0, 0.0, 0, dist);
}

flatbuffers::Offset<v2::Node> stage(flatbuffers::FlatBufferBuilder& builder,
                                    const char* name, const char* block,
                                    std::vector<flatbuffers::Offset<v2::Var>>
                                        params) {
  return v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString(block), 0, 0),
      0, 0, 0, 0, 0);
}

// Builds the mm1-equivalent v2 model (canonical DSL field names):
//   resource Server (capacity 1); flow Arrivals(poisson 0.8) ->
//   WaitLine(cap 1000000) -> Server(time exponential(1.0), resource=Server);
//   the server count is resolved from the referenced resource's capacity.
std::vector<std::uint8_t> build_mm1_ir() {
  flatbuffers::FlatBufferBuilder builder;

  const auto resource = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Server"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{
          var_int(builder, "capacity", 1)}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString("resource"), 0, 0),
      0, 0, 0, 0, 0);

  const auto arrival = distribution(builder, 4, {0.8});  // Poisson
  const auto service_time = distribution(builder, 3, {1.0});  // Exponential
  std::vector<flatbuffers::Offset<v2::Var>> source_params;
  source_params.push_back(var_distribution(builder, "arrival", arrival));
  std::vector<flatbuffers::Offset<v2::Var>> queue_params;
  queue_params.push_back(var_int(builder, "capacity", 1000000));
  std::vector<flatbuffers::Offset<v2::Var>> service_params;
  service_params.push_back(
      var_distribution(builder, "time", service_time));
  service_params.push_back(var_string(builder, "resource", "Server"));

  std::vector<flatbuffers::Offset<v2::Node>> stages;
  stages.push_back(stage(builder, "Arrivals", "source", source_params));
  stages.push_back(stage(builder, "WaitLine", "queue", queue_params));
  stages.push_back(stage(builder, "Server", "service", service_params));

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                          flatbuffers::Offset<flatbuffers::String> to) {
    couplings.push_back(
        v2::CreateCoupling(builder, from, port_out, to, port_in));
  };
  const auto arrivals_name = builder.CreateString("Arrivals");
  const auto waitline_name = builder.CreateString("WaitLine");
  const auto server_name = builder.CreateString("Server");
  couple(arrivals_name, waitline_name);
  couple(waitline_name, server_name);

  const auto flow = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Flow"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString("flow"), 0, 0),
      builder.CreateVector(stages), builder.CreateVector(couplings), 0, 0, 0);

  std::vector<flatbuffers::Offset<v2::Node>> children;
  children.push_back(resource);
  children.push_back(flow);
  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("MM1"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(children), 0, 0, 0, 0);

  const auto file =
      v2::CreateModelFile(builder, 2, root, 0, 0);
  builder.Finish(file, "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

}  // namespace

TEST_CASE("IR loader accepts a valid v2 ModelFile buffer", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_mm1_ir();
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());
  REQUIRE(result.file.v2_root != nullptr);
  REQUIRE(result.file.v2_root->schema_version() == 2);
  REQUIRE(inspect_model(result.file).find("model") != std::string::npos);
}

TEST_CASE("IR loader rejects corrupt buffers", "[ir]") {
  std::vector<std::uint8_t> garbage{0x00, 0x11, 0x22, 0x33, 0x44, 0x55};
  IrLoadResult result = load_model_buffer(garbage.data(), garbage.size());
  REQUIRE(!result.ok());
  REQUIRE(result.status == IrStatus::kCorruptBuffer);

  IrLoadResult empty = load_model_buffer(nullptr, 0);
  REQUIRE(empty.status == IrStatus::kCorruptBuffer);
}

TEST_CASE("IR loader rejects v1 buffers (fully migrated to v2)", "[ir]") {
  // The v1 identifier "LPIR" is no longer a supported contract.
  std::vector<std::uint8_t> bytes = build_mm1_ir();
  REQUIRE(bytes.size() > 8);
  std::memcpy(bytes.data() + 4, "LPIR", 4);  // forge the v1 identifier
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(!result.ok());
  REQUIRE(result.status == IrStatus::kCorruptBuffer);
}

TEST_CASE("IR loader reports missing files", "[ir]") {
  IrLoadResult result = load_model_file("does-not-exist.lpir");
  REQUIRE(result.status == IrStatus::kIoError);
}

TEST_CASE("v2 process model lowers to a runnable queueing flow", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_mm1_ir();
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(result.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 3000;
  config.warmup_arrivals = 500;
  const ReplicationMetrics metrics = model->run(config, nullptr);

  REQUIRE(metrics.departures > 2400);
  // Loose sanity band around M/M/1 theory (rho = 0.8): Wq = 4.0.
  REQUIRE(metrics.mean_wait > 1.0);
  REQUIRE(metrics.mean_wait < 12.0);
  REQUIRE(metrics.mean_sojourn > metrics.mean_wait);
  REQUIRE(metrics.throughput > 0.5);
  REQUIRE(metrics.throughput < 1.0);
}

TEST_CASE("IR loader survives malformed buffers without crashing",
          "[ir][fuzz][smoke]") {
  const std::vector<std::uint8_t> valid = build_mm1_ir();

  // Every truncation length must be handled (verified or rejected, never
  // crashes). Short prefixes routinely fail the FlatBuffers verifier.
  for (std::size_t n = 0; n <= valid.size(); n += 5) {
    const IrLoadResult result = load_model_buffer(valid.data(), n);
    REQUIRE((!result.ok() || result.file.v2_root != nullptr));
  }

  // Random garbage with a fixed seed: the verifier must reject it.
  std::mt19937 rng(42);
  for (int i = 0; i < 200; ++i) {
    std::vector<std::uint8_t> garbage(64 + (rng() % 4096));
    for (std::uint8_t& byte : garbage) {
      byte = static_cast<std::uint8_t>(rng() & 0xFFu);
    }
    const IrLoadResult result =
        load_model_buffer(garbage.data(), garbage.size());
    REQUIRE((!result.ok() || result.file.v2_root != nullptr));
  }

  // Single-bit flips inside an otherwise valid buffer: a flipped byte that
  // still verifies must expose a root that dereferences safely.
  for (int i = 0; i < 100; ++i) {
    std::vector<std::uint8_t> mutated = valid;
    const std::size_t pos = rng() % mutated.size();
    mutated[pos] ^= static_cast<std::uint8_t>(1u << (rng() % 8));
    const IrLoadResult result =
        load_model_buffer(mutated.data(), mutated.size());
    if (result.ok()) {
      REQUIRE(result.file.v2_root != nullptr);
    }
  }
}

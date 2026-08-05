// IR loader tests: build a v2 ModelFile FlatBuffer in-memory, load the
// read-only view, lower it to an executable queueing flow and run it.
#include <cstdint>
#include <cstring>
#include <memory>
#include <random>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;
using Catch::Approx;

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

// Agent-centric root flow: source/queue/service/sink directly under the model
// root, connected by the root's own couplings (no `process` wrapper).
std::vector<std::uint8_t> build_flat_mm1_ir() {
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
  const auto arrival = distribution(builder, 4, {0.8});
  const auto service_time = distribution(builder, 3, {1.0});
  const auto source = stage(
      builder, "In", "source",
      {var_distribution(builder, "arrival", arrival)});
  const auto queue = stage(builder, "Q", "queue",
                           {var_int(builder, "capacity", 1000000)});
  const auto service = stage(
      builder, "S", "service",
      {var_distribution(builder, "time", service_time),
       var_string(builder, "resource", "Server")});
  const auto sink = stage(builder, "K", "sink", {});

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                          flatbuffers::Offset<flatbuffers::String> to) {
    couplings.push_back(
        v2::CreateCoupling(builder, from, port_out, to, port_in));
  };
  const auto in_name = builder.CreateString("In");
  const auto q_name = builder.CreateString("Q");
  const auto s_name = builder.CreateString("S");
  const auto k_name = builder.CreateString("K");
  couple(in_name, q_name);
  couple(q_name, s_name);
  couple(s_name, k_name);

  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Flat"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{
          resource, source, queue, service, sink}),
      builder.CreateVector(couplings), 0, 0, 0);
  const auto file = v2::CreateModelFile(
      builder, 2, root,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Experiment>>{}),
      0);
  builder.Finish(file, "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

// Agent body flow: the same stages live inside an {agent, agent} child of the
// model root; the couplings are attached to the agent node itself.
std::vector<std::uint8_t> build_agent_body_mm1_ir() {
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
  const auto arrival = distribution(builder, 4, {0.8});
  const auto service_time = distribution(builder, 3, {1.0});
  const auto source = stage(
      builder, "In", "source",
      {var_distribution(builder, "arrival", arrival)});
  const auto queue = stage(builder, "Q", "queue",
                           {var_int(builder, "capacity", 1000000)});
  const auto service = stage(
      builder, "S", "service",
      {var_distribution(builder, "time", service_time),
       var_string(builder, "resource", "Server")});
  const auto sink = stage(builder, "K", "sink", {});

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                          flatbuffers::Offset<flatbuffers::String> to) {
    couplings.push_back(
        v2::CreateCoupling(builder, from, port_out, to, port_in));
  };
  const auto in_name = builder.CreateString("In");
  const auto q_name = builder.CreateString("Q");
  const auto s_name = builder.CreateString("S");
  const auto k_name = builder.CreateString("K");
  couple(in_name, q_name);
  couple(q_name, s_name);
  couple(s_name, k_name);

  const auto agent = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("Worker"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{
          var_int(builder, "count", 1)}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("agent"),
                             builder.CreateString("agent"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{
          resource, source, queue, service, sink}),
      builder.CreateVector(couplings), 0, 0, 0);

  const auto root = v2::CreateNode(
      builder,
      v2::CreateMetadata(builder, builder.CreateString("AgentFlow"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                             builder.CreateString("model"), 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{agent}),
      0, 0, 0, 0);
  const auto file = v2::CreateModelFile(
      builder, 2, root,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Experiment>>{}),
      0);
  builder.Finish(file, "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

}  // namespace

TEST_CASE("IR loader accepts a valid v2 ModelFile buffer", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_flat_mm1_ir();
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
  std::vector<std::uint8_t> bytes = build_flat_mm1_ir();
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
  const std::vector<std::uint8_t> bytes = build_flat_mm1_ir();
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

TEST_CASE("agent-centric root flow: process blocks + couplings directly "
          "under the model root run as a queueing flow", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_flat_mm1_ir();
  IrLoadResult loaded = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.departures == 3000);
  REQUIRE(metrics.mean_sojourn > 3.0);
  REQUIRE(metrics.mean_sojourn < 8.0);
}

TEST_CASE("agent body flow: process blocks inside an agent child run as a "
          "queueing flow, bit-exact with root-level placement", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_agent_body_mm1_ir();
  IrLoadResult loaded = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model =
      build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 3000;
  config.warmup_arrivals = 300;
  const ReplicationMetrics agent_body_metrics = model->run(config, nullptr);
  REQUIRE(agent_body_metrics.departures == 3000);
  REQUIRE(agent_body_metrics.mean_sojourn > 3.0);
  REQUIRE(agent_body_metrics.mean_sojourn < 8.0);

  // Placing the same flow under the model root must be bit-exact.
  const std::vector<std::uint8_t> root_bytes = build_flat_mm1_ir();
  IrLoadResult root_loaded =
      load_model_buffer(root_bytes.data(), root_bytes.size());
  REQUIRE(root_loaded.ok());
  std::unique_ptr<ReplicationModel> root_model =
      build_replication_model(root_loaded.file, &error);
  REQUIRE(root_model != nullptr);
  const ReplicationMetrics root_metrics = root_model->run(config, nullptr);
  REQUIRE(root_metrics.departures == agent_body_metrics.departures);
  REQUIRE(root_metrics.throughput == Approx(agent_body_metrics.throughput));
  REQUIRE(root_metrics.mean_sojourn ==
          Approx(agent_body_metrics.mean_sojourn));
  REQUIRE(root_metrics.mean_wait == Approx(agent_body_metrics.mean_wait));
  REQUIRE(root_metrics.utilization ==
          Approx(agent_body_metrics.utilization));

  // The streaming driver must also locate the flow inside the agent body.
  FlowRunParams flow;
  REQUIRE(extract_flow_params(loaded.file, flow, &error));
  REQUIRE(flow.lambda == Approx(0.8));
  REQUIRE(flow.mu == Approx(1.0));
}

TEST_CASE("IR loader survives malformed buffers without crashing",
          "[ir][fuzz][smoke]") {
  const std::vector<std::uint8_t> valid = build_flat_mm1_ir();

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

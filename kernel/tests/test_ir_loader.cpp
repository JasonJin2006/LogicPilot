// IR loader tests: build a ModelFile FlatBuffer in-memory, load the
// read-only view, lower it to an executable queueing flow and run it.
#include <cstdint>
#include <memory>
#include <vector>

#include <catch2/catch_test_macros.hpp>
#include <flatbuffers/flatbuffers.h>

#include "ir_generated.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"

using namespace logicpilot;

namespace {

// Builds the mm1-equivalent ProcessModel:
//   Arrivals(poisson 0.8) -> WaitLine(cap 1000000) -> Server(exp 1.0) -> End
std::vector<std::uint8_t> build_mm1_ir() {
  flatbuffers::FlatBufferBuilder builder;

  const auto arrival_dist = ir::CreateDistribution(
      builder, ir::DistributionKind_Poisson,
      builder.CreateVector(std::vector<double>{0.8}));
  const auto service_dist = ir::CreateDistribution(
      builder, ir::DistributionKind_Exponential,
      builder.CreateVector(std::vector<double>{1.0}));

  const auto source_name = builder.CreateString("Arrivals");
  const auto source_node =
      ir::CreateSourceNode(builder, arrival_dist, -1).Union();
  const auto queue_name = builder.CreateString("WaitLine");
  const auto queue_node =
      ir::CreateQueueNode(builder, 1000000, ir::QueueDiscipline_Fifo).Union();
  const auto service_name = builder.CreateString("Server");
  const auto service_node =
      ir::CreateServiceNode(builder, service_dist, 0, 1).Union();
  const auto sink_name = builder.CreateString("End");
  const auto sink_node = ir::CreateSinkNode(builder).Union();

  std::vector<flatbuffers::Offset<ir::ProcessNode>> nodes;
  nodes.push_back(ir::CreateProcessNode(builder, source_name,
                                        ir::ProcessNodeKind_SourceNode,
                                        source_node));
  nodes.push_back(ir::CreateProcessNode(builder, queue_name,
                                        ir::ProcessNodeKind_QueueNode,
                                        queue_node));
  nodes.push_back(ir::CreateProcessNode(builder, service_name,
                                        ir::ProcessNodeKind_ServiceNode,
                                        service_node));
  nodes.push_back(ir::CreateProcessNode(builder, sink_name,
                                        ir::ProcessNodeKind_SinkNode,
                                        sink_node));

  std::vector<flatbuffers::Offset<ir::Coupling>> couplings;
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                          flatbuffers::Offset<flatbuffers::String> to) {
    couplings.push_back(
        ir::CreateCoupling(builder, from, port_out, to, port_in));
  };
  couple(source_name, queue_name);
  couple(queue_name, service_name);
  couple(service_name, sink_name);

  const auto metadata_name = builder.CreateString("MM1");
  const auto metadata = ir::CreateMetadata(builder, metadata_name);
  const auto process = ir::CreateProcessModel(
      builder, metadata, builder.CreateVector(nodes),
      builder.CreateVector(couplings));

  const auto root_model =
      ir::CreateModel(builder, ir::ModelKind_ProcessModel, process.Union());
  const auto file = ir::CreateModelFile(builder, 1, root_model);
  builder.Finish(file, "LPIR");

  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() +
                                       builder.GetSize());
}

}  // namespace

TEST_CASE("IR loader accepts a valid ModelFile buffer", "[ir]") {
  const std::vector<std::uint8_t> bytes = build_mm1_ir();
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());
  REQUIRE(result.file.root != nullptr);
  REQUIRE(result.file.root->schema_version() == 1);
  REQUIRE(inspect_model(result.file).find("ProcessModel") !=
          std::string::npos);
}

TEST_CASE("IR loader rejects corrupt buffers", "[ir]") {
  std::vector<std::uint8_t> garbage{0x00, 0x11, 0x22, 0x33, 0x44, 0x55};
  IrLoadResult result = load_model_buffer(garbage.data(), garbage.size());
  REQUIRE(!result.ok());
  REQUIRE(result.status == IrStatus::kCorruptBuffer);

  IrLoadResult empty = load_model_buffer(nullptr, 0);
  REQUIRE(empty.status == IrStatus::kCorruptBuffer);
}

TEST_CASE("IR loader reports missing files", "[ir]") {
  IrLoadResult result = load_model_file("does-not-exist.lpir");
  REQUIRE(result.status == IrStatus::kIoError);
}

TEST_CASE("ProcessModel IR lowers to a runnable queueing flow", "[ir]") {
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

// C++ side of the F1/F2 schema interop test.
//
// Builds one v2 ModelFile (schemas/ir_v2.fbs) carrying a core/model Node
// with Atomic + Process + Agent children, plus one Counters frame
// (wire.fbs, F2), and writes both buffers to <outdir>/model_v2.bin and
// <outdir>/counters_frame.bin. The Node side of the test
// (web/packages/protocol/test/verify-interop.mjs) parses the same bytes with
// the TypeScript runtime and asserts field-by-field equality.
//
// The values below are duplicated in the verifier; keep them in sync.

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

#include "ir_v2_generated.h"
#include "wire_generated.h"

namespace fs = std::filesystem;
namespace v2 = logicpilot::ir::v2;
namespace wire = logicpilot::wire;

namespace {

using ::flatbuffers::FlatBufferBuilder;
using ::flatbuffers::Offset;

Offset<v2::Distribution> MakeDistributionV2(FlatBufferBuilder& fbb, std::uint8_t kind,
                                            std::vector<double> params) {
  return v2::CreateDistribution(fbb, kind, fbb.CreateVector(params));
}

bool WriteBuffer(const fs::path& path, const flatbuffers::FlatBufferBuilder& fbb) {
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  if (!out) {
    std::cerr << "cannot open " << path << " for writing\n";
    return false;
  }
  out.write(reinterpret_cast<const char*>(fbb.GetBufferPointer()),
            static_cast<std::streamsize>(fbb.GetSize()));
  return out.good();
}

// ---------------------------------------------------------------------------
// F2: Counters wire frame
// ---------------------------------------------------------------------------
flatbuffers::Offset<wire::Frame> BuildCountersFrame(flatbuffers::FlatBufferBuilder& fbb) {
  const auto header = wire::CreateFrameHeader(fbb, /*version=*/1, /*seq=*/7,
                                              /*sim_time_ns=*/1500000000, wire::FrameKind_Counters);
  const std::vector<Offset<wire::Counter>> values{
      wire::CreateCounterDirect(fbb, "arrival_rate", 2.0),
      wire::CreateCounterDirect(fbb, "service_rate", 3.0),
      wire::CreateCounterDirect(fbb, "utilization", 2.0 / 3.0),
      wire::CreateCounterDirect(fbb, "entities_served", 1234.0),
  };
  const auto counters = wire::CreateCountersDirect(fbb, &values);
  return wire::CreateFrame(fbb, header, wire::FramePayload_Counters, counters.Union());
}

// ---------------------------------------------------------------------------
// F3: the same model as the IR v2 contract (thin Node / SemanticsRef)
// ---------------------------------------------------------------------------
flatbuffers::Offset<v2::Node> BuildAtomicV2(FlatBufferBuilder& fbb) {
  const auto meta = v2::CreateMetadata(fbb, fbb.CreateString("Server"), fbb.CreateString("1"),
                                       fbb.CreateString("scripts/interop/writer.cpp"), 0);
  const auto busy =
      v2::CreateVar(fbb, fbb.CreateString("busy"), v2::VarType_Bool, false, 0, 0.0, 0, 0);
  const std::vector<Offset<v2::Var>> state{busy};
  const std::vector<Offset<v2::Port>> ports{
      v2::CreatePort(fbb, fbb.CreateString("job_in"), v2::PortDirection_Input,
                     fbb.CreateString("Job")),
      v2::CreatePort(fbb, fbb.CreateString("job_out"), v2::PortDirection_Output,
                     fbb.CreateString("Job")),
  };
  const auto active = fbb.CreateString("active");
  const std::vector<Offset<v2::State>> states{v2::CreateState(fbb, active)};
  const std::vector<Offset<v2::Transition>> transitions{
      v2::CreateTransition(fbb, active, active, v2::TriggerKind_Message, 0.0, 0, 0.0,
                           fbb.CreateString("job_in"), 0, 0),
      v2::CreateTransition(fbb, active, active, v2::TriggerKind_Timeout, 0.0,
                           MakeDistributionV2(fbb, 3, {3.0}), 0.0, 0, 0, 0),
  };
  const auto statechart =
      v2::CreateStatechart(fbb, fbb.CreateVector(states), fbb.CreateVector(transitions), active);
  const auto semantics =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("devs"), fbb.CreateString("atomic"), 0, 0);
  return v2::CreateNode(fbb, meta, fbb.CreateVector(state), 0, fbb.CreateVector(ports), semantics,
                        0, 0, statechart, 0, 0);
}

flatbuffers::Offset<v2::Node> BuildProcessV2(FlatBufferBuilder& fbb) {
  const auto meta = v2::CreateMetadata(fbb, fbb.CreateString("Arrivals"), fbb.CreateString("1"),
                                       fbb.CreateString("scripts/interop/writer.cpp"), 0);
  const auto source_params = std::vector<Offset<v2::Var>>{
      v2::CreateVar(fbb, fbb.CreateString("arrival"), v2::VarType_Distribution, false, 0, 0.0, 0,
                    MakeDistributionV2(fbb, 4, {2.0})),
  };
  const auto source_sem =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("process"), fbb.CreateString("source"), 0, 0);
  const auto source =
      v2::CreateNode(fbb,
                     v2::CreateMetadata(fbb, fbb.CreateString("Clients"), fbb.CreateString("1"),
                                        fbb.CreateString("scripts/interop/writer.cpp"), 0),
                     0, fbb.CreateVector(source_params), 0, source_sem, 0, 0, 0, 0, 0);

  const auto queue_params = std::vector<Offset<v2::Var>>{
      v2::CreateVar(fbb, fbb.CreateString("capacity"), v2::VarType_Int, false, 0, 0.0, 0, 0),
  };
  const auto queue_sem =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("process"), fbb.CreateString("queue"), 0, 0);
  const auto queue =
      v2::CreateNode(fbb,
                     v2::CreateMetadata(fbb, fbb.CreateString("WaitLine"), fbb.CreateString("1"),
                                        fbb.CreateString("scripts/interop/writer.cpp"), 0),
                     0, fbb.CreateVector(queue_params), 0, queue_sem, 0, 0, 0, 0, 0);

  const auto service_params = std::vector<Offset<v2::Var>>{
      v2::CreateVar(fbb, fbb.CreateString("rate"), v2::VarType_Distribution, false, 0, 0.0, 0,
                    MakeDistributionV2(fbb, 3, {3.0})),
      v2::CreateVar(fbb, fbb.CreateString("resource"), v2::VarType_String, false, 0, 0.0,
                    fbb.CreateString("Server"), 0),
      v2::CreateVar(fbb, fbb.CreateString("servers"), v2::VarType_Int, false, 1, 0.0, 0, 0),
  };
  const auto service_sem =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("process"), fbb.CreateString("service"), 0, 0);
  const auto service =
      v2::CreateNode(fbb,
                     v2::CreateMetadata(fbb, fbb.CreateString("Server"), fbb.CreateString("1"),
                                        fbb.CreateString("scripts/interop/writer.cpp"), 0),
                     0, fbb.CreateVector(service_params), 0, service_sem, 0, 0, 0, 0, 0);

  const std::vector<Offset<v2::Node>> children{source, queue, service};
  const std::vector<Offset<v2::Coupling>> couplings{
      v2::CreateCoupling(fbb, fbb.CreateString("Clients"), fbb.CreateString("out"),
                         fbb.CreateString("WaitLine"), fbb.CreateString("in")),
      v2::CreateCoupling(fbb, fbb.CreateString("WaitLine"), fbb.CreateString("out"),
                         fbb.CreateString("Server"), fbb.CreateString("in")),
  };
  const auto flow_sem =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("process"), fbb.CreateString("flow"), 0, 0);
  return v2::CreateNode(fbb, meta, 0, 0, 0, flow_sem, fbb.CreateVector(children),
                        fbb.CreateVector(couplings), 0, 0, 0);
}

flatbuffers::Offset<v2::Node> BuildAgentV2(FlatBufferBuilder& fbb) {
  const auto meta = v2::CreateMetadata(fbb, fbb.CreateString("Observer"), fbb.CreateString("1"),
                                       fbb.CreateString("scripts/interop/writer.cpp"), 0);
  const std::vector<Offset<v2::BehaviorBinding>> behaviors{
      v2::CreateBehaviorBinding(fbb, fbb.CreateString("on_tick"),
                                fbb.CreateString("agent.observer.collect"), 0),
  };
  const auto semantics =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("agent"), fbb.CreateString("agent"), 0, 0);
  const std::vector<std::uint8_t> extension_bytes{0x4c, 0x50, 0x32};
  const std::vector<Offset<v2::ExtensionPayload>> extensions{
      v2::CreateExtensionPayload(fbb, fbb.CreateString("urn:logicpilot:test:interop"),
                                 /*schema_version=*/1, fbb.CreateString("application/octet-stream"),
                                 fbb.CreateVector(extension_bytes)),
  };
  return v2::CreateNode(fbb, meta, 0, 0, 0, semantics, 0, 0, 0, fbb.CreateVector(behaviors), 0,
                        fbb.CreateVector(extensions));
}

flatbuffers::Offset<v2::ModelFile> BuildModelFileV2(FlatBufferBuilder& fbb) {
  const std::vector<Offset<v2::Node>> children{BuildAtomicV2(fbb), BuildProcessV2(fbb),
                                               BuildAgentV2(fbb)};
  const auto root_meta =
      v2::CreateMetadata(fbb, fbb.CreateString("QueueDemo"), fbb.CreateString("1"),
                         fbb.CreateString("scripts/interop/writer.cpp"), 0);
  const auto root_sem =
      v2::CreateSemanticsRef(fbb, fbb.CreateString("core"), fbb.CreateString("model"), 0, 0);
  const auto root =
      v2::CreateNode(fbb, root_meta, 0, 0, 0, root_sem, fbb.CreateVector(children), 0, 0, 0, 0);
  const auto file_meta =
      v2::CreateMetadata(fbb, fbb.CreateString("interop-demo"), fbb.CreateString("1.0.0"),
                         fbb.CreateString("scripts/interop/writer.cpp"), 0);
  const std::vector<Offset<v2::VariationAxis>> axes{
      v2::CreateVariationAxis(fbb, fbb.CreateString("ArrivalRate"),
                              fbb.CreateString("arrival_rate"), 0.6, 1.0, 0.2),
      v2::CreateVariationAxis(fbb, fbb.CreateString("Servers"),
                              fbb.CreateString("server_count"), 1.0, 4.0, 1.0),
  };
  const auto experiment = v2::CreateExperiment(
      fbb, v2::ExperimentKind_ParameterVariation, fbb.CreateString("CapacityStudy"), 0, 0,
      fbb.CreateString("Wq"), 0.0, 0.0, 0, 4, 42, v2::SeedPolicy_Fixed,
      v2::ReplicationPolicy_Fixed, 5, 100, 0.95, 5.0, fbb.CreateString("Wq"),
      fbb.CreateVector(axes));
  return v2::CreateModelFile(fbb, 2, root, fbb.CreateVector(&experiment, 1), file_meta);
}

}  // namespace

int main(int argc, char** argv) {
  const fs::path out_dir = argc > 1 ? fs::path(argv[1]) : fs::current_path();
  std::error_code ec;
  fs::create_directories(out_dir, ec);
  if (ec) {
    std::cerr << "cannot create output dir " << out_dir << ": " << ec.message() << "\n";
    return 1;
  }

  {
    flatbuffers::FlatBufferBuilder fbb(1024);
    const auto frame = BuildCountersFrame(fbb);
    wire::FinishFrameBuffer(fbb, frame);
    const auto path = out_dir / "counters_frame.bin";
    if (!WriteBuffer(path, fbb))
      return 1;
    std::cout << "[writer] Counters   -> " << path.string() << " (" << fbb.GetSize() << " bytes)\n";
  }

  {
    flatbuffers::FlatBufferBuilder fbb(4096);
    const auto model_file = BuildModelFileV2(fbb);
    v2::FinishModelFileBuffer(fbb, model_file);
    const auto path = out_dir / "model_v2.bin";
    if (!WriteBuffer(path, fbb))
      return 1;
    std::cout << "[writer] ModelFileV2 -> " << path.string() << " (" << fbb.GetSize()
              << " bytes)\n";
  }

  std::cout << "[writer] OK\n";
  return 0;
}

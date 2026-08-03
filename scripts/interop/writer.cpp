// C++ side of the F1/F2 schema interop test.
//
// Builds one ModelFile (ir.fbs, F1) carrying a CoupledModel with an Atomic,
// a Process (mm1-style queueing flow) and an Agent child, plus one Counters
// frame (wire.fbs, F2), and writes both buffers to <outdir>/model_file.bin
// and <outdir>/counters_frame.bin. The Node side of the test
// (web/packages/protocol/test/verify-interop.mjs) parses the same bytes with
// the TypeScript runtime and asserts field-by-field equality.
//
// The values below are duplicated in the verifier; keep them in sync.

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

#include "ir_generated.h"
#include "wire_generated.h"

namespace fs = std::filesystem;
namespace ir = logicpilot::ir;
namespace wire = logicpilot::wire;

namespace {

using ::flatbuffers::FlatBufferBuilder;
using ::flatbuffers::Offset;

// Distribution helper (CreateDistributionDirect wants a vector pointer).
Offset<ir::Distribution> MakeDistribution(FlatBufferBuilder& fbb,
                                          ir::DistributionKind kind,
                                          std::vector<double> params) {
  return ir::CreateDistributionDirect(fbb, kind, &params);
}

bool WriteBuffer(const fs::path& path,
                 const flatbuffers::FlatBufferBuilder& fbb) {
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
// F1: ModelFile
// ---------------------------------------------------------------------------
flatbuffers::Offset<ir::ModelFile> BuildModelFile(
    flatbuffers::FlatBufferBuilder& fbb) {
  // File-level metadata + params (seed=42, horizon=100.0).
  const auto file_meta = ir::CreateMetadataDirect(
      fbb, "interop-demo", "1.0.0", "scripts/interop/writer.cpp", 0);
  const auto seed_param =
      ir::CreateParam(fbb, fbb.CreateString("seed"), ir::ParamValue_IntValue,
                      ir::CreateIntValue(fbb, 42).Union());
  const auto horizon_param = ir::CreateParam(
      fbb, fbb.CreateString("horizon"), ir::ParamValue_FloatValue,
      ir::CreateFloatValue(fbb, 100.0).Union());
  const std::vector<Offset<ir::Param>> file_params{seed_param, horizon_param};

  // ---- child 1: DEVS atomic server ------------------------------------
  const auto server_meta = ir::CreateMetadataDirect(
      fbb, "Server", "1", "scripts/interop/writer.cpp", 0);
  const auto busy_param =
      ir::CreateParam(fbb, fbb.CreateString("busy"), ir::ParamValue_BoolValue,
                      ir::CreateBoolValue(fbb, false).Union());
  const std::vector<Offset<ir::Param>> server_state{busy_param};

  const auto exp3 =
      MakeDistribution(fbb, ir::DistributionKind_Exponential, {3.0});
  const auto ta = ir::CreateTimeAdvance(
      fbb, ir::TimeAdvanceKind_Distribution, 0.0, exp3, 0);
  const auto delta_ext = ir::CreateTransitionSpecDirect(
      fbb, "accept a job when idle", "job_in", "", "atomic.server.on_job",
      nullptr);
  const auto delta_int = ir::CreateTransitionSpecDirect(
      fbb, "finish the current job", "", "job_out", "atomic.server.on_done",
      nullptr);
  const auto in_port =
      ir::CreatePortDirect(fbb, "job_in", ir::PortDirection_Input, "Job");
  const auto out_port =
      ir::CreatePortDirect(fbb, "job_out", ir::PortDirection_Output, "Job");
  const std::vector<Offset<ir::Port>> in_ports{in_port};
  const std::vector<Offset<ir::Port>> out_ports{out_port};

  const auto atomic = ir::CreateAtomicModelDirect(
      fbb, server_meta, &server_state, ta, delta_ext, delta_int, &in_ports,
      &out_ports, nullptr);
  const auto atomic_model =
      ir::CreateModel(fbb, ir::ModelKind_AtomicModel, atomic.Union());

  // ---- child 2: mm1-style process (source -> queue -> service -> sink) -
  const auto proc_meta = ir::CreateMetadataDirect(
      fbb, "Arrivals", "1", "scripts/interop/writer.cpp", 0);

  const auto poisson2 =
      MakeDistribution(fbb, ir::DistributionKind_Poisson, {2.0});
  const auto source = ir::CreateSourceNode(fbb, poisson2, -1);
  const auto node_source = ir::CreateProcessNode(
      fbb, fbb.CreateString("Clients"), ir::ProcessNodeKind_SourceNode,
      source.Union());

  const auto queue = ir::CreateQueueNode(fbb, 0, ir::QueueDiscipline_Fifo);
  const auto node_queue = ir::CreateProcessNode(
      fbb, fbb.CreateString("WaitLine"), ir::ProcessNodeKind_QueueNode,
      queue.Union());

  const auto exp3_service =
      MakeDistribution(fbb, ir::DistributionKind_Exponential, {3.0});
  const auto service = ir::CreateServiceNode(
      fbb, exp3_service, fbb.CreateString("Server"), 1);
  const auto node_service = ir::CreateProcessNode(
      fbb, fbb.CreateString("Server"), ir::ProcessNodeKind_ServiceNode,
      service.Union());

  const auto sink = ir::CreateSinkNode(fbb);
  const auto node_sink =
      ir::CreateProcessNode(fbb, fbb.CreateString("Done"),
                            ir::ProcessNodeKind_SinkNode, sink.Union());

  const std::vector<Offset<ir::ProcessNode>> nodes{
      node_source, node_queue, node_service, node_sink};

  const auto c1 = ir::CreateCouplingDirect(fbb, "Clients", "out", "WaitLine",
                                           "in");
  const auto c2 = ir::CreateCouplingDirect(fbb, "WaitLine", "out", "Server",
                                           "in");
  const auto c3 =
      ir::CreateCouplingDirect(fbb, "Server", "out", "Done", "in");
  const std::vector<Offset<ir::Coupling>> couplings{c1, c2, c3};

  const auto process = ir::CreateProcessModelDirect(fbb, proc_meta, &nodes,
                                                    &couplings, nullptr);
  const auto process_model =
      ir::CreateModel(fbb, ir::ModelKind_ProcessModel, process.Union());

  // ---- child 3: ABM agent ----------------------------------------------
  const auto agent_meta = ir::CreateMetadataDirect(
      fbb, "Observer", "1", "scripts/interop/writer.cpp", 0);
  const auto comp = ir::CreateAgentComponentDirect(fbb, "sensor",
                                                   "radius-sensor", nullptr);
  const std::vector<Offset<ir::AgentComponent>> components{comp};
  const auto behavior = ir::CreateBehaviorDirect(
      fbb, "collect", "on_tick", "agent.observer.collect", nullptr);
  const std::vector<Offset<ir::Behavior>> behaviors{behavior};
  const auto sm = ir::CreateStateMachineRefDirect(fbb, "ObserverFSM", "idle",
                                                  nullptr);
  const auto agent = ir::CreateAgentModelDirect(fbb, agent_meta, &components,
                                                &behaviors, sm, nullptr,
                                                nullptr);
  const auto agent_model =
      ir::CreateModel(fbb, ir::ModelKind_AgentModel, agent.Union());

  // ---- coupled root ------------------------------------------------------
  const auto coupled_meta = ir::CreateMetadataDirect(
      fbb, "QueueDemo", "1", "scripts/interop/writer.cpp", 0);
  const std::vector<Offset<ir::Model>> children{atomic_model, process_model,
                                                agent_model};
  const auto coupled = ir::CreateCoupledModelDirect(fbb, coupled_meta,
                                                    &children, nullptr,
                                                    nullptr);
  const auto root =
      ir::CreateModel(fbb, ir::ModelKind_CoupledModel, coupled.Union());

  return ir::CreateModelFileDirect(fbb, 1, root, &file_params, file_meta);
}

// ---------------------------------------------------------------------------
// F2: Counters wire frame
// ---------------------------------------------------------------------------
flatbuffers::Offset<wire::Frame> BuildCountersFrame(
    flatbuffers::FlatBufferBuilder& fbb) {
  const auto header = wire::CreateFrameHeader(fbb, /*version=*/1, /*seq=*/7,
                                              /*sim_time_ns=*/1500000000,
                                              wire::FrameKind_Counters);
  const std::vector<Offset<wire::Counter>> values{
      wire::CreateCounterDirect(fbb, "arrival_rate", 2.0),
      wire::CreateCounterDirect(fbb, "service_rate", 3.0),
      wire::CreateCounterDirect(fbb, "utilization", 2.0 / 3.0),
      wire::CreateCounterDirect(fbb, "entities_served", 1234.0),
  };
  const auto counters = wire::CreateCountersDirect(fbb, &values);
  return wire::CreateFrame(fbb, header, wire::FramePayload_Counters,
                           counters.Union());
}

}  // namespace

int main(int argc, char** argv) {
  const fs::path out_dir = argc > 1 ? fs::path(argv[1]) : fs::current_path();
  std::error_code ec;
  fs::create_directories(out_dir, ec);
  if (ec) {
    std::cerr << "cannot create output dir " << out_dir << ": "
              << ec.message() << "\n";
    return 1;
  }

  {
    flatbuffers::FlatBufferBuilder fbb(4096);
    const auto model_file = BuildModelFile(fbb);
    ir::FinishModelFileBuffer(fbb, model_file);
    const auto path = out_dir / "model_file.bin";
    if (!WriteBuffer(path, fbb)) return 1;
    std::cout << "[writer] ModelFile  -> " << path.string() << " ("
              << fbb.GetSize() << " bytes)\n";
  }

  {
    flatbuffers::FlatBufferBuilder fbb(1024);
    const auto frame = BuildCountersFrame(fbb);
    wire::FinishFrameBuffer(fbb, frame);
    const auto path = out_dir / "counters_frame.bin";
    if (!WriteBuffer(path, fbb)) return 1;
    std::cout << "[writer] Counters   -> " << path.string() << " ("
              << fbb.GetSize() << " bytes)\n";
  }

  std::cout << "[writer] OK\n";
  return 0;
}

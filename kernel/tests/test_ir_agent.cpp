// IR AgentModel execution tests (milestone 1c): DSL agent blocks -> v2 IR ->
// AgentReplicationModel tick loop (built-in behaviors) + determinism.
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/trace_diff.h"
#include "logicpilot/devs/trace_codec.h"
#include "logicpilot/devs/trace_store.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "logicpilot/runtime/simulation_session.h"

#include "ir_v2_generated.h"
#include "register.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

constexpr const char* kAgents = LOGICPILOT_EXAMPLES_DIR "/agents.lp";

IrLoadResult load_agents() {
  const dsl::CompileResult compiled = dsl::compile_file(kAgents);
  REQUIRE(compiled.ok);
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("agent DSL lowers to a v2 agent node with count/state/behaviors", "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  REQUIRE(loaded.file.v2_root != nullptr);
  const v2::Node* root = loaded.file.v2_root->root();
  REQUIRE(root != nullptr);
  REQUIRE(root->semantics() != nullptr);
  REQUIRE(root->semantics()->block()->str() == "model");
  REQUIRE(root->children() != nullptr);
  REQUIRE(root->children()->size() == 1);
  const v2::Node* agent = root->children()->Get(0);
  REQUIRE(agent->semantics() != nullptr);
  REQUIRE(agent->semantics()->block()->str() == "agent");
  REQUIRE(agent->behaviors() != nullptr);
  REQUIRE(agent->behaviors()->size() == 2);
  REQUIRE(agent->behaviors()->Get(0)->handler_ref()->str() == "flip");
  REQUIRE(agent->behaviors()->Get(0)->params()->Get(0)->name()->str() == "active");
  REQUIRE(agent->behaviors()->Get(1)->handler_ref()->str() == "bounce");
}

TEST_CASE("AgentReplicationModel runs the tick loop with built-in behaviors", "[agent][ir]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 5;  // tick budget
  const ReplicationMetrics metrics = model->run(config, nullptr);
  REQUIRE(metrics.arrivals == 5);
  REQUIRE(metrics.horizon_seconds == 5.0);

  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);
  REQUIRE(agent->agent_count() == 3);
  // Initial active=true; five flips -> false.
  REQUIRE(std::get<bool>(agent->agent_state(0).values.at("active")) == false);
  REQUIRE(std::get<bool>(agent->agent_state(2).values.at("active")) == false);
  // The bounce behavior keeps positions inside [0,1]^2.
  for (const Position& position : agent->last_positions()) {
    REQUIRE(position.x >= 0.0F);
    REQUIRE(position.x <= 1.0F);
    REQUIRE(position.y >= 0.0F);
    REQUIRE(position.y <= 1.0F);
  }
}

TEST_CASE("AgentReplicationModel enforces the shared tick budget",
          "[agent][safety]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  auto base = build_replication_model(loaded.file, &error);
  REQUIRE(base != nullptr);
  auto* agent = dynamic_cast<AgentReplicationModel*>(base.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.arrivals = 5;
  config.max_events = 2;
  REQUIRE(agent->reset(config));
  REQUIRE(agent->step());
  REQUIRE(agent->step());
  REQUIRE_FALSE(agent->step());
  REQUIRE(agent->failed());
  REQUIRE(agent->failure_reason().find("KR1017") != std::string::npos);

  std::vector<std::uint8_t> checkpoint;
  REQUIRE(agent->checkpoint_save(checkpoint));
  REQUIRE(agent->checkpoint_restore(checkpoint));
  REQUIRE(agent->failed());
}

TEST_CASE("Agent logical-step trace is deterministic and separate from events",
          "[agent][determinism][trace]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  auto model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  ReplicationConfig config;
  config.arrivals = 5;
  TraceRecorder first;
  TraceRecorder second;
  REQUIRE(model->run(config, &first).arrivals == 5);
  REQUIRE(model->run(config, &second).arrivals == 5);
  REQUIRE(first.hash() == second.hash());
  REQUIRE(first.event_count() == 0);
  REQUIRE(first.logical_step_count() == 5);
  REQUIRE(second.logical_step_count() == 5);
}

TEST_CASE("logical trace capture is bounded and reports first divergence",
          "[trace][diagnostics]") {
  TraceRecorder trace;
  trace.enable_logical_step_records(2);
  trace.record_logical_step(SimTime::from_ns(1), 7, 10);
  trace.record_logical_step(SimTime::from_ns(2), 7, 11);
  trace.record_logical_step(SimTime::from_ns(3), 7, 12);
  REQUIRE(trace.logical_step_count() == 3);
  REQUIRE(trace.logical_steps().size() == 2);
  REQUIRE(trace.logical_steps_truncated());

  std::vector<LogicalStepRecord> actual(trace.logical_steps().begin(),
                                        trace.logical_steps().end());
  actual[1].payload = 99;
  const auto divergence = LogicalTraceComparator::first_difference(
      trace.logical_steps(), actual);
  REQUIRE(divergence.has_value());
  REQUIRE(divergence->index == 1);
  REQUIRE(divergence->field == "payload");
  REQUIRE(divergence->expected == "11");
  REQUIRE(divergence->actual == "99");

  std::vector<std::uint8_t> archive;
  std::string archive_error;
  REQUIRE(LogicalTraceCodec::encode(trace.logical_steps(), archive,
                                    &archive_error));
  std::vector<LogicalStepRecord> decoded;
  REQUIRE(LogicalTraceCodec::decode(archive, decoded, &archive_error));
  REQUIRE_FALSE(LogicalTraceComparator::first_difference(
                     trace.logical_steps(), decoded)
                     .has_value());
  archive[archive.size() / 2] ^= 0x01;
  REQUIRE_FALSE(LogicalTraceCodec::decode(archive, decoded, &archive_error));
  REQUIRE(archive_error.find("checksum") != std::string::npos);
}

TEST_CASE("logical trace file store installs atomically and round-trips",
          "[trace][storage]") {
  const std::filesystem::path path =
      std::filesystem::temp_directory_path() / "logicpilot-logical-trace-test.lplt";
  std::error_code ignored;
  std::filesystem::remove(path, ignored);

  TraceRecorder trace;
  trace.enable_logical_step_records(4);
  trace.record_logical_step(SimTime::from_ns(1), 9, 1);
  trace.record_logical_step(SimTime::from_ns(2), 9, 2);
  FileLogicalTraceArchiveStore store{path};
  std::string error;
  REQUIRE(store.save(trace, &error));
  std::vector<LogicalStepRecord> loaded;
  REQUIRE(store.load(loaded, &error));
  REQUIRE_FALSE(LogicalTraceComparator::first_difference(
                     trace.logical_steps(), loaded)
                     .has_value());

  TraceRecorder replacement;
  replacement.enable_logical_step_records(4);
  replacement.record_logical_step(SimTime::from_ns(3), 9, 3);
  REQUIRE(store.save(replacement, &error));
  REQUIRE(store.load(loaded, &error));
  REQUIRE(loaded.size() == 1);
  REQUIRE(loaded[0].payload == 3);

  std::filesystem::remove(path, ignored);
  std::filesystem::remove(path.string() + ".tmp", ignored);
  std::filesystem::remove(path.string() + ".bak", ignored);
}

TEST_CASE("AgentReplicationModel checkpoint restores SoA population exactly",
          "[agent][checkpoint]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> base =
      build_replication_model(loaded.file, &error);
  REQUIRE(base != nullptr);
  auto* agent = dynamic_cast<AgentReplicationModel*>(base.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 4;
  config.arrivals = 5;
  REQUIRE(agent->reset(config));
  REQUIRE(agent->step());
  REQUIRE(agent->step());
  std::vector<std::uint8_t> checkpoint;
  REQUIRE(agent->checkpoint_save(checkpoint));
  REQUIRE(!checkpoint.empty());

  REQUIRE(agent->step());
  REQUIRE(agent->step());
  REQUIRE(agent->step());
  std::vector<AgentSnapshot> first;
  agent->snapshot_agents(first);

  REQUIRE(agent->checkpoint_restore(checkpoint));
  REQUIRE(agent->tick_count() == 2);
  REQUIRE(agent->step());
  REQUIRE(agent->step());
  REQUIRE(agent->step());
  std::vector<AgentSnapshot> second;
  agent->snapshot_agents(second);
  REQUIRE(first.size() == second.size());
  for (std::size_t index = 0; index < first.size(); ++index) {
    REQUIRE(first[index].position.x == second[index].position.x);
    REQUIRE(first[index].position.y == second[index].position.y);
    REQUIRE(first[index].state == second[index].state);
  }
}

TEST_CASE("Agent method exposes a versioned bundle through SimulationSession",
          "[agent][session][checkpoint]") {
  register_all_methods();
  const IrLoadResult loaded = load_agents();
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));
  auto session = kernel.create_session(&error);
  REQUIRE(session != nullptr);

  ReplicationConfig config;
  config.seed = 4;
  config.arrivals = 5;
  REQUIRE(session->start(config, &error));
  REQUIRE(session->advance(2_s, nullptr, nullptr, &error));
  SimulationSessionCheckpoint checkpoint;
  REQUIRE(session->save_method_checkpoint(checkpoint, &error));
  REQUIRE(checkpoint.methods.size() == 1);
  REQUIRE(checkpoint.methods[0].method == "agent");
  REQUIRE(session->advance(5_s, nullptr, nullptr, &error));
  REQUIRE(session->restore_method_checkpoint(checkpoint, &error));
  REQUIRE(session->now() == 2_s);
  REQUIRE(session->advance(5_s, nullptr, nullptr, &error));
  const auto metrics = session->finish(nullptr, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(metrics[0].arrivals == 5);
}

TEST_CASE(
    "SimulationKernel executes one shared-queue agent runtime with the "
    "requested replication config",
    "[agent][runtime][kernel]") {
  register_all_methods();
  const IrLoadResult loaded = load_agents();
  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));

  ReplicationConfig config;
  config.seed = 9;
  config.arrivals = 7;
  const std::vector<ReplicationMetrics> metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 1);
  REQUIRE(metrics.front().arrivals == 7);
  REQUIRE(metrics.front().horizon_seconds == 7.0);
}

TEST_CASE("SimulationKernel composes agent and system dynamics on one queue",
          "[agent][continuous][runtime][kernel]") {
  register_all_methods();
  const dsl::CompileResult compiled = dsl::compile_source(
      "model Hybrid {\n"
      "  agent People { count = 2 on_tick { noop } }\n"
      "  continuous Field {\n"
      "    param k = 0.5\n"
      "    state y = 1.0\n"
      "    d y/dt = -k*y\n"
      "  }\n"
      "}\n",
      "hybrid.lp");
  REQUIRE(compiled.ok);
  const IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  SimulationKernel kernel;
  std::string error;
  REQUIRE(kernel.load(loaded.file, &error));
  ReplicationConfig config;
  config.arrivals = 5;
  const auto metrics = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(metrics.size() == 2);
  REQUIRE(metrics[0].arrivals == 5);
  REQUIRE(metrics[0].horizon_seconds == 5.0);
  REQUIRE(metrics[1].arrivals == 5);
  REQUIRE(metrics[1].horizon_seconds == Catch::Approx(0.05));
  REQUIRE(kernel.variables().has("sd::y"));
  REQUIRE(std::get<double>(*kernel.variables().get("sd::y")) < 1.0);
}

TEST_CASE("AgentReplicationModel is deterministic (positions + metrics)", "[agent][determinism]") {
  const IrLoadResult loaded = load_agents();
  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 20;
  const ReplicationMetrics first = model->run(config, nullptr);
  const std::vector<Position> first_positions = agent->last_positions();
  const ReplicationMetrics second = model->run(config, nullptr);
  const std::vector<Position> second_positions = agent->last_positions();

  REQUIRE(first.arrivals == second.arrivals);
  REQUIRE(first.horizon_seconds == second.horizon_seconds);
  REQUIRE(first_positions.size() == second_positions.size());
  for (std::size_t i = 0; i < first_positions.size(); ++i) {
    REQUIRE(first_positions[i].x == second_positions[i].x);
    REQUIRE(first_positions[i].y == second_positions[i].y);
  }
}

TEST_CASE(
    "AgentReplicationModel parallel tick is bit-exact deterministic "
    "(100k agents)",
    "[agent][determinism][parallel]") {
  // Population >= 65536 with multiple cores routes flip/bounce through the
  // parallel_for_entities partition; the same run must reproduce identical
  // positions and state regardless of thread interleaving.
  constexpr const char* kLargeSwarm = R"lp(
model Swarm {
  agent Drone {
    count = 100000
    state active = true
    on_tick { flip active }
    on_tick { bounce }
  }
}
)lp";
  const dsl::CompileResult compiled = dsl::compile_source(kLargeSwarm, "large_swarm.lp");
  REQUIRE(compiled.ok);
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());

  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);
  const auto* agent = dynamic_cast<const AgentReplicationModel*>(model.get());
  REQUIRE(agent != nullptr);

  ReplicationConfig config;
  config.seed = 1;
  config.arrivals = 5;  // tick budget (flip x5 + bounce each tick)
  const ReplicationMetrics first = model->run(config, nullptr);
  const std::vector<Position> first_positions = agent->last_positions();
  REQUIRE(first.arrivals == 5);
  REQUIRE(agent->agent_count() == 100000);

  const ReplicationMetrics second = model->run(config, nullptr);
  const std::vector<Position> second_positions = agent->last_positions();
  REQUIRE(second.arrivals == 5);
  REQUIRE(first_positions.size() == second_positions.size());
  REQUIRE(first_positions.size() == 100000);

  for (std::size_t i = 0; i < first_positions.size(); ++i) {
    REQUIRE(first_positions[i].x == second_positions[i].x);
    REQUIRE(first_positions[i].y == second_positions[i].y);
    REQUIRE(first_positions[i].x >= 0.0F);
    REQUIRE(first_positions[i].x <= 1.0F);
    REQUIRE(first_positions[i].y >= 0.0F);
    REQUIRE(first_positions[i].y <= 1.0F);
  }
  // Five flips from active=true -> false, checked on the parallel path.
  REQUIRE(std::get<bool>(agent->agent_state(0).values.at("active")) == false);
  REQUIRE(std::get<bool>(agent->agent_state(99999).values.at("active")) == false);
}

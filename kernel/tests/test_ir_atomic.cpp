// IR AtomicModel execution tests (milestone 1b): DSL atomic blocks -> v2 IR
// -> IrAtomicModelV2 interpreter -> DevsExecutor, plus the
// DevsReplicationModel adapter (internal-transition budget) and
// determinism.
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <memory>
#include <string>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/executor.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/runtime/simulation_kernel.h"

#include "ir_v2_generated.h"
#include "register.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;

namespace {

constexpr const char* kPulseChain = LOGICPILOT_EXAMPLES_DIR "/pulse_chain.lp";

IrLoadResult load_pulse_chain() {
  const dsl::CompileResult compiled = dsl::compile_file(kPulseChain);
  REQUIRE(compiled.ok);
  IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(), compiled.v2_bytes.size());
  REQUIRE(loaded.ok());
  return loaded;
}

}  // namespace

TEST_CASE("atomic DSL lowers to an executable DEVS tree", "[atomic][devs]") {
  const IrLoadResult loaded = load_pulse_chain();
  REQUIRE(loaded.file.v2_root != nullptr);
  const v2::Node* root = loaded.file.v2_root->root();
  REQUIRE(root != nullptr);
  REQUIRE(root->semantics() != nullptr);
  REQUIRE(root->semantics()->block()->str() == "model");
  REQUIRE(root->children() != nullptr);
  REQUIRE(root->children()->size() == 2);
  REQUIRE(root->couplings() != nullptr);
  REQUIRE(root->couplings()->size() == 1);

  Xoshiro256PlusPlus engine{42};
  std::unique_ptr<CoupledModel> tree = build_atomic_tree_v2(*root, engine);
  REQUIRE(tree != nullptr);
  REQUIRE(tree->children().size() == 2);
  REQUIRE(tree->couplings().size() == 1);
  REQUIRE(tree->find_child("Pulser") != nullptr);
  REQUIRE(tree->find_child("Sink") != nullptr);
}

TEST_CASE("atomic tree runs on the DEVS executor under an internal budget", "[atomic][devs]") {
  const IrLoadResult loaded = load_pulse_chain();
  Xoshiro256PlusPlus engine{42};
  const v2::Node* root = loaded.file.v2_root->root();
  std::unique_ptr<CoupledModel> tree = build_atomic_tree_v2(*root, engine);
  REQUIRE(tree != nullptr);

  BinaryHeapScheduler scheduler{64};
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.set_internal_budget(5);
  REQUIRE(executor.load(*tree) == 2);
  executor.run(SimTime::infinity());

  REQUIRE(executor.internal_transitions() == 5);
  // Five firings at a 1.0 s time advance each.
  REQUIRE(clock.now().as_ns() == 5'000'000'000LL);

  // The routed pulses must have flipped Sink.seen.
  const CoupledModel::Child* sink = tree->find_child("Sink");
  REQUIRE(sink != nullptr);
  REQUIRE(sink->is_atomic());
  const auto* atom = dynamic_cast<const IrAtomicModelV2*>(sink->atomic.get());
  REQUIRE(atom != nullptr);
  const auto seen = atom->state("seen");
  REQUIRE(seen.has_value());
  REQUIRE(std::get<bool>(*seen));
}

TEST_CASE("DevsReplicationModel is deterministic under an internal budget",
          "[atomic][determinism]") {
  const IrLoadResult loaded = load_pulse_chain();
  std::string error;
  std::unique_ptr<ReplicationModel> model = build_replication_model(loaded.file, &error);
  REQUIRE(model != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 5;  // internal-transition budget for atomic models
  const ReplicationMetrics first = model->run(config, nullptr);
  const ReplicationMetrics second = model->run(config, nullptr);

  REQUIRE(first.arrivals == 5);
  REQUIRE(first.horizon_seconds == 5.0);
  REQUIRE(first.arrivals == second.arrivals);
  REQUIRE(first.horizon_seconds == second.horizon_seconds);

  // Adapter exposes the last tree: Sink.seen must be true end-to-end.
  const auto* adapter = dynamic_cast<const DevsReplicationModel*>(model.get());
  REQUIRE(adapter != nullptr);
  const CoupledModel* tree = adapter->last_tree();
  REQUIRE(tree != nullptr);
  const CoupledModel::Child* sink = tree->find_child("Sink");
  REQUIRE(sink != nullptr);
  const auto* atom = dynamic_cast<const IrAtomicModelV2*>(sink->atomic.get());
  REQUIRE(atom != nullptr);
  const auto seen = atom->state("seen");
  REQUIRE(seen.has_value());
  REQUIRE(std::get<bool>(*seen));
}

TEST_CASE("DEVS runtime executes on the SimulationKernel shared queue",
          "[atomic][devs][runtime][kernel]") {
  register_all_methods();
  const IrLoadResult loaded = load_pulse_chain();
  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 5;

  std::string error;
  auto batch = build_replication_model(loaded.file, &error);
  REQUIRE(batch != nullptr);
  const ReplicationMetrics expected = batch->run(config, nullptr);

  SimulationKernel kernel;
  REQUIRE(kernel.load(loaded.file, &error));
  const auto actual = kernel.run(config, nullptr, &error);
  REQUIRE(error.empty());
  REQUIRE(actual.size() == 1);
  REQUIRE(actual[0].arrivals == expected.arrivals);
  REQUIRE(actual[0].horizon_seconds == expected.horizon_seconds);
}

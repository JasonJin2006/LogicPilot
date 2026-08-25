// IR AtomicModel execution tests (milestone 1b): DSL atomic blocks -> v2 IR
// -> IrAtomicModelV2 interpreter -> DevsExecutor, plus the
// DevsReplicationModel adapter (internal-transition budget) and
// determinism.
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/executor.h"
#include "logicpilot/devs/checkpoint_journal.h"
#include "logicpilot/devs/checkpoint_store.h"
#include "logicpilot/devs/checkpoint_transform.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/runtime/ir_loader.h"
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

TEST_CASE("IR atomic checkpoint restores state and continuation exactly",
          "[atomic][checkpoint][determinism]") {
  const IrLoadResult loaded = load_pulse_chain();
  Xoshiro256PlusPlus engine{42};
  const v2::Node* root = loaded.file.v2_root->root();
  std::unique_ptr<CoupledModel> tree = build_atomic_tree_v2(*root, engine);
  REQUIRE(tree != nullptr);

  BinaryHeapScheduler scheduler{64};
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  DevsEvidenceRecorder evidence;
  executor.set_evidence_recorder(&evidence);
  executor.set_internal_budget(3);
  REQUIRE(executor.load(*tree) == 2);
  executor.set_replay_watermarks({11, 23});
  REQUIRE(executor.run(1_s) == 1);

  DevsCheckpoint checkpoint;
  std::string error;
  REQUIRE(executor.save_checkpoint(checkpoint, &error));
  REQUIRE(error.empty());
  REQUIRE(checkpoint.now == 1_s);
  REQUIRE(checkpoint.atoms.size() == 2);
  REQUIRE(checkpoint.recovery_epoch == executor.recovery_epoch());
  REQUIRE(checkpoint.replay_watermarks == std::vector<std::uint64_t>{11, 23});

  std::vector<std::uint8_t> archive;
  REQUIRE(executor.save_checkpoint_bytes(archive, &error));
  DevsCheckpoint archived;
  REQUIRE(DevsCheckpointCodec::decode(archive, archived, &error));
  REQUIRE(archived.recovery_epoch == checkpoint.recovery_epoch);
  REQUIRE(archived.replay_watermarks == checkpoint.replay_watermarks);
  std::vector<std::uint8_t> corrupted_archive = archive;
  corrupted_archive.back() ^= 0xFFU;
  REQUIRE_FALSE(executor.restore_checkpoint_bytes(corrupted_archive, &error));
  REQUIRE(error == "checkpoint archive checksum mismatch");

  IdentityCheckpointTransform identity;
  std::vector<std::uint8_t> envelope;
  REQUIRE(DevsCheckpointArchivePipeline::encode(checkpoint, identity, envelope,
                                                &error));
  DevsCheckpoint envelope_decoded;
  REQUIRE(DevsCheckpointArchivePipeline::decode(envelope, identity,
                                                envelope_decoded, &error));
  REQUIRE(envelope_decoded.recovery_epoch == checkpoint.recovery_epoch);
  REQUIRE(envelope_decoded.replay_watermarks == checkpoint.replay_watermarks);

  RleCheckpointTransform rle;
  std::vector<std::uint8_t> rle_payload;
  const std::vector<std::uint8_t> repetitive(256, 0xA5U);
  REQUIRE(rle.encode(repetitive, rle_payload, &error));
  REQUIRE(rle_payload.size() < repetitive.size());
  std::vector<std::uint8_t> rle_roundtrip;
  REQUIRE(rle.decode(rle_payload, rle_roundtrip, &error));
  REQUIRE(rle_roundtrip == repetitive);
  std::vector<std::uint8_t> rle_envelope;
  REQUIRE(DevsCheckpointArchivePipeline::encode(checkpoint, rle,
                                                rle_envelope, &error));
  DevsCheckpoint rle_checkpoint;
  REQUIRE(DevsCheckpointArchivePipeline::decode(rle_envelope, rle,
                                                rle_checkpoint, &error));
  REQUIRE(rle_checkpoint.replay_watermarks == checkpoint.replay_watermarks);

  const auto journal_path =
      std::filesystem::temp_directory_path() /
      "logicpilot_devs_checkpoint_journal_test.bin";
  std::error_code filesystem_error;
  std::filesystem::remove(journal_path, filesystem_error);

  const auto blob_path =
      std::filesystem::temp_directory_path() /
      "logicpilot_devs_checkpoint_blob_test.bin";
  std::filesystem::remove(blob_path, filesystem_error);
  FileCheckpointBlobStore blob_store{blob_path};
  REQUIRE(blob_store.write(envelope, &error));
  std::vector<std::uint8_t> stored_envelope;
  REQUIRE(blob_store.read(stored_envelope, &error));
  DevsCheckpoint stored;
  REQUIRE(DevsCheckpointArchivePipeline::decode(stored_envelope, identity,
                                                stored, &error));
  REQUIRE(stored.dispatched == checkpoint.dispatched);
  stored_envelope.back() ^= 0x01U;
  REQUIRE_FALSE(DevsCheckpointArchivePipeline::decode(
      stored_envelope, identity, stored, &error));
  REQUIRE(error == "checkpoint envelope checksum mismatch");
  std::filesystem::remove(blob_path, filesystem_error);
  DevsCheckpointJournal journal{journal_path};
  REQUIRE(journal.append(checkpoint, &error));
  DevsCheckpoint newer = checkpoint;
  newer.dispatched += 7;
  REQUIRE(journal.append(newer, &error));
  {
    std::ofstream tail(journal_path, std::ios::binary | std::ios::app);
    tail.put(static_cast<char>(0x7F));  // simulated crash-truncated tail
  }
  DevsCheckpoint recovered;
  bool truncated_tail = false;
  REQUIRE(journal.load_latest(recovered, &error, &truncated_tail));
  REQUIRE(error.empty());
  REQUIRE(truncated_tail);
  REQUIRE(recovered.dispatched == newer.dispatched);
  const auto bytes_before_compaction =
      std::filesystem::file_size(journal_path, filesystem_error);
  REQUIRE(journal.compact_latest(&error));
  const auto bytes_after_compaction =
      std::filesystem::file_size(journal_path, filesystem_error);
  REQUIRE(bytes_after_compaction < bytes_before_compaction);
  DevsCheckpoint compacted;
  bool compacted_tail = true;
  REQUIRE(journal.load_latest(compacted, &error, &compacted_tail));
  REQUIRE_FALSE(compacted_tail);
  REQUIRE(compacted.dispatched == newer.dispatched);
  std::filesystem::remove(journal_path, filesystem_error);

  DevsCheckpoint wrong_epoch = checkpoint;
  wrong_epoch.recovery_epoch += 1;
  REQUIRE_FALSE(executor.restore_checkpoint(wrong_epoch, &error));
  REQUIRE(error == "DevsExecutor: checkpoint recovery epoch mismatch");

  DevsCheckpoint corrupted = checkpoint;
  REQUIRE(!corrupted.atoms[0].state.empty());
  corrupted.atoms[0].state[0] ^= 0xFFU;
  REQUIRE_FALSE(executor.restore_checkpoint(corrupted, &error));

  evidence.clear();
  REQUIRE(executor.run(3_s) == 2);
  const std::uint64_t first_continuation_hash = evidence.hash();
  const std::size_t first_transition_count = executor.internal_transitions();
  REQUIRE(first_transition_count == 3);

  REQUIRE(executor.restore_checkpoint(checkpoint, &error));
  REQUIRE(error.empty());
  REQUIRE(clock.now() == 1_s);
  REQUIRE(executor.internal_transitions() == 1);
  REQUIRE(evidence.event_count() == 0);

  REQUIRE(executor.run(3_s) == 2);
  REQUIRE(evidence.hash() == first_continuation_hash);
  REQUIRE(executor.internal_transitions() == first_transition_count);
}

TEST_CASE("DEVS replication session forwards evidence and checkpoint lifecycle",
          "[atomic][session][checkpoint]") {
  const IrLoadResult loaded = load_pulse_chain();
  std::string error;
  std::unique_ptr<ReplicationModel> base =
      build_replication_model(loaded.file, &error);
  REQUIRE(base != nullptr);
  auto* session = dynamic_cast<DevsReplicationModel*>(base.get());
  REQUIRE(session != nullptr);

  DevsEvidenceRecorder evidence;
  session->set_evidence_recorder(&evidence);
  ReplicationConfig config;
  config.seed = 42;
  config.arrivals = 3;
  REQUIRE(session->reset(config));
  REQUIRE(session->advance(1_s) == 1);  // Pulser + routed Sink input.

  DevsCheckpoint checkpoint;
  REQUIRE(session->save_checkpoint(checkpoint, &error));
  REQUIRE(error.empty());
  evidence.clear();
  REQUIRE(session->advance(3_s) == 2);
  const std::uint64_t first_hash = evidence.hash();

  REQUIRE(session->restore_checkpoint(checkpoint, &error));
  REQUIRE(error.empty());
  REQUIRE(evidence.event_count() == 0);
  REQUIRE(session->advance(3_s) == 2);
  REQUIRE(evidence.hash() == first_hash);
  REQUIRE(session->internal_transitions() == 3);
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

// DEVS-lite executor tests: routing, nesting, injection.
#include <catch2/catch_test_macros.hpp>

#include <array>
#include <filesystem>
#include <fstream>
#include <string>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/coupled_model.h"
#include "logicpilot/devs/evidence_codec.h"
#include "logicpilot/devs/evidence_diff.h"
#include "logicpilot/devs/evidence_graph.h"
#include "logicpilot/devs/evidence_store.h"
#include "logicpilot/devs/executor.h"
#include "logicpilot/devs/partition_transport.h"

using namespace logicpilot;

namespace {

// Emits `count` events on port "out" at 1ms intervals, then goes passive.
class Generator final : public AtomicModel {
 public:
  explicit Generator(std::uint64_t count, std::string event_type = {})
      : remaining_{count} {
    out_port_ = declare_port("out", event_type);
  }

  SimTime time_advance() const override {
    return remaining_ > 0 ? SimTime::from_ns(1'000'000) : SimTime::infinity();
  }
  void external_transition(SimTime, PortId, std::uint64_t) override {}
  void internal_transition(SimTime) override {
    if (remaining_ > 0) {
      emit(out_port_, emitted_);
      --remaining_;
      ++emitted_;
    }
  }

  PortId out_port_{0};
  std::uint64_t emitted_{0};

 private:
  std::uint64_t remaining_;
};

// Counts inputs arriving on port "in"; records the last payload.
class Consumer final : public AtomicModel {
 public:
  explicit Consumer(std::string event_type = {}) {
    in_port_ = declare_port("in", event_type);
  }

  SimTime time_advance() const override { return SimTime::infinity(); }
  void external_transition(SimTime, PortId port,
                           std::uint64_t payload) override {
    if (port == in_port_) {
      ++received_;
      last_payload_ = payload;
    }
  }
  void internal_transition(SimTime) override {}

  PortId in_port_{0};
  std::uint64_t received_{0};
  std::uint64_t last_payload_{0};
};

// PDEVS source: output is produced in lambda, while the internal transition
// only changes the source state. This is intentionally different from the
// legacy Generator above, which stages output from internal_transition().
class PdevsGenerator final : public AtomicModel {
 public:
  explicit PdevsGenerator(std::uint64_t payload, std::uint32_t weight = 1,
                          SimTime lookahead = SimTime::zero())
      : payload_{payload}, weight_{weight}, lookahead_{lookahead} {
    out_port_ = declare_port("out");
  }

  SimTime time_advance() const override {
    return remaining_ > 0 ? 1_ms : SimTime::infinity();
  }
  void external_transition(SimTime, PortId, std::uint64_t) override {}
  bool uses_pdevs_semantics() const override { return true; }
  bool supports_parallel_execution() const override { return true; }
  std::uint32_t parallel_weight() const override { return weight_; }
  SimTime parallel_lookahead() const override { return lookahead_; }
  void output_function(SimTime) override { emit(out_port_, payload_); }
  void internal_transition(SimTime) override { remaining_ = 0; }
  [[nodiscard]] PortId out_port() const { return out_port_; }

 private:
  PortId out_port_{0};
  std::uint64_t payload_{0};
  std::uint32_t weight_{1};
  SimTime lookahead_{SimTime::zero()};
  std::uint32_t remaining_{1};
};

class PdevsBagConsumer final : public AtomicModel {
 public:
  PdevsBagConsumer() { in_port_ = declare_port("in"); }

  SimTime time_advance() const override { return SimTime::infinity(); }
  void external_transition(SimTime, PortId, std::uint64_t) override {}
  bool uses_pdevs_semantics() const override { return true; }
  bool supports_parallel_execution() const override { return true; }
  void external_transition_batch(SimTime now, SimTime elapsed,
                                 std::span<const PortEvent> inputs) override {
    ++bag_calls_;
    last_elapsed_ = elapsed;
    for (const PortEvent& input : inputs) {
      if (input.port == in_port_) {
        ++received_;
        sum_ += input.payload;
      }
    }
    last_now_ = now;
  }
  void internal_transition(SimTime) override {}

  PortId in_port_{0};
  std::uint64_t bag_calls_{0};
  std::uint64_t received_{0};
  std::uint64_t sum_{0};
  SimTime last_elapsed_{SimTime::zero()};
  SimTime last_now_{SimTime::zero()};
};

// PDEVS semantics without the explicit thread-safety contract. The executor
// must keep this model on the serial path even when run_parallel() is called.
class PdevsSerialOnly final : public AtomicModel {
 public:
  PdevsSerialOnly() { out_port_ = declare_port("out"); }

  SimTime time_advance() const override {
    return done_ ? SimTime::infinity() : 1_ms;
  }
  void external_transition(SimTime, PortId, std::uint64_t) override {}
  bool uses_pdevs_semantics() const override { return true; }
  void output_function(SimTime) override { emit(out_port_, 99); }
  void internal_transition(SimTime) override { done_ = true; }

  PortId out_port_{0};
  bool done_{false};
};

class PdevsConfluentConsumer final : public AtomicModel {
 public:
  PdevsConfluentConsumer() { in_port_ = declare_port("in"); }

  SimTime time_advance() const override {
    return finished_ ? SimTime::infinity() : 1_ms;
  }
  void external_transition(SimTime, PortId, std::uint64_t) override {}
  bool uses_pdevs_semantics() const override { return true; }
  bool supports_parallel_execution() const override { return true; }
  void output_function(SimTime) override { ++lambda_calls_; }
  void internal_transition(SimTime) override { ++internal_calls_; }
  void confluent_transition(SimTime, std::span<const PortEvent> inputs) override {
    ++confluent_calls_;
    for (const PortEvent& input : inputs) {
      if (input.port == in_port_) {
        received_ += 1;
      }
    }
    finished_ = true;
  }

  PortId in_port_{0};
  std::uint64_t confluent_calls_{0};
  std::uint64_t lambda_calls_{0};
  std::uint64_t internal_calls_{0};
  std::uint64_t received_{0};
  bool finished_{false};
};

}  // namespace

TEST_CASE("Coupled model routes generator output to consumer", "[devs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* gen = new Generator(5);
  auto* consumer = new Consumer();
  root->add_atomic("gen", std::unique_ptr<AtomicModel>(gen));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("gen", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 2);

  const std::size_t dispatched = executor.run(100_ms);
  REQUIRE(dispatched == 5);  // five internal events, outputs routed inline
  REQUIRE(gen->emitted_ == 5);
  REQUIRE(consumer->received_ == 5);
  REQUIRE(consumer->last_payload_ == 4);
}

TEST_CASE("DEVS runtime plan rejects incompatible typed ports", "[devs][ports]") {
  auto root = std::make_unique<CoupledModel>("root");
  root->add_atomic("gen", std::make_unique<Generator>(1, "Signal"));
  root->add_atomic("consumer", std::make_unique<Consumer>("Command"));
  root->couple("gen", "out", "consumer", "in");

  bool rejected = false;
  std::string error;
  try {
    (void)DevsRuntimePlan::compile(*root);
  } catch (const std::logic_error& exception) {
    rejected = true;
    error = exception.what();
  }
  REQUIRE(rejected);
  REQUIRE(error.find("incompatible event types") != std::string::npos);
  REQUIRE(error.find("Signal") != std::string::npos);
  REQUIRE(error.find("Command") != std::string::npos);
}

TEST_CASE("DEVS runtime plan accepts equal typed ports", "[devs][ports]") {
  auto root = std::make_unique<CoupledModel>("root");
  root->add_atomic("gen", std::make_unique<Generator>(1, "Signal"));
  root->add_atomic("consumer", std::make_unique<Consumer>("Signal"));
  root->couple("gen", "out", "consumer", "in");

  REQUIRE_NOTHROW(DevsRuntimePlan::compile(*root));
}

TEST_CASE("Nested coupled models pass events through parent ports",
          "[devs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto mid = std::make_unique<CoupledModel>("mid");
  auto* gen = new Generator(3);
  auto* consumer = new Consumer();
  mid->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  mid->couple(".", "in", "consumer", "in");  // parent input -> child input
  root->add_atomic("gen", std::unique_ptr<AtomicModel>(gen));
  root->add_coupled("mid", std::move(mid));
  root->couple("gen", "out", "mid", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 2);

  executor.run(100_ms);
  REQUIRE(consumer->received_ == 3);
}

TEST_CASE("RuntimePlan preserves hierarchy paths and compiles stable route spans",
          "[devs][runtime-plan]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto mid = std::make_unique<CoupledModel>("mid");
  auto* gen = new PdevsGenerator(1);
  auto* consumer = new PdevsBagConsumer();
  mid->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  mid->couple(".", "in", "consumer", "in");
  root->add_atomic("gen", std::unique_ptr<AtomicModel>(gen));
  root->add_coupled("mid", std::move(mid));
  root->couple("gen", "out", "mid", "in");
  root->couple(".", "feed", "mid", "in");

  const DevsRuntimePlan first = DevsRuntimePlan::compile(*root);
  const DevsRuntimePlan second = DevsRuntimePlan::compile(*root);
  REQUIRE(first.atom_count() == 2);
  REQUIRE(first.atom_path(0) == "gen");
  REQUIRE(first.atom_path(1) == "mid.consumer");
  REQUIRE(first.root_port_id("feed").has_value());
  REQUIRE(first.root_targets(*first.root_port_id("feed")).size() == 1);
  const auto first_routes = first.output_targets(0, gen->out_port());
  const auto second_routes = second.output_targets(0, gen->out_port());
  REQUIRE(first_routes.size() == 1);
  REQUIRE(first_routes[0].atom == 1);
  REQUIRE(first_routes[0].port == consumer->in_port_);
  REQUIRE(first_routes[0] == second_routes[0]);
}

TEST_CASE("PartitionPlan assigns stable ranges and reports cut routes",
          "[devs][partition]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* first = new PdevsGenerator(10);
  auto* second = new PdevsGenerator(20);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("first", std::unique_ptr<AtomicModel>(first));
  root->add_atomic("second", std::unique_ptr<AtomicModel>(second));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("first", "out", "consumer", "in");
  root->couple("second", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 3);
  const DevsPartitionPlan partitions = executor.partition_plan(2);
  REQUIRE(partitions.atom_count() == 3);
  REQUIRE(partitions.partition_count() == 2);
  REQUIRE(partitions.partition_of(0) == 0);
  REQUIRE(partitions.partition_of(1) == 1);
  REQUIRE(partitions.partition_of(2) == 1);
  REQUIRE(partitions.has_cross_partition_routes());
  REQUIRE(partitions.cross_routes().size() == 1);
  REQUIRE(partitions.cross_routes()[0].from_atom == 0);
  REQUIRE(partitions.cross_routes()[0].to_atom == 2);
}

TEST_CASE("PartitionPlan uses atom weights for stable load balance",
          "[devs][partition][load-balance]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* heavy = new PdevsGenerator(10, 4);
  auto* light = new PdevsGenerator(20, 1);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("heavy", std::unique_ptr<AtomicModel>(heavy));
  root->add_atomic("light", std::unique_ptr<AtomicModel>(light));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("heavy", "out", "consumer", "in");
  root->couple("light", "out", "consumer", "in");
  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 3);
  const DevsPartitionPlan partitions = executor.partition_plan(2);
  REQUIRE(partitions.partition_of(0) == 0);
  REQUIRE(partitions.partition_of(1) == 1);
  REQUIRE(partitions.partition_of(2) == 1);
}

TEST_CASE("PDEVS lookahead exposes a conservative safe horizon",
          "[devs][partition][lookahead]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* source = new PdevsGenerator(10, 1, 1_ms);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("source", std::unique_ptr<AtomicModel>(source));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("source", "out", "consumer", "in");
  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 2);
  REQUIRE(executor.parallel_supported());
  REQUIRE(executor.conservative_safe_horizon(10_ms, 2) == 2_ms);
}

TEST_CASE("partition transport reorders events deterministically",
          "[devs][partition][transport]") {
  DeterministicPartitionTransport transport;
  transport.send(DevsPartitionEvent{2_ms, 0, 0, 1, 3, 8, 2, 22, 4});
  transport.send(DevsPartitionEvent{2_ms, 0, 0, 1, 2, 8, 2, 11, 1});
  transport.send(DevsPartitionEvent{3_ms, 0, 0, 1, 1, 8, 2, 33, 0});
  REQUIRE(transport.pending() == 3);
  const auto events = transport.receive(2_ms, 1);
  REQUIRE(events.size() == 2);
  REQUIRE(events[0].payload == 11);
  REQUIRE(events[1].payload == 22);
  REQUIRE(transport.pending() == 1);
  REQUIRE(transport.receive(2_ms, 0).empty());
  REQUIRE(transport.pending() == 1);
  REQUIRE(transport.receive(3_ms, 1).size() == 1);
  REQUIRE(transport.pending() == 0);
}

TEST_CASE("serialized partition transport round-trips and rejects corruption",
          "[devs][partition][transport][wire]") {
  const DevsPartitionEvent original{7_ms, 6, 2, 3, 11, 19, 4, 0xABCDEF, 9};
  const std::vector<std::uint8_t> frame =
      DevsPartitionEventCodec::encode(original);
  DevsPartitionEvent decoded;
  std::string error;
  REQUIRE(DevsPartitionEventCodec::decode(frame, decoded, &error));
  REQUIRE(error.empty());
  REQUIRE(decoded.at == original.at);
  REQUIRE(decoded.source_partition == original.source_partition);
  REQUIRE(decoded.target_partition == original.target_partition);
  REQUIRE(decoded.source_atom == original.source_atom);
  REQUIRE(decoded.target_atom == original.target_atom);
  REQUIRE(decoded.target_port == original.target_port);
  REQUIRE(decoded.payload == original.payload);
  REQUIRE(decoded.sequence == original.sequence);

  SerializedPartitionTransport transport;
  transport.send(original);
  REQUIRE(transport.pending() == 1);
  REQUIRE(transport.receive(7_ms, 3).size() == 1);
  REQUIRE(transport.healthy());

  std::vector<std::uint8_t> corrupted = frame;
  corrupted[corrupted.size() - 1] ^= 0xFF;
  transport.send_frame(std::move(corrupted));
  REQUIRE(transport.receive(7_ms, 3).empty());
  REQUIRE_FALSE(transport.healthy());
  REQUIRE(transport.last_error() == "partition event checksum mismatch");
}

TEST_CASE("ring partition transport applies bounded backpressure",
          "[devs][partition][transport][ring]") {
  PartitionFrameRing<2, 80> ring;
  RingPartitionTransport<2, 80> transport{ring};
  const DevsPartitionEvent first{1_ms, 0, 0, 1, 1, 4, 2, 10, 1};
  const DevsPartitionEvent second{1_ms, 0, 0, 1, 2, 4, 2, 20, 2};
  const DevsPartitionEvent third{1_ms, 0, 0, 1, 3, 4, 2, 30, 3};
  transport.send(first);
  transport.send(second);
  REQUIRE(transport.pending() == 2);
  transport.send(third);
  REQUIRE_FALSE(transport.healthy());
  REQUIRE(transport.last_error() == "partition frame ring is full");
  const auto events = transport.receive(1_ms, 1);
  REQUIRE(events.size() == 2);
  REQUIRE(events[0].payload == 10);
  REQUIRE(events[1].payload == 20);
  REQUIRE(transport.pending() == 0);
}

TEST_CASE("ring transport enforces peer epoch and heartbeat",
          "[devs][partition][transport][liveness]") {
  PartitionPeerControl control;
  control.begin_epoch(7, SimTime::zero());
  REQUIRE(control.active(7));
  REQUIRE(control.alive(7, 5_ms, 10_ms));
  REQUIRE(control.sent() == 0);

  PartitionFrameRing<4, 80> ring;
  RingPartitionTransport<4, 80> transport{ring, &control, 7, 10_ms};
  transport.send(DevsPartitionEvent{5_ms, 7, 0, 1, 1, 2, 3, 42, 1});
  REQUIRE(control.sent() == 1);
  REQUIRE(transport.receive(5_ms, 1).size() == 1);
  REQUIRE(control.received() == 1);

  control.mark_failed(7);
  REQUIRE_FALSE(control.active(7));
  REQUIRE(transport.receive(6_ms, 1).empty());
  REQUIRE_FALSE(transport.healthy());
  REQUIRE(transport.last_error() == "partition peer marked failed");

  PartitionPeerControl next_epoch;
  next_epoch.begin_epoch(8, SimTime::zero());
  RingPartitionTransport<4, 80> mismatch{ring, &next_epoch, 7, 10_ms};
  REQUIRE(mismatch.receive(1_ms, 1).empty());
  REQUIRE(mismatch.last_error() == "partition peer epoch mismatch");

  PartitionPeerControl stale_control;
  stale_control.begin_epoch(9, SimTime::zero());
  PartitionFrameRing<4, 80> stale_ring;
  RingPartitionTransport<4, 80> stale{stale_ring, &stale_control, 9, 5_ms};
  REQUIRE(stale.receive(6_ms, 1).empty());
  REQUIRE(stale.last_error() == "partition peer heartbeat timed out");

  PartitionFrameRing<4, 80> replay_ring;
  RingPartitionTransport<4, 80> replay{replay_ring, nullptr, 7,
                                       SimTime::infinity(), true};
  const DevsPartitionEvent replay_event{1_ms, 7, 0, 1, 4, 1, 2, 99, 41};
  const auto replay_frame = DevsPartitionEventCodec::encode(replay_event);
  REQUIRE(replay_ring.try_push(replay_frame));
  REQUIRE(replay_ring.try_push(replay_frame));
  REQUIRE(replay.receive(1_ms, 1).size() == 1);
  REQUIRE(replay.pending() == 0);

  PartitionPeerControl epoch_control;
  epoch_control.begin_epoch(7, SimTime::zero());
  PartitionFrameRing<4, 80> epoch_ring;
  RingPartitionTransport<4, 80> old_sender{epoch_ring, &epoch_control, 7,
                                             SimTime::infinity()};
  old_sender.send(DevsPartitionEvent{1_ms, 0, 1, 5, 2, 3, 77, 5});
  epoch_control.begin_epoch(8, SimTime::zero());
  RingPartitionTransport<4, 80> restarted{epoch_ring, &epoch_control, 8,
                                           SimTime::infinity()};
  REQUIRE(restarted.receive(1_ms, 1).empty());
  REQUIRE(restarted.last_error() == "partition event epoch mismatch");
}

TEST_CASE("ring replay window reports a missing sequence gap",
          "[devs][partition][transport][replay]") {
  PartitionPeerControl control;
  control.begin_epoch(7, SimTime::zero());
  PartitionFrameRing<4, 80> ring;
  RingPartitionTransport<4, 80> transport{ring, &control, 7,
                                           SimTime::infinity(), true};
  transport.send(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 10, 1});
  transport.send(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 30, 3});
  const auto events = transport.receive(1_ms, 1);
  REQUIRE(events.size() == 2);
  REQUIRE_FALSE(transport.healthy());
  REQUIRE(transport.last_error().find("sequence gap") != std::string::npos);
  REQUIRE(transport.last_error().find("expected 2") != std::string::npos);
  PartitionReplayRequest request;
  REQUIRE(control.take_replay_request(request));
  REQUIRE(request.epoch == 7);
  REQUIRE(request.source_partition == 0);
  REQUIRE(request.target_partition == 1);
  REQUIRE(request.first_missing_sequence == 2);
  REQUIRE(request.observed_sequence == 3);
  REQUIRE_FALSE(control.take_replay_request(request));
}

TEST_CASE("partition replay history returns complete deterministic ranges",
          "[devs][partition][transport][replay][history]") {
  PartitionReplayHistory<4> history;
  for (std::uint64_t sequence = 1; sequence <= 3; ++sequence) {
    history.record(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, sequence * 10, sequence});
  }
  PartitionReplayRequest request{7, 0, 1, 2, 3};
  std::vector<DevsPartitionEvent> resend;
  REQUIRE(history.replay(request, resend));
  REQUIRE(resend.size() == 2);
  REQUIRE(resend[0].sequence == 2);
  REQUIRE(resend[1].sequence == 3);

  history.record(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 40, 4});
  history.record(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 50, 5});
  request.first_missing_sequence = 1;
  REQUIRE_FALSE(history.replay(request, resend));
  REQUIRE(resend.size() == 2);

  PartitionFrameRing<2, 80> ring;
  PartitionReplayHistory<2> attached_history;
  RingPartitionTransport<2, 80> transport{ring, nullptr, 7,
                                           SimTime::infinity(), true,
                                           &attached_history};
  transport.send(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 60, 6});
  transport.send(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 70, 7});
  transport.send(DevsPartitionEvent{1_ms, 7, 0, 1, 1, 2, 3, 80, 8});
  REQUIRE(attached_history.size() == 2);
  PartitionReplayRequest attached_request{7, 0, 1, 7, 8};
  REQUIRE_FALSE(attached_history.replay(attached_request, resend));
  REQUIRE(resend.size() == 1);
}

TEST_CASE("PDEVS parallel timestamp barrier is bit-identical",
          "[devs][partition][parallel][determinism]") {
  struct Result {
    std::size_t dispatched{0};
    std::uint64_t bag_calls{0};
    std::uint64_t received{0};
    std::uint64_t sum{0};
    std::uint64_t evidence_hash{0};
    std::vector<DevsEvidenceRecord> evidence_records;
  };
  const auto run = [](bool parallel) {
    auto root = std::make_unique<CoupledModel>("root");
    auto* first = new PdevsGenerator(10);
    auto* second = new PdevsGenerator(20);
    auto* consumer = new PdevsBagConsumer();
    root->add_atomic("first", std::unique_ptr<AtomicModel>(first));
    root->add_atomic("second", std::unique_ptr<AtomicModel>(second));
    root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
    root->couple("first", "out", "consumer", "in");
    root->couple("second", "out", "consumer", "in");
    BinaryHeapScheduler scheduler;
    SimulationClock clock;
    DevsEvidenceRecorder evidence;
    DevsExecutor executor{scheduler, clock};
    executor.set_evidence_recorder(&evidence);
    REQUIRE(executor.load(*root) == 3);
    if (parallel) {
      REQUIRE(executor.parallel_supported());
    }
    const std::size_t dispatched =
        parallel ? executor.run_parallel(1_ms, 2) : executor.run(1_ms);
    return Result{dispatched, consumer->bag_calls_, consumer->received_,
                  consumer->sum_, evidence.hash(), evidence.records()};
  };

  const Result sequential = run(false);
  const Result parallel = run(true);
  REQUIRE(parallel.dispatched == sequential.dispatched);
  REQUIRE(parallel.bag_calls == sequential.bag_calls);
  REQUIRE(parallel.received == sequential.received);
  REQUIRE(parallel.sum == sequential.sum);
  REQUIRE(parallel.evidence_hash == sequential.evidence_hash);
  REQUIRE_FALSE(DevsEvidenceComparator::first_difference(
                    sequential.evidence_records, parallel.evidence_records)
                    .has_value());
}

TEST_CASE("PDEVS parallel execution requires explicit atom opt-in",
          "[devs][partition][parallel][safety]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* source = new PdevsSerialOnly();
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("source", std::unique_ptr<AtomicModel>(source));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("source", "out", "consumer", "in");
  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 2);
  REQUIRE_FALSE(executor.parallel_supported());
  REQUIRE(executor.run_parallel(1_ms, 2) == 1);
  REQUIRE(consumer->received_ == 1);
}

TEST_CASE("Executor injects external inputs on root input ports", "[devs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* consumer = new Consumer();
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple(".", "feed", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.load(*root);

  REQUIRE(executor.inject("feed", 77));
  REQUIRE(!executor.inject("unknown", 1));
  REQUIRE(consumer->received_ == 1);
  REQUIRE(consumer->last_payload_ == 77);
}

TEST_CASE("Unconnected output ports are dropped without crashing",
          "[devs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* gen = new Generator(2);
  root->add_atomic("gen", std::unique_ptr<AtomicModel>(gen));
  // No coupling for gen.out.

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.load(*root);
  REQUIRE(executor.run(100_ms) == 2);
  REQUIRE(gen->emitted_ == 2);
}

TEST_CASE("PDEVS batches simultaneous outputs into one input bag", "[devs][pdevs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* first = new PdevsGenerator(10);
  auto* second = new PdevsGenerator(20);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("first", std::unique_ptr<AtomicModel>(first));
  root->add_atomic("second", std::unique_ptr<AtomicModel>(second));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("first", "out", "consumer", "in");
  root->couple("second", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  REQUIRE(executor.load(*root) == 3);

  REQUIRE(executor.run(1_ms) == 2);
  REQUIRE(consumer->bag_calls_ == 1);
  REQUIRE(consumer->received_ == 2);
  REQUIRE(consumer->sum_ == 30);
  REQUIRE(consumer->last_elapsed_ == 1_ms);
  REQUIRE(consumer->last_now_ == 1_ms);
}

TEST_CASE("PDEVS evidence records paths, bags, outputs, and causal sources",
          "[devs][evidence]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* first = new PdevsGenerator(10);
  auto* second = new PdevsGenerator(20);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("first", std::unique_ptr<AtomicModel>(first));
  root->add_atomic("second", std::unique_ptr<AtomicModel>(second));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("first", "out", "consumer", "in");
  root->couple("second", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  DevsEvidenceRecorder evidence;
  executor.set_evidence_recorder(&evidence);
  executor.load(*root);
  REQUIRE(executor.run(1_ms) == 2);

  REQUIRE(evidence.event_count() == 3);
  REQUIRE(evidence.records()[0].sequence == 0);
  REQUIRE(evidence.records()[0].atom_path == "first");
  REQUIRE(evidence.records()[0].kind == DevsTransitionKind::kInternal);
  REQUIRE(evidence.records()[0].outputs.size() == 1);
  REQUIRE(evidence.records()[1].atom_path == "second");
  REQUIRE(evidence.records()[2].atom_path == "consumer");
  REQUIRE(evidence.records()[2].kind == DevsTransitionKind::kExternal);
  REQUIRE(evidence.records()[2].inputs.size() == 2);
  REQUIRE(evidence.records()[2].input_sources ==
          std::vector<std::uint32_t>{0, 1});
  REQUIRE(evidence.hash() != 0);
}

TEST_CASE("DEVS evidence archive is deterministic and rejects corruption",
          "[devs][evidence][archive]") {
  DevsEvidenceRecorder source;
  const std::array<PortEvent, 1> inputs{{PortEvent{3, 77}}};
  const std::array<std::uint32_t, 1> sources{{9}};
  const std::array<PortEvent, 1> outputs{{PortEvent{4, 88}}};
  source.record(2_ms, 5, "plant.machine", DevsTransitionKind::kConfluent,
                1_ms, inputs, sources, outputs);

  std::string error;
  const auto archive = DevsEvidenceCodec::encode(source.records());
  REQUIRE_FALSE(archive.empty());
  REQUIRE(archive == DevsEvidenceCodec::encode(source.records()));

  std::vector<DevsEvidenceRecord> decoded;
  REQUIRE(DevsEvidenceCodec::decode(archive, decoded, &error));
  REQUIRE(error.empty());
  REQUIRE(decoded.size() == 1);
  REQUIRE(decoded[0].atom_path == "plant.machine");
  REQUIRE(decoded[0].inputs == std::vector<PortEvent>{{PortEvent{3, 77}}});
  REQUIRE(decoded[0].input_sources == std::vector<std::uint32_t>{9});
  REQUIRE(decoded[0].outputs == std::vector<PortEvent>{{PortEvent{4, 88}}});

  DevsEvidenceRecorder restored;
  REQUIRE(restored.restore(std::move(decoded), &error));
  REQUIRE(restored.hash() == source.hash());

  auto corrupt = archive;
  corrupt[corrupt.size() / 2] ^= 0x01;
  REQUIRE_FALSE(DevsEvidenceCodec::decode(corrupt, decoded, &error));
  REQUIRE(error.find("checksum") != std::string::npos);
  REQUIRE_FALSE(DevsEvidenceCodec::decode(
      std::span<const std::uint8_t>(archive.data(), archive.size() - 1), decoded, &error));
}

TEST_CASE("PDEVS evidence builds a stable causal graph summary",
          "[devs][evidence][graph]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* first = new PdevsGenerator(10);
  auto* second = new PdevsGenerator(20);
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("first", std::unique_ptr<AtomicModel>(first));
  root->add_atomic("second", std::unique_ptr<AtomicModel>(second));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("first", "out", "consumer", "in");
  root->couple("second", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  DevsEvidenceRecorder evidence;
  executor.set_evidence_recorder(&evidence);
  REQUIRE(executor.load(*root) == 3);
  REQUIRE(executor.run(1_ms) == 2);

  DevsEvidenceGraph graph;
  std::string error;
  REQUIRE(DevsEvidenceGraph::build(evidence.records(), graph, &error));
  REQUIRE(error.empty());
  REQUIRE(graph.edges().size() == 2);
  REQUIRE(graph.edges()[0].source_path == "first");
  REQUIRE(graph.edges()[0].target_path == "consumer");
  REQUIRE(graph.edges()[0].messages == 1);
  REQUIRE(graph.edges()[0].transitions == 1);
  REQUIRE(graph.edges()[1].source_path == "second");
  REQUIRE(graph.edges()[1].target_path == "consumer");
  REQUIRE(graph.hash() == DevsEvidenceGraph::build(evidence.records()).hash());
}

TEST_CASE("DEVS evidence comparator reports the first field divergence",
          "[devs][evidence][diff]") {
  DevsEvidenceRecorder source;
  const std::array<PortEvent, 1> outputs{{PortEvent{4, 88}}};
  source.record(2_ms, 5, "plant.machine", DevsTransitionKind::kInternal,
                1_ms, {}, {}, outputs);
  auto actual = source.records();
  REQUIRE_FALSE(DevsEvidenceComparator::first_difference(source.records(), actual).has_value());

  actual[0].outputs[0].payload = 99;
  const auto divergence =
      DevsEvidenceComparator::first_difference(source.records(), actual);
  REQUIRE(divergence.has_value());
  REQUIRE(divergence->record_index == 0);
  REQUIRE(divergence->field == "outputs[0].payload");
  REQUIRE(divergence->expected == "88");
  REQUIRE(divergence->actual == "99");

  actual.push_back(actual.front());
  const auto count_divergence =
      DevsEvidenceComparator::first_difference(source.records(), actual);
  REQUIRE(count_divergence.has_value());
  REQUIRE(count_divergence->field == "record_count");
}

TEST_CASE("DEVS evidence file store installs atomically and validates on load",
          "[devs][evidence][store]") {
  DevsEvidenceRecorder source;
  const std::array<PortEvent, 1> outputs{{PortEvent{8, 123}}};
  source.record(3_ms, 2, "line.station", DevsTransitionKind::kInternal,
                3_ms, {}, {}, outputs);
  const auto path = std::filesystem::temp_directory_path() /
                    "logicpilot_evidence_store_test.lpev";
  std::error_code filesystem_error;
  std::filesystem::remove(path, filesystem_error);
  std::filesystem::remove(path.string() + ".tmp", filesystem_error);
  std::filesystem::remove(path.string() + ".bak", filesystem_error);

  FileEvidenceArchiveStore store{path};
  std::string error;
  REQUIRE(store.save(source, &error));
  DevsEvidenceRecorder restored;
  REQUIRE(store.load(restored, &error));
  REQUIRE(restored.hash() == source.hash());

  std::fstream corrupt(path, std::ios::in | std::ios::out | std::ios::binary);
  REQUIRE(corrupt.good());
  corrupt.seekp(0, std::ios::end);
  const auto end = corrupt.tellp();
  REQUIRE(end > 8);
  corrupt.seekp(end - std::streamoff(1));
  const char byte = '\0';
  corrupt.write(&byte, 1);
  corrupt.close();
  REQUIRE_FALSE(store.load(restored, &error));
  REQUIRE(error.find("checksum") != std::string::npos);

  std::filesystem::remove(path, filesystem_error);
  std::filesystem::remove(path.string() + ".tmp", filesystem_error);
  std::filesystem::remove(path.string() + ".bak", filesystem_error);
}

TEST_CASE("PDEVS invokes confluent transition for an imminent receiver",
          "[devs][pdevs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* source = new PdevsGenerator(7);
  auto* consumer = new PdevsConfluentConsumer();
  root->add_atomic("source", std::unique_ptr<AtomicModel>(source));
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple("source", "out", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.load(*root);

  REQUIRE(executor.run(1_ms) == 2);
  REQUIRE(consumer->confluent_calls_ == 1);
  REQUIRE(consumer->internal_calls_ == 0);
  REQUIRE(consumer->received_ == 1);
}

TEST_CASE("PDEVS root injection uses the elapsed-time input bag hook",
          "[devs][pdevs]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* consumer = new PdevsBagConsumer();
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple(".", "feed", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  executor.load(*root);

  REQUIRE(executor.inject("feed", 77));
  REQUIRE(consumer->bag_calls_ == 1);
  REQUIRE(consumer->received_ == 1);
  REQUIRE(consumer->sum_ == 77);
  REQUIRE(consumer->last_elapsed_ == SimTime::zero());
  REQUIRE(executor.run(SimTime::infinity()) == 0);
  REQUIRE(clock.now() == SimTime::zero());
}

TEST_CASE("PDEVS exact-imminent root injection invokes lambda then delta_con",
          "[devs][pdevs][confluent]") {
  auto root = std::make_unique<CoupledModel>("root");
  auto* consumer = new PdevsConfluentConsumer();
  root->add_atomic("consumer", std::unique_ptr<AtomicModel>(consumer));
  root->couple(".", "feed", "consumer", "in");

  BinaryHeapScheduler scheduler;
  SimulationClock clock;
  DevsExecutor executor{scheduler, clock};
  DevsEvidenceRecorder evidence;
  executor.set_evidence_recorder(&evidence);
  executor.load(*root);

  // The initial ta() scheduled an internal event at 1 ms. Move the external
  // clock to that exact timestamp before injecting the message.
  clock.advance_to(1_ms);
  REQUIRE(executor.inject("feed", 99));
  REQUIRE(consumer->lambda_calls_ == 1);
  REQUIRE(consumer->confluent_calls_ == 1);
  REQUIRE(consumer->internal_calls_ == 0);
  REQUIRE(consumer->received_ == 1);
  REQUIRE(evidence.event_count() == 1);
  REQUIRE(evidence.records()[0].kind == DevsTransitionKind::kConfluent);
  REQUIRE(evidence.records()[0].input_sources.size() == 1);
  REQUIRE(evidence.records()[0].input_sources[0] ==
          kExternalEvidenceSource);
  REQUIRE(executor.run(SimTime::infinity()) == 0);
  REQUIRE(clock.now() == 1_ms);
}

// DEVS-lite executor tests: routing, nesting, injection.
#include <catch2/catch_test_macros.hpp>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/coupled_model.h"
#include "logicpilot/devs/executor.h"

using namespace logicpilot;

namespace {

// Emits `count` events on port "out" at 1ms intervals, then goes passive.
class Generator final : public AtomicModel {
 public:
  explicit Generator(std::uint64_t count)
      : remaining_{count} {
    out_port_ = declare_port("out");
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
  Consumer() { in_port_ = declare_port("in"); }

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

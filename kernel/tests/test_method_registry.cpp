// Method Runtime Layer tests (docs/specs/method-runtime.md):
//   * MethodRegistry registration / lookup / idempotency
//   * VariableStore shared state
//   * RuntimeManager lifecycle orchestration (initialize/advance/shutdown)
//   * ProcessRuntime through the registry: batch lowering still produces a
//     runnable M/M/1 flow, and the lifecycle API reports the same metrics
//     as the legacy driver path.
#include <flatbuffers/flatbuffers.h>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/replication.h"
#include "logicpilot/runtime/method_plugin_manifest.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_manager.h"
#include "logicpilot/state/message_store.h"
#include "logicpilot/state/variable_store.h"

#include "ir_v2_generated.h"
#include "process_runtime.h"

using namespace logicpilot;
namespace v2 = logicpilot::ir::v2;
using Catch::Approx;

namespace {

// --- tiny v2 M/M/1 IR builder (same shape as test_ir_loader) ---------------

flatbuffers::Offset<v2::Distribution> distribution(flatbuffers::FlatBufferBuilder& builder,
                                                   std::uint8_t kind, std::vector<double> params) {
  return v2::CreateDistribution(builder, kind, builder.CreateVector(params));
}

flatbuffers::Offset<v2::Var> var_int(flatbuffers::FlatBufferBuilder& builder, const char* name,
                                     std::int64_t value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Int, false, value, 0.0, 0,
                       0);
}

flatbuffers::Offset<v2::Var> var_string(flatbuffers::FlatBufferBuilder& builder, const char* name,
                                        const char* value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_String, false, 0, 0.0,
                       builder.CreateString(value), 0);
}

flatbuffers::Offset<v2::Var> var_distribution(flatbuffers::FlatBufferBuilder& builder,
                                              const char* name,
                                              flatbuffers::Offset<v2::Distribution> dist) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Distribution, false, 0, 0.0,
                       0, dist);
}

flatbuffers::Offset<v2::Node> stage(flatbuffers::FlatBufferBuilder& builder, const char* name,
                                    const char* kind,
                                    std::vector<flatbuffers::Offset<v2::Var>> params) {
  return v2::CreateNode(builder, v2::CreateMetadata(builder, builder.CreateString(name), 0, 0, 0),
                        builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
                        builder.CreateVector(params), 0,
                        v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                                               builder.CreateString(kind), 0, 0),
                        0, 0, 0, 0, 0);
}

std::vector<std::uint8_t> build_flat_mm1_ir() {
  flatbuffers::FlatBufferBuilder builder;
  const auto resource = v2::CreateNode(
      builder, v2::CreateMetadata(builder, builder.CreateString("Server"), 0, 0, 0),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(
          std::vector<flatbuffers::Offset<v2::Var>>{var_int(builder, "capacity", 1)}),
      0,
      v2::CreateSemanticsRef(builder, builder.CreateString("process"),
                             builder.CreateString("resource"), 0, 0),
      0, 0, 0, 0, 0);
  const auto arrival = distribution(builder, 4, {0.8});
  const auto service_time = distribution(builder, 3, {1.0});
  const auto source =
      stage(builder, "In", "source", {var_distribution(builder, "arrival", arrival)});
  const auto queue = stage(builder, "Q", "queue", {var_int(builder, "capacity", 1000000)});
  const auto service = stage(
      builder, "S", "service",
      {var_distribution(builder, "time", service_time), var_string(builder, "resource", "Server")});
  const auto sink = stage(builder, "K", "sink", {});

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  const auto couple = [&](flatbuffers::Offset<flatbuffers::String> from,
                          flatbuffers::Offset<flatbuffers::String> to) {
    couplings.push_back(v2::CreateCoupling(builder, from, port_out, to, port_in));
  };
  const auto in_name = builder.CreateString("In");
  const auto q_name = builder.CreateString("Q");
  const auto s_name = builder.CreateString("S");
  const auto k_name = builder.CreateString("K");
  couple(in_name, q_name);
  couple(q_name, s_name);
  couple(s_name, k_name);

  const auto root =
      v2::CreateNode(builder, v2::CreateMetadata(builder, builder.CreateString("Flat"), 0, 0, 0),
                     builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
                     builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
                     v2::CreateSemanticsRef(builder, builder.CreateString("core"),
                                            builder.CreateString("model"), 0, 0),
                     builder.CreateVector(std::vector<flatbuffers::Offset<v2::Node>>{
                         resource, source, queue, service, sink}),
                     builder.CreateVector(couplings), 0, 0, 0);
  builder.Finish(v2::CreateModelFile(builder, 2, root, 0, 0), "LP2R");
  return std::vector<std::uint8_t>(builder.GetBufferPointer(),
                                   builder.GetBufferPointer() + builder.GetSize());
}

// Loads the flat M/M/1 IR; fails the test on a bad buffer.
IrLoadResult load_mm1() {
  const std::vector<std::uint8_t> bytes = build_flat_mm1_ir();
  IrLoadResult result = load_model_buffer(bytes.data(), bytes.size());
  REQUIRE(result.ok());
  return result;
}

// Minimal controllable method for RuntimeManager orchestration tests.
class TestMethod final : public SimulationMethod {
public:
  explicit TestMethod(std::string_view name) : name_(name) {}

  std::string_view method_name() const override { return name_; }

  bool initialize(RuntimeContext& context, const IrModelFile&, std::string* error) override {
    context_ = &context;
    if (fail_initialize_) {
      if (error != nullptr) {
        *error = "test failure";
      }
      return false;
    }
    ++initialized_;
    return true;
  }

  void advance(SimTime) override { ++advanced_; }
  void shutdown() override {
    ++shutdowns_;
    context_ = nullptr;
  }

  std::unique_ptr<ReplicationModel> to_replication_model(const IrModelFile&,
                                                         std::string*) override {
    return nullptr;
  }

  void set_fail_initialize(bool fail) { fail_initialize_ = fail; }

  RuntimeContext* context() const { return context_; }
  int initialized() const { return initialized_; }
  int advanced() const { return advanced_; }
  int shutdowns() const { return shutdowns_; }

private:
  std::string name_;
  RuntimeContext* context_{nullptr};
  bool fail_initialize_{false};
  int initialized_{0};
  int advanced_{0};
  int shutdowns_{0};
};

}  // namespace

TEST_CASE("method registry: register, create, contains and idempotency", "[runtime][registry]") {
  MethodRegistry& registry = MethodRegistry::instance();
  REQUIRE_FALSE(registry.contains("test_method_xyz"));

  int constructed = 0;
  registry.register_method("test_method_xyz", [&] {
    ++constructed;
    return std::make_unique<TestMethod>("test_method_xyz");
  });
  REQUIRE(registry.contains("test_method_xyz"));

  // First registration wins; re-registering must not replace the factory.
  registry.register_method("test_method_xyz", [] { return std::make_unique<TestMethod>("other"); });
  auto method = registry.create("test_method_xyz");
  REQUIRE(method != nullptr);
  REQUIRE(method->method_name() == "test_method_xyz");
  REQUIRE(constructed == 1);

  REQUIRE(registry.create("no_such_method") == nullptr);

  registry.register_method(
      "versioned_method_xyz", [] { return std::make_unique<TestMethod>("versioned_method_xyz"); },
      MethodRegistry::Descriptor{"2.4.0", {"3", "4"}});
  REQUIRE(registry.descriptor("versioned_method_xyz") != nullptr);
  REQUIRE(registry.descriptor("versioned_method_xyz")->runtime_version == "2.4.0");
  REQUIRE(registry.supports_semantics_version("versioned_method_xyz", "3"));
  REQUIRE_FALSE(registry.supports_semantics_version("versioned_method_xyz", "2"));
  REQUIRE(registry.supports_semantics_version("versioned_method_xyz", ""));

  // register_all_methods() must be idempotent and cover process + natives.
  register_all_methods();
  register_all_methods();
  REQUIRE(registry.contains("process"));
  REQUIRE(registry.contains("devs"));
  REQUIRE(registry.contains("agent"));
  REQUIRE(registry.contains("sd"));
}

TEST_CASE("variable store: typed shared state across methods", "[runtime]") {
  VariableStore store;
  REQUIRE_FALSE(store.has("inventory"));
  REQUIRE(store.get("inventory") == nullptr);

  store.set("inventory", std::int64_t{0});
  store.set("flag", true);
  store.set("label", std::string("Main"));
  REQUIRE(store.has("inventory"));
  REQUIRE(std::get<std::int64_t>(*store.get("inventory")) == 0);
  REQUIRE(std::get<bool>(*store.get("flag")));
  REQUIRE(std::get<std::string>(*store.get("label")) == "Main");

  // Methods mutate shared state (Process += produced, Agent -= consumed).
  const VariableValue* value = store.get("inventory");
  store.set("inventory", std::get<std::int64_t>(*value) + std::int64_t{5});
  REQUIRE(std::get<std::int64_t>(*store.get("inventory")) == 5);

  store.clear();
  REQUIRE(store.size() == 0);
  REQUIRE_FALSE(store.has("inventory"));
}

TEST_CASE("method plugin manifest: validates discovery metadata and registry binding",
          "[runtime][plugin]") {
  const auto parsed = parse_method_plugin_manifest(R"json({
    "schema": "logicpilot.method-plugin",
    "schemaVersion": 1,
    "package": "acme.petri-net",
    "method": "petri_test_xyz",
    "runtimeVersion": "2.1.0",
    "semanticsVersions": ["3", "4"],
    "runtime": {"kind": "linked", "entrypoint": "register_petri"},
    "dslLibraries": ["petri.lplib"]
  })json");
  REQUIRE(parsed.ok());
  REQUIRE(parsed.manifest.runtime_kind == PluginRuntimeKind::kLinked);
  REQUIRE(parsed.manifest.semantics_versions == std::vector<std::string>{"3", "4"});

  std::string error;
  MethodRegistry& registry = MethodRegistry::instance();
  REQUIRE(registry.register_manifest(
      parsed.manifest, [] { return std::make_unique<TestMethod>("petri_test_xyz"); }, &error));
  REQUIRE(registry.supports_semantics_version("petri_test_xyz", "4"));
  REQUIRE_FALSE(registry.supports_semantics_version("petri_test_xyz", "2"));

  const auto missing_artifact = parse_method_plugin_manifest(R"json({
    "schema": "logicpilot.method-plugin",
    "schemaVersion": 1,
    "package": "acme.fem",
    "method": "fem",
    "runtimeVersion": "1",
    "semanticsVersions": ["1"],
    "runtime": {"kind": "wasm", "entrypoint": "logicpilot_method_v1"}
  })json");
  REQUIRE_FALSE(missing_artifact.ok());
  REQUIRE(missing_artifact.error.find("MP1010") != std::string::npos);
}

TEST_CASE("message store: scheduler payload can reference typed envelopes", "[runtime][message]") {
  MessageStore messages;
  const MessageId id = messages.publish(MessageEnvelope{
      "urn:logicpilot:traffic:vehicle", 2, "flatbuffers", "agent", {0x01, 0x02, 0x03}});
  REQUIRE(id != kInvalidMessageId);
  REQUIRE(messages.is_type(id, "urn:logicpilot:traffic:vehicle", 2));
  REQUIRE_FALSE(messages.is_type(id, "urn:logicpilot:traffic:vehicle", 1));
  REQUIRE(messages.get(id)->source_method == "agent");
  REQUIRE(messages.get(id)->data == std::vector<std::uint8_t>{0x01, 0x02, 0x03});
  REQUIRE(messages.get(999) == nullptr);

  messages.clear();
  REQUIRE(messages.size() == 0);
  REQUIRE(messages.get(id) == nullptr);
}

TEST_CASE("runtime manager: lifecycle orchestrates attached methods", "[runtime][manager]") {
  SimulationClock clock;
  BinaryHeapScheduler scheduler{64};
  EventHandlerRegistry handlers;
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, handlers, variables};

  auto first = std::make_unique<TestMethod>("alpha");
  auto second = std::make_unique<TestMethod>("beta");
  TestMethod* first_ptr = first.get();
  TestMethod* second_ptr = second.get();
  REQUIRE(manager.add(std::move(first)));
  REQUIRE(manager.add(std::move(second)));
  REQUIRE(manager.method_count() == 2);

  // Duplicate method names are rejected.
  std::string duplicate_error;
  REQUIRE_FALSE(manager.add(std::make_unique<TestMethod>("alpha"), &duplicate_error));
  REQUIRE(duplicate_error.find("already attached") != std::string::npos);

  const IrLoadResult model = load_mm1();
  REQUIRE(manager.initialize(model.file));
  REQUIRE(first_ptr->initialized() == 1);
  REQUIRE(second_ptr->initialized() == 1);
  REQUIRE(first_ptr->context() != nullptr);
  REQUIRE(&first_ptr->context()->variables() == &variables);

  manager.advance(SimTime::from_ns(1'000));
  REQUIRE(first_ptr->advanced() == 1);
  REQUIRE(second_ptr->advanced() == 1);

  manager.shutdown();
  REQUIRE(first_ptr->shutdowns() == 1);
  REQUIRE(second_ptr->shutdowns() == 1);
  REQUIRE(first_ptr->context() == nullptr);
}

TEST_CASE("runtime manager: initialize fails fast on the first bad method", "[runtime][manager]") {
  SimulationClock clock;
  BinaryHeapScheduler scheduler{64};
  EventHandlerRegistry handlers;
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, handlers, variables};

  auto bad = std::make_unique<TestMethod>("bad");
  auto good = std::make_unique<TestMethod>("good");
  TestMethod* good_ptr = good.get();
  bad->set_fail_initialize(true);
  REQUIRE(manager.add(std::move(bad)));
  REQUIRE(manager.add(std::move(good)));

  const IrLoadResult model = load_mm1();
  std::string error;
  REQUIRE_FALSE(manager.initialize(model.file, &error));
  REQUIRE(error.find("bad") != std::string::npos);
  REQUIRE(good_ptr->initialized() == 0);
}

TEST_CASE("process method: registry lowers an M/M/1 flow to a runnable model",
          "[runtime][process]") {
  register_all_methods();
  const IrLoadResult model = load_mm1();

  // Direct registry lookup + batch adapter (the path build_replication_model
  // uses) must produce a runnable queueing flow.
  auto runtime = MethodRegistry::instance().create("process");
  REQUIRE(runtime != nullptr);
  std::string error;
  auto replication = runtime->to_replication_model(model.file, &error);
  REQUIRE(replication != nullptr);

  ReplicationConfig config;
  config.seed = 7;
  config.arrivals = 3000;
  config.warmup_arrivals = 500;
  const ReplicationMetrics metrics = replication->run(config, nullptr);
  REQUIRE(metrics.departures > 2400);
  REQUIRE(metrics.mean_wait > 1.0);
  REQUIRE(metrics.mean_wait < 12.0);
  REQUIRE(metrics.throughput > 0.5);
  REQUIRE(metrics.throughput < 1.0);
}

TEST_CASE(
    "process method: lifecycle API runs a replication and reports "
    "the same metrics as the batch path",
    "[runtime][process]") {
  register_all_methods();
  const IrLoadResult model = load_mm1();

  // Batch path baseline.
  auto runtime = MethodRegistry::instance().create("process");
  REQUIRE(runtime != nullptr);
  std::string error;
  auto batch_model = runtime->to_replication_model(model.file, &error);
  REQUIRE(batch_model != nullptr);
  // The lifecycle API drives one replication with the driver-default
  // ReplicationConfig, so the batch baseline uses the same defaults.
  ReplicationConfig config;
  const ReplicationMetrics baseline = batch_model->run(config, nullptr);

  // Lifecycle path: initialize -> advance (full replication, Phase 1 batch
  // semantics) -> shutdown.
  auto lifecycle = MethodRegistry::instance().create("process");
  SimulationClock clock;
  BinaryHeapScheduler scheduler{64};
  EventHandlerRegistry handlers;
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, handlers, variables};
  REQUIRE(manager.add(std::move(lifecycle)));
  REQUIRE(manager.initialize(model.file, &error));
  manager.advance(SimTime::infinity());
  manager.shutdown();

  // Re-check through a direct ProcessRuntime (metrics accessor).
  // (The world is driver-owned: reset it for the second replication.)
  clock.reset();
  handlers.clear();
  ProcessRuntime direct;
  REQUIRE(direct.initialize(manager.context(), model.file, &error));
  direct.advance(SimTime::infinity());
  const ReplicationMetrics lifecycle_metrics = direct.last_metrics();
  REQUIRE(lifecycle_metrics.departures == baseline.departures);
  REQUIRE(lifecycle_metrics.throughput == Approx(baseline.throughput));
  REQUIRE(lifecycle_metrics.mean_sojourn == Approx(baseline.mean_sojourn));
  REQUIRE(lifecycle_metrics.mean_wait == Approx(baseline.mean_wait));
  REQUIRE(lifecycle_metrics.utilization == Approx(baseline.utilization));
}

TEST_CASE(
    "process method: advance(until) steps incrementally and matches "
    "the batch metrics",
    "[runtime][process][incremental]") {
  register_all_methods();
  const IrLoadResult model = load_mm1();

  // Batch baseline (default driver config).
  auto runtime = MethodRegistry::instance().create("process");
  REQUIRE(runtime != nullptr);
  std::string error;
  auto batch_model = runtime->to_replication_model(model.file, &error);
  REQUIRE(batch_model != nullptr);
  ReplicationConfig config;
  const ReplicationMetrics baseline = batch_model->run(config, nullptr);

  // Lifecycle path with sliced advance: reset -> advance(t1) -> advance(t2)
  // -> ... -> advance(infinity). Each slice only changes WHERE the loop
  // pauses; the event sequence and final statistics stay identical.
  ProcessRuntime direct;
  SimulationClock clock;
  BinaryHeapScheduler scheduler{64};
  EventHandlerRegistry handlers;
  VariableStore variables;
  RuntimeManager manager{clock, scheduler, handlers, variables};
  REQUIRE(manager.add(std::make_unique<ProcessRuntime>()));
  REQUIRE(manager.initialize(model.file, &error));
  manager.advance(SimTime::from_ns(1'000'000));
  manager.advance(SimTime::from_ns(10'000'000));
  manager.advance(SimTime::from_ns(50'000'000));
  manager.advance(SimTime::infinity());
  manager.shutdown();

  // Compare through a direct ProcessRuntime that keeps the metrics.
  // (The world is driver-owned: reset it for the second replication.)
  clock.reset();
  handlers.clear();
  REQUIRE(direct.initialize(manager.context(), model.file, &error));
  direct.advance(SimTime::from_ns(1'000'000));
  direct.advance(SimTime::from_ns(10'000'000));
  direct.advance(SimTime::from_ns(50'000'000));
  direct.advance(SimTime::infinity());
  const ReplicationMetrics incremental = direct.last_metrics();
  REQUIRE(incremental.departures == baseline.departures);
  REQUIRE(incremental.throughput == Approx(baseline.throughput));
  REQUIRE(incremental.mean_sojourn == Approx(baseline.mean_sojourn));
  REQUIRE(incremental.mean_wait == Approx(baseline.mean_wait));
  REQUIRE(incremental.utilization == Approx(baseline.utilization));
}

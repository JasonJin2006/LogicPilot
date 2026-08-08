#include "logicpilot/runtime/wasm_method_plugin.h"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

#if defined(LOGICPILOT_HAS_WASMTIME)
#include <wasmtime.hh>
#endif

namespace logicpilot {

#if defined(LOGICPILOT_HAS_WASMTIME)
namespace {

// WASM method ABI v1 is intentionally capability-small and does not provide
// WASI. A guest exports a deterministic event plan and receives each event
// back through lp_on_event while retaining isolated state inside its Store.
// Required signatures are documented in docs/specs/method-runtime.md.
class WasmSimulationMethod final : public SimulationMethod {
public:
  WasmSimulationMethod(std::string method, std::shared_ptr<std::vector<std::uint8_t>> artifact)
      : method_(std::move(method)), artifact_(std::move(artifact)) {}

  [[nodiscard]] std::string_view method_name() const override { return method_; }
  [[nodiscard]] MethodCapabilities capabilities() const override {
    return {MethodExecutionMode::kSharedEventQueue, true, false};
  }

  bool initialize(RuntimeContext& context, const IrModelFile&, std::string* error) override {
    context_ = &context;
    session_ = std::make_unique<Session>();
    const std::uint64_t requested = std::max<std::uint64_t>(context.config().arrivals, 1);
    const std::uint64_t fuel = std::min<std::uint64_t>(100'000'000, 1'000'000 + requested * 10'000);
    if (auto result = session_->store.context().set_fuel(fuel); !result)
      return fail(error, "MP1208: cannot configure WASM fuel: " + result.err().message());

    auto compiled = compile(*session_);
    if (!compiled)
      return fail(error, "MP1203: cannot compile WASM artifact: " + compiled.err().message());
    session_->module = std::move(compiled.ok());
    auto instantiated = wasmtime::Instance::create(session_->store, *session_->module, {});
    if (!instantiated)
      return fail(error, "MP1204: cannot instantiate WASM plugin: " + instantiated.err().message());
    session_->instance = std::move(instantiated.ok());
    if (!load_exports(error))
      return false;

    const auto abi = call_i32(session_->abi, {}, error);
    if (!abi || *abi != 1)
      return fail(error, "MP1206: WASM plugin does not implement method ABI v1");
    const ReplicationConfig& config = context.config();
    const auto initialized =
        call_i32(session_->initialize,
                 {wasmtime::Val(static_cast<std::int64_t>(config.seed)),
                  wasmtime::Val(static_cast<std::int64_t>(config.arrivals)),
                  wasmtime::Val(static_cast<std::int64_t>(config.warmup_arrivals))},
                 error);
    if (!initialized || *initialized == 0)
      return fail(error, "MP1207: WASM plugin initialization failed");

    const auto event_count = call_i64(session_->event_count, {}, error);
    if (!event_count || *event_count < 0 ||
        static_cast<std::uint64_t>(*event_count) > config.arrivals + 1'000'000)
      return fail(error, "MP1209: WASM plugin returned an invalid event count");
    handler_ = context.handlers().add([this](const Event& event) {
      std::string ignored;
      const auto value = call_f64(session_->on_event,
                                  {wasmtime::Val(static_cast<std::int32_t>(event.type)),
                                   wasmtime::Val(static_cast<std::int64_t>(event.payload))},
                                  &ignored);
      if (value)
        context_->variables().set(method_ + "::value", *value);
    });
    for (std::int64_t index = 0; index < *event_count; ++index) {
      const std::initializer_list<wasmtime::Val> arg{wasmtime::Val(index)};
      const auto at = call_i64(session_->event_time, arg, error);
      const auto type = call_i32(session_->event_type, arg, error);
      const auto payload = call_i64(session_->event_payload, arg, error);
      if (!at || !type || !payload || *at < context.clock().now().as_ns())
        return fail(error, "MP1210: WASM plugin returned an invalid event");
      context.scheduler().schedule(SimTime::from_ns(*at), static_cast<EventType>(*type), handler_,
                                   static_cast<std::uint64_t>(*payload));
    }
    return true;
  }

  void advance(SimTime) override {}

  void shutdown() override {
    if (session_ != nullptr) {
      std::string ignored;
      if (const auto value = call_i64(session_->shutdown_arrivals, {}, &ignored))
        metrics_.arrivals = static_cast<std::uint64_t>(std::max<std::int64_t>(*value, 0));
      if (const auto value = call_i64(session_->shutdown_departures, {}, &ignored))
        metrics_.departures = static_cast<std::uint64_t>(std::max<std::int64_t>(*value, 0));
      if (const auto value = call_f64(session_->final_value, {}, &ignored))
        metrics_.final_value = *value;
      if (context_ != nullptr) {
        metrics_.horizon_seconds = context_->clock().now().as_seconds();
        if (metrics_.horizon_seconds > 0.0)
          metrics_.throughput = static_cast<double>(metrics_.departures) / metrics_.horizon_seconds;
      }
    }
    session_.reset();
    context_ = nullptr;
  }

  [[nodiscard]] std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile&, std::string* error) override {
    if (error != nullptr)
      *error = "WASM plugins require the SimulationKernel shared scheduler";
    return nullptr;
  }

  [[nodiscard]] ReplicationMetrics replication_metrics() const override { return metrics_; }

private:
  struct Session {
    static wasmtime::Engine engine_with_limits() {
      wasmtime::Config config;
      config.consume_fuel(true);
      config.max_wasm_stack(512 * 1024);
      return wasmtime::Engine(std::move(config));
    }
    Session() : engine(engine_with_limits()), store(engine) {}

    wasmtime::Engine engine;
    wasmtime::Store store;
    std::optional<wasmtime::Module> module;
    std::optional<wasmtime::Instance> instance;
    std::optional<wasmtime::Func> abi;
    std::optional<wasmtime::Func> initialize;
    std::optional<wasmtime::Func> event_count;
    std::optional<wasmtime::Func> event_time;
    std::optional<wasmtime::Func> event_type;
    std::optional<wasmtime::Func> event_payload;
    std::optional<wasmtime::Func> on_event;
    std::optional<wasmtime::Func> shutdown_arrivals;
    std::optional<wasmtime::Func> shutdown_departures;
    std::optional<wasmtime::Func> final_value;
  };

  wasmtime::Result<wasmtime::Module> compile(Session& session) const {
    if (artifact_->size() >= 4 && (*artifact_)[0] == 0 && (*artifact_)[1] == 'a' &&
        (*artifact_)[2] == 's' && (*artifact_)[3] == 'm') {
      return wasmtime::Module::compile(
          session.engine, wasmtime::Span<std::uint8_t>(artifact_->data(), artifact_->size()));
    }
    return wasmtime::Module::compile(
        session.engine,
        std::string_view(reinterpret_cast<const char*>(artifact_->data()), artifact_->size()));
  }

  bool load_exports(std::string* error) {
    const auto get = [&](std::string_view name, std::optional<wasmtime::Func>& out) {
      const auto item = session_->instance->get(session_->store, name);
      if (!item)
        return false;
      const auto* function = std::get_if<wasmtime::Func>(&*item);
      if (function == nullptr)
        return false;
      out = *function;
      return true;
    };
    if (!get("lp_abi_version", session_->abi) || !get("lp_initialize", session_->initialize) ||
        !get("lp_event_count", session_->event_count) ||
        !get("lp_event_time_ns", session_->event_time) ||
        !get("lp_event_type", session_->event_type) ||
        !get("lp_event_payload", session_->event_payload) ||
        !get("lp_on_event", session_->on_event) ||
        !get("lp_shutdown_arrivals", session_->shutdown_arrivals) ||
        !get("lp_shutdown_departures", session_->shutdown_departures) ||
        !get("lp_final_value", session_->final_value)) {
      return fail(error, "MP1205: WASM plugin is missing a required ABI v1 export");
    }
    return true;
  }

  template <typename T>
  std::optional<T> call(const std::optional<wasmtime::Func>& function,
                        std::initializer_list<wasmtime::Val> args, wasmtime::ValKind expected,
                        std::string* error) {
    if (!function)
      return std::nullopt;
    auto result = function->call(session_->store, args);
    if (!result) {
      if (error != nullptr)
        *error = "WASM trap: " + result.err().message();
      return std::nullopt;
    }
    auto values = std::move(result.ok());
    if (values.size() != 1 || values.front().kind() != expected) {
      if (error != nullptr)
        *error = "WASM export returned an unexpected type";
      return std::nullopt;
    }
    if constexpr (std::is_same_v<T, std::int32_t>) {
      return values.front().i32();
    } else if constexpr (std::is_same_v<T, std::int64_t>) {
      return values.front().i64();
    } else {
      return values.front().f64();
    }
  }

  std::optional<std::int32_t> call_i32(const std::optional<wasmtime::Func>& function,
                                       std::initializer_list<wasmtime::Val> args,
                                       std::string* error) {
    return call<std::int32_t>(function, args, wasmtime::ValKind::I32, error);
  }
  std::optional<std::int64_t> call_i64(const std::optional<wasmtime::Func>& function,
                                       std::initializer_list<wasmtime::Val> args,
                                       std::string* error) {
    return call<std::int64_t>(function, args, wasmtime::ValKind::I64, error);
  }
  std::optional<double> call_f64(const std::optional<wasmtime::Func>& function,
                                 std::initializer_list<wasmtime::Val> args, std::string* error) {
    return call<double>(function, args, wasmtime::ValKind::F64, error);
  }

  static bool fail(std::string* error, std::string message) {
    if (error != nullptr)
      *error = std::move(message);
    return false;
  }

  std::string method_;
  std::shared_ptr<std::vector<std::uint8_t>> artifact_;
  std::unique_ptr<Session> session_;
  RuntimeContext* context_{nullptr};
  HandlerId handler_{0};
  ReplicationMetrics metrics_{};
};

}  // namespace
#endif

bool wasm_method_host_available() {
#if defined(LOGICPILOT_HAS_WASMTIME)
  return true;
#else
  return false;
#endif
}

bool load_wasm_method_plugin(const MethodPluginManifest& manifest,
                             const std::filesystem::path& manifest_directory,
                             MethodRegistry& registry, std::string* error) {
  const auto fail = [&](std::string message) {
    if (error != nullptr)
      *error = std::move(message);
    return false;
  };
  if (manifest.runtime_kind != PluginRuntimeKind::kWasm)
    return fail("MP1201: manifest runtime kind is not 'wasm'");
#if !defined(LOGICPILOT_HAS_WASMTIME)
  (void)manifest_directory;
  (void)registry;
  return fail("MP1200: LogicPilot was built without a Wasmtime host");
#else
  std::filesystem::path artifact = manifest.artifact;
  if (artifact.is_relative())
    artifact = manifest_directory / artifact;
  std::ifstream stream(artifact, std::ios::binary);
  if (!stream)
    return fail("MP1202: cannot read WASM plugin artifact '" + artifact.string() + "'");
  auto bytes = std::make_shared<std::vector<std::uint8_t>>(std::istreambuf_iterator<char>(stream),
                                                           std::istreambuf_iterator<char>());
  if (bytes->empty())
    return fail("MP1202: WASM plugin artifact is empty");
  MethodRegistry::Factory factory = [method = manifest.method, bytes] {
    return std::make_unique<WasmSimulationMethod>(method, bytes);
  };
  return registry.register_manifest(manifest, std::move(factory), error);
#endif
}

}  // namespace logicpilot

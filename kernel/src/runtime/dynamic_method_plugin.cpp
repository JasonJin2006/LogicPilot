#include "logicpilot/runtime/dynamic_method_plugin.h"

#include <array>
#include <cstring>
#include <memory>
#include <string>
#include <utility>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/runtime/method_plugin_abi.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "logicpilot/runtime/simulation_method.h"

namespace logicpilot {
namespace {

class DynamicLibrary {
public:
  explicit DynamicLibrary(const std::filesystem::path& path) {
#if defined(_WIN32)
    handle_ = LoadLibraryW(path.c_str());
#else
    handle_ = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
  }
  ~DynamicLibrary() {
    if (handle_ == nullptr)
      return;
#if defined(_WIN32)
    FreeLibrary(handle_);
#else
    dlclose(handle_);
#endif
  }
  DynamicLibrary(const DynamicLibrary&) = delete;
  DynamicLibrary& operator=(const DynamicLibrary&) = delete;

  [[nodiscard]] bool valid() const { return handle_ != nullptr; }
  [[nodiscard]] void* symbol(const char* name) const {
#if defined(_WIN32)
    return reinterpret_cast<void*>(GetProcAddress(handle_, name));
#else
    return dlsym(handle_, name);
#endif
  }

private:
#if defined(_WIN32)
  HMODULE handle_{nullptr};
#else
  void* handle_{nullptr};
#endif
};

ReplicationMetrics from_abi(const lp_replication_metrics_v1& value) {
  ReplicationMetrics out;
  out.arrivals = value.arrivals;
  out.departures = value.departures;
  out.horizon_seconds = value.horizon_seconds;
  out.throughput = value.throughput;
  out.mean_in_system = value.mean_in_system;
  out.mean_in_queue = value.mean_in_queue;
  out.mean_sojourn = value.mean_sojourn;
  out.mean_wait = value.mean_wait;
  out.mean_measure = value.mean_measure;
  out.measure_count = value.measure_count;
  out.utilization = value.utilization;
  out.availability = value.availability;
  out.final_value = value.final_value;
  return out;
}

class CAbiSimulationMethod final : public SimulationMethod {
public:
  CAbiSimulationMethod(std::shared_ptr<DynamicLibrary> library, const lp_method_plugin_v1* api)
      : library_(std::move(library)), api_(api), instance_(api_->create()) {}

  ~CAbiSimulationMethod() override {
    if (instance_ != nullptr)
      api_->destroy(instance_);
  }

  [[nodiscard]] bool valid() const { return instance_ != nullptr; }
  [[nodiscard]] std::string_view method_name() const override { return api_->method_name; }
  [[nodiscard]] MethodCapabilities capabilities() const override {
    return {MethodExecutionMode::kSharedEventQueue, true, false};
  }

  bool initialize(RuntimeContext& context, const IrModelFile& model, std::string* error) override {
    context_ = &context;
    handler_ = context.handlers().add(
        [this](const Event& event) { api_->on_event(instance_, event.type, event.payload); });
    host_ = lp_method_host_v1{LP_METHOD_PLUGIN_ABI_V1,
                              sizeof(lp_method_host_v1),
                              this,
                              &host_now_ns,
                              &host_schedule,
                              &host_cancel,
                              &host_set_f64,
                              &host_get_f64,
                              &host_publish_message};
    const ReplicationConfig& config = context.config();
    const lp_replication_config_v1 abi_config{config.seed, config.arrivals, config.warmup_arrivals};
    std::array<char, 512> message{};
    const int32_t ok = api_->initialize(instance_, model.v2_bytes.data(), model.v2_bytes.size(),
                                        &abi_config, &host_, message.data(), message.size());
    if (ok == 0) {
      if (error != nullptr)
        *error = message[0] == '\0' ? "C ABI plugin initialize failed" : message.data();
      context_ = nullptr;
      return false;
    }
    return true;
  }

  void advance(SimTime) override {}

  void shutdown() override {
    lp_replication_metrics_v1 metrics{};
    api_->shutdown(instance_, &metrics);
    metrics_ = from_abi(metrics);
    context_ = nullptr;
  }

  [[nodiscard]] std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile&, std::string* error) override {
    if (error != nullptr)
      *error = "C ABI plugins require the SimulationKernel shared scheduler";
    return nullptr;
  }

  [[nodiscard]] ReplicationMetrics replication_metrics() const override { return metrics_; }

private:
  static int64_t host_now_ns(void* opaque) {
    const auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    return self->context_ == nullptr ? 0 : self->context_->clock().now().as_ns();
  }

  static int32_t host_schedule(void* opaque, int64_t at_ns, uint32_t type, uint64_t payload,
                               lp_event_token_v1* token) {
    auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    if (self->context_ == nullptr || token == nullptr ||
        at_ns < self->context_->clock().now().as_ns())
      return 0;
    try {
      const EventToken event = self->context_->scheduler().schedule(SimTime::from_ns(at_ns), type,
                                                                    self->handler_, payload);
      if (!event.valid())
        return 0;
      *token = lp_event_token_v1{event.id, event.generation, 0};
      return 1;
    } catch (...) {
      return 0;
    }
  }

  static int32_t host_cancel(void* opaque, const lp_event_token_v1* token) {
    auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    if (self->context_ == nullptr || token == nullptr)
      return 0;
    return self->context_->scheduler().cancel(EventToken{token->id, token->generation}) ? 1 : 0;
  }

  static int32_t host_set_f64(void* opaque, const char* name, double value) {
    auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    if (self->context_ == nullptr || name == nullptr || *name == '\0')
      return 0;
    try {
      self->context_->variables().set(name, value);
      return 1;
    } catch (...) {
      return 0;
    }
  }

  static int32_t host_get_f64(void* opaque, const char* name, double* value) {
    auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    if (self->context_ == nullptr || name == nullptr || value == nullptr)
      return 0;
    const VariableValue* stored = nullptr;
    try {
      stored = self->context_->variables().get(name);
    } catch (...) {
      return 0;
    }
    if (stored == nullptr)
      return 0;
    if (const auto* number = std::get_if<double>(stored)) {
      *value = *number;
      return 1;
    }
    if (const auto* integer = std::get_if<std::int64_t>(stored)) {
      *value = static_cast<double>(*integer);
      return 1;
    }
    return 0;
  }

  static uint64_t host_publish_message(void* opaque, const char* type_uri, uint32_t schema_version,
                                       const char* encoding, const uint8_t* data,
                                       size_t data_size) {
    auto* self = static_cast<CAbiSimulationMethod*>(opaque);
    if (self->context_ == nullptr || type_uri == nullptr || *type_uri == '\0' ||
        (data == nullptr && data_size != 0))
      return 0;
    try {
      MessageEnvelope envelope;
      envelope.type_uri = type_uri;
      envelope.schema_version = schema_version;
      envelope.encoding = encoding == nullptr ? "application/octet-stream" : encoding;
      envelope.source_method = self->api_->method_name;
      if (data_size != 0)
        envelope.data.assign(data, data + data_size);
      return self->context_->messages().publish(std::move(envelope));
    } catch (...) {
      return 0;
    }
  }

  std::shared_ptr<DynamicLibrary> library_;
  const lp_method_plugin_v1* api_;
  void* instance_{nullptr};
  RuntimeContext* context_{nullptr};
  HandlerId handler_{0};
  lp_method_host_v1 host_{};
  ReplicationMetrics metrics_{};
};

}  // namespace

bool load_dynamic_method_plugin(const MethodPluginManifest& manifest,
                                const std::filesystem::path& manifest_directory,
                                MethodRegistry& registry, std::string* error) {
  const auto fail = [&](std::string message) {
    if (error != nullptr)
      *error = std::move(message);
    return false;
  };
  if (manifest.runtime_kind != PluginRuntimeKind::kCAbi)
    return fail("MP1101: manifest runtime kind is not 'c-abi'");
  if (manifest.artifact.empty() || manifest.entrypoint.empty())
    return fail("MP1102: C ABI plugin requires artifact and entrypoint");

  std::filesystem::path artifact = manifest.artifact;
  if (artifact.is_relative())
    artifact = manifest_directory / artifact;
  auto library = std::make_shared<DynamicLibrary>(artifact);
  if (!library->valid())
    return fail("MP1103: cannot load plugin artifact '" + artifact.string() + "'");

  void* symbol = library->symbol(manifest.entrypoint.c_str());
  if (symbol == nullptr)
    return fail("MP1104: plugin entrypoint '" + manifest.entrypoint + "' was not found");
  const auto entrypoint = reinterpret_cast<lp_method_plugin_entrypoint_v1>(symbol);
  const lp_method_plugin_v1* api = entrypoint();
  if (api == nullptr || api->abi_version != LP_METHOD_PLUGIN_ABI_V1 ||
      api->struct_size < sizeof(lp_method_plugin_v1))
    return fail("MP1105: plugin does not implement LogicPilot method ABI v1");
  if (api->method_name == nullptr || manifest.method != api->method_name)
    return fail("MP1106: plugin method identity does not match manifest");
  if (api->create == nullptr || api->destroy == nullptr || api->initialize == nullptr ||
      api->on_event == nullptr || api->shutdown == nullptr)
    return fail("MP1107: plugin method table is incomplete");

  MethodRegistry::Factory factory = [library, api] {
    auto method = std::make_unique<CAbiSimulationMethod>(library, api);
    if (!method->valid())
      return std::unique_ptr<SimulationMethod>{};
    return std::unique_ptr<SimulationMethod>{std::move(method)};
  };
  return registry.register_manifest(manifest, std::move(factory), error);
}

}  // namespace logicpilot

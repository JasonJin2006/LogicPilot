#include <cstdint>
#include <new>

#include "logicpilot/runtime/method_plugin_abi.h"

namespace {

struct State {
  const lp_method_host_v1* host{nullptr};
  std::uint64_t count{0};
};

void* create() {
  return new (std::nothrow) State;
}
void destroy(void* instance) {
  delete static_cast<State*>(instance);
}

int32_t initialize(void* instance, const uint8_t* ir, size_t ir_size,
                   const lp_replication_config_v1* config, const lp_method_host_v1* host, char*,
                   size_t) {
  auto* state = static_cast<State*>(instance);
  if (state == nullptr || ir == nullptr || ir_size == 0 || config == nullptr || host == nullptr ||
      host->abi_version != LP_METHOD_PLUGIN_ABI_V1)
    return 0;
  state->host = host;
  state->count = 0;
  for (std::uint64_t i = 0; i < config->arrivals; ++i) {
    lp_event_token_v1 token{};
    if (host->schedule(host->context, static_cast<std::int64_t>(i + 1), 701, i + 10, &token) == 0)
      return 0;
  }
  // Exercise the cancellation bridge: this event must never be delivered.
  lp_event_token_v1 cancelled{};
  if (host->schedule(host->context, 1'000'000, 799, 0, &cancelled) == 0 ||
      host->cancel(host->context, &cancelled) == 0)
    return 0;
  const std::uint8_t payload[]{1, 2, 3};
  if (host->publish_message(host->context, "test://cabi/initialized", 1, "application/octet-stream",
                            payload, sizeof(payload)) == 0)
    return 0;
  return 1;
}

void on_event(void* instance, uint32_t event_type, uint64_t) {
  auto* state = static_cast<State*>(instance);
  if (event_type != 701)
    return;
  ++state->count;
  state->host->set_f64(state->host->context, "cabi::count", static_cast<double>(state->count));
}

void shutdown(void* instance, lp_replication_metrics_v1* metrics) {
  const auto* state = static_cast<State*>(instance);
  metrics->arrivals = state->count;
  metrics->departures = state->count;
  metrics->horizon_seconds = static_cast<double>(state->host->now_ns(state->host->context)) * 1e-9;
  metrics->throughput = metrics->horizon_seconds == 0.0
                            ? 0.0
                            : static_cast<double>(state->count) / metrics->horizon_seconds;
  metrics->final_value = static_cast<double>(state->count);
}

const lp_method_plugin_v1 kPlugin{LP_METHOD_PLUGIN_ABI_V1,
                                  sizeof(lp_method_plugin_v1),
                                  "cabi_test_method",
                                  "1.0.0",
                                  &create,
                                  &destroy,
                                  &initialize,
                                  &on_event,
                                  &shutdown};

}  // namespace

extern "C" LP_METHOD_PLUGIN_EXPORT const lp_method_plugin_v1* logicpilot_test_method_v1() {
  return &kPlugin;
}

// Stable, compiler-neutral ABI for native LogicPilot method plugins.
//
// This header is deliberately valid C11: no STL types, exceptions, RTTI or
// C++ object layouts cross the shared-library boundary. Structures are
// append-only and guarded by explicit ABI/size fields.
#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define LP_METHOD_PLUGIN_EXPORT __declspec(dllexport)
#else
#define LP_METHOD_PLUGIN_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define LP_METHOD_PLUGIN_ABI_V1 1u

typedef struct lp_replication_config_v1 {
  uint64_t seed;
  uint64_t arrivals;
  uint64_t warmup_arrivals;
} lp_replication_config_v1;

typedef struct lp_replication_metrics_v1 {
  uint64_t arrivals;
  uint64_t departures;
  double horizon_seconds;
  double throughput;
  double mean_in_system;
  double mean_in_queue;
  double mean_sojourn;
  double mean_wait;
  double mean_measure;
  uint64_t measure_count;
  double utilization;
  double availability;
  double final_value;
} lp_replication_metrics_v1;

typedef struct lp_event_token_v1 {
  uint64_t id;
  uint32_t generation;
  uint32_t reserved;
} lp_event_token_v1;

// Host services are only valid between initialize() and shutdown(). Strings
// are UTF-8 and borrowed for the duration of the call. Non-zero integer
// results mean success. Plugins must not let exceptions cross this C ABI.
typedef struct lp_method_host_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  void* context;
  int64_t (*now_ns)(void* context);
  int32_t (*schedule)(void* context, int64_t at_ns, uint32_t event_type, uint64_t payload,
                      lp_event_token_v1* token);
  int32_t (*cancel)(void* context, const lp_event_token_v1* token);
  int32_t (*set_f64)(void* context, const char* name, double value);
  int32_t (*get_f64)(void* context, const char* name, double* value);
  uint64_t (*publish_message)(void* context, const char* type_uri, uint32_t schema_version,
                              const char* encoding, const uint8_t* data, size_t data_size);
} lp_method_host_v1;

typedef struct lp_method_plugin_v1 {
  uint32_t abi_version;
  uint32_t struct_size;
  const char* method_name;
  const char* runtime_version;

  void* (*create)(void);
  void (*destroy)(void* instance);

  // Returns non-zero on success. The verified FlatBuffer IR is borrowed only
  // for this call. A plugin may report a UTF-8 error into error_buffer.
  int32_t (*initialize)(void* instance, const uint8_t* ir, size_t ir_size,
                        const lp_replication_config_v1* config, const lp_method_host_v1* host,
                        char* error_buffer, size_t error_buffer_size);
  void (*on_event)(void* instance, uint32_t event_type, uint64_t payload);
  void (*shutdown)(void* instance, lp_replication_metrics_v1* metrics);
} lp_method_plugin_v1;

// A manifest's `entrypoint` names a function with this signature.
typedef const lp_method_plugin_v1* (*lp_method_plugin_entrypoint_v1)(void);

#ifdef __cplusplus
}
#endif

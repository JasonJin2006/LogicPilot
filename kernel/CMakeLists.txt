# LogicPilot kernel build.
#
# Targets:
#   logicpilot_kernel        - static core library (time/scheduler/random/memory)
#   hello_kernel             - Phase 0 toolchain smoke test
#   logicpilot_kernel_tests  - Catch2 unit tests (CTest, LOGICPILOT_BUILD_TESTS)
#   logicpilot_bench         - google/benchmark perf gates (LOGICPILOT_BUILD_BENCH),
#                              sources live in <root>/bench/ (budget #1, ADR-0007)
#
# Reserved apps (implemented in later phases):
#   add_subdirectory(apps/lpcli)
#   add_subdirectory(apps/lp-server)  (Phase 2c, task #7)

find_package(nlohmann_json CONFIG REQUIRED)

set(LOGICPILOT_WASMTIME_ROOT "" CACHE PATH
  "Root of a Wasmtime C API distribution (include/ and lib/)"
)
if(LOGICPILOT_WASMTIME_ROOT)
  find_path(LOGICPILOT_WASMTIME_INCLUDE_DIR wasmtime.hh
    PATHS "${LOGICPILOT_WASMTIME_ROOT}/include" NO_DEFAULT_PATH
  )
  if(WIN32 AND EXISTS "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll.lib")
    set(LOGICPILOT_WASMTIME_LIBRARY
      "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll.lib")
  else()
    find_library(LOGICPILOT_WASMTIME_LIBRARY NAMES wasmtime
      PATHS "${LOGICPILOT_WASMTIME_ROOT}/lib" NO_DEFAULT_PATH
    )
  endif()
endif()

add_library(logicpilot_kernel STATIC
  src/binary_heap_scheduler.cpp
  src/runtime/method_plugin_manifest.cpp
  src/runtime/dynamic_method_plugin.cpp
  src/runtime/wasm_method_plugin.cpp
  src/runtime/method_registry.cpp
  src/runtime/runtime_manager.cpp
  src/runtime/simulation_kernel.cpp
)
target_include_directories(logicpilot_kernel PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_compile_features(logicpilot_kernel PUBLIC cxx_std_20)
target_link_libraries(logicpilot_kernel PUBLIC nlohmann_json::nlohmann_json ${CMAKE_DL_LIBS})
if(LOGICPILOT_WASMTIME_INCLUDE_DIR AND LOGICPILOT_WASMTIME_LIBRARY)
  target_compile_definitions(logicpilot_kernel PRIVATE LOGICPILOT_HAS_WASMTIME=1)
  target_include_directories(logicpilot_kernel SYSTEM PRIVATE ${LOGICPILOT_WASMTIME_INCLUDE_DIR})
  target_link_libraries(logicpilot_kernel PRIVATE ${LOGICPILOT_WASMTIME_LIBRARY})
  set(LOGICPILOT_HAS_WASMTIME TRUE)
  if(WIN32 AND EXISTS "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll")
    configure_file("${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll"
      "${CMAKE_CURRENT_BINARY_DIR}/wasmtime.dll" COPYONLY)
  endif()
  message(STATUS "Wasmtime method host: ${LOGICPILOT_WASMTIME_LIBRARY}")
else()
  message(STATUS "Wasmtime method host: disabled (set LOGICPILOT_WASMTIME_ROOT)")
endif()

# Minimal smoke-test binary: proves the C++20 toolchain + vcpkg wiring works.
add_executable(hello_kernel src/hello_kernel.cpp)
target_link_libraries(hello_kernel PRIVATE logicpilot_kernel)

if(LOGICPILOT_BUILD_TESTS)
  enable_testing()
  find_package(Catch2 3 REQUIRED)
  include(Catch)
  add_subdirectory(tests)
endif()

if(LOGICPILOT_BUILD_BENCH)
  find_package(benchmark CONFIG REQUIRED)
  add_executable(logicpilot_bench
    ${CMAKE_SOURCE_DIR}/bench/scheduler_bench.cpp
    ${CMAKE_SOURCE_DIR}/bench/rng_bench.cpp
  )
  target_link_libraries(logicpilot_bench PRIVATE
    logicpilot_kernel
    benchmark::benchmark_main
  )
endif()

# ---------------------------------------------------------------------------
# Phase 1b: agent runtime / statemachine / DEVS-lite / M/M/1 (task #4).
# Appended below; the core section above is owned by Phase 1a.
# ---------------------------------------------------------------------------
find_package(EnTT CONFIG REQUIRED)
find_package(fmt CONFIG REQUIRED)

add_library(logicpilot_phase1b STATIC
  src/agent/soa_agent_store.cpp
  src/devs/executor.cpp
  src/devs/ir_atomic.cpp
  src/devs/ir_agent.cpp
  src/devs/continuous.cpp
  src/devs/replication.cpp
  src/devs/mm1.cpp
  src/devs/ir_loader.cpp
  src/runtime/builtin_methods.cpp
)
target_link_libraries(logicpilot_phase1b PUBLIC
  logicpilot_kernel
  logicpilot_schemas   # ir_v2_generated.h + flatbuffers runtime
  EnTT::EnTT
)

# lpcli (Phase 1b ships the `run` subcommand; compile lands in Phase 2).
add_subdirectory(apps/lpcli)
if(LOGICPILOT_HAS_WASMTIME AND WIN32 AND
   EXISTS "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll")
  configure_file("${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll"
    "${CMAKE_CURRENT_BINARY_DIR}/apps/lpcli/wasmtime.dll" COPYONLY)
endif()

if(LOGICPILOT_BUILD_TESTS)
  add_library(logicpilot_test_cabi_plugin SHARED
    tests/plugins/test_cabi_plugin.cpp
  )
  target_include_directories(logicpilot_test_cabi_plugin PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  )
  target_compile_features(logicpilot_test_cabi_plugin PRIVATE cxx_std_20)

  add_executable(logicpilot_phase1b_tests
    tests/test_agent_runtime.cpp
    tests/test_state_machine.cpp
    tests/test_devs.cpp
    tests/test_ir_loader.cpp
    tests/test_process_flow.cpp
    tests/test_replication_parallel.cpp
    tests/test_method_registry.cpp
    tests/test_dynamic_method_plugin.cpp
    tests/test_statechart_runtime.cpp
    tests/test_simulation_kernel.cpp
    tests/test_mm1_acceptance.cpp
    tests/test_mm1_failure.cpp
    tests/test_continuous.cpp
    tests/test_determinism.cpp
    tests/test_perf_baseline.cpp
  )
  target_link_libraries(logicpilot_phase1b_tests PRIVATE
    logicpilot_phase1b
    logicpilot_methods
    Catch2::Catch2WithMain
  )
  target_compile_definitions(logicpilot_phase1b_tests PRIVATE
    LOGICPILOT_EXAMPLES_DIR="${CMAKE_SOURCE_DIR}/examples"
    TEST_CABI_PLUGIN_PATH="$<TARGET_FILE:logicpilot_test_cabi_plugin>"
  )
  add_dependencies(logicpilot_phase1b_tests logicpilot_test_cabi_plugin)
  if(LOGICPILOT_HAS_WASMTIME)
    target_sources(logicpilot_phase1b_tests PRIVATE tests/test_wasm_method_plugin.cpp)
    target_compile_definitions(logicpilot_phase1b_tests PRIVATE
      TEST_WASM_PLUGIN_PATH="${CMAKE_CURRENT_SOURCE_DIR}/tests/plugins/test_wasm_method.wat"
    )
    if(WIN32 AND EXISTS "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll")
      add_custom_command(TARGET logicpilot_phase1b_tests POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${LOGICPILOT_WASMTIME_ROOT}/lib/wasmtime.dll"
          "$<TARGET_FILE_DIR:logicpilot_phase1b_tests>"
      )
    endif()
  endif()
  catch_discover_tests(logicpilot_phase1b_tests)
endif()

if(LOGICPILOT_BUILD_TESTS AND LOGICPILOT_BUILD_DSL)
  # IR atomic execution tests compile examples/pulse_chain.lp in-process, so
  # they need the DSL compiler (mirrors logicpilot_server_tests).
  target_sources(logicpilot_phase1b_tests PRIVATE
    tests/test_ir_atomic.cpp
    tests/test_ir_agent.cpp
    tests/test_scale_smoke.cpp
  )
  target_link_libraries(logicpilot_phase1b_tests PRIVATE logicpilot_dsl)
endif()

# ---------------------------------------------------------------------------
# Phase 2c (task #7): lp-server WebSocket gateway (Boost.Beast).
# lp_server_core is a static library so both the lp-server executable and the
# lpcli `serve` subcommand can embed the gateway in-process.
# ---------------------------------------------------------------------------
# vcpkg's boost umbrella ships BoostConfig.cmake; CONFIG mode avoids the
# removed FindBoost module (CMP0167).
find_package(Boost CONFIG REQUIRED)
add_library(lp_server_core STATIC
  apps/lp-server/wire_frames.cpp
  apps/lp-server/sim_runner.cpp
  apps/lp-server/server.cpp
)
target_include_directories(lp_server_core PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/apps/lp-server
)
target_link_libraries(lp_server_core PUBLIC
  logicpilot_phase1b
  logicpilot_methods
  Boost::headers
  fmt::fmt
  nlohmann_json::nlohmann_json
)
if(LOGICPILOT_BUILD_DSL)
  # The `compile` control command compiles client DSL in-process; the IDE
  # uses it for generate-DSL + diagnostics (P1-7).
  target_link_libraries(lp_server_core PUBLIC logicpilot_dsl)
  target_compile_definitions(lp_server_core PUBLIC LOGICPILOT_HAS_DSL=1)
endif()
# Boost.Asio needs the Winsock libraries on Windows/MinGW.
if(WIN32)
  target_link_libraries(lp_server_core PUBLIC ws2_32 mswsock)
endif()

add_executable(lp-server apps/lp-server/main.cpp)
target_link_libraries(lp-server PRIVATE lp_server_core)

if(LOGICPILOT_BUILD_TESTS AND LOGICPILOT_BUILD_DSL)
  # Integration tests drive the full DSL -> IR -> lp-server pipeline, so the
  # DSL compiler is linked in to compile examples/mm1.lp in-process.
  add_executable(logicpilot_server_tests
    tests/test_lp_server_integration.cpp
    tests/test_json_controls.cpp
    tests/test_project_io.cpp
  )
  target_link_libraries(logicpilot_server_tests PRIVATE
    lp_server_core
    logicpilot_dsl
    Catch2::Catch2WithMain
  )
  target_compile_definitions(logicpilot_server_tests PRIVATE
    LOGICPILOT_EXAMPLES_DIR="${CMAKE_SOURCE_DIR}/examples"
  )
  catch_discover_tests(logicpilot_server_tests)
endif()

if(LOGICPILOT_BUILD_BENCH)
  # MM1-style event-loop baseline (budget #2 MVP gate, bench/mm1_event_bench).
  add_executable(mm1_event_bench
    ${CMAKE_SOURCE_DIR}/bench/mm1_event_bench.cpp
  )
  target_link_libraries(mm1_event_bench PRIVATE
    logicpilot_phase1b
    benchmark::benchmark_main
  )

  # Generic process-flow engine baseline (budget #2 extension): modular
  # ProcessFlowSim throughput, bench/process_flow_bench.cpp.
  add_executable(process_flow_bench
    ${CMAKE_SOURCE_DIR}/bench/process_flow_bench.cpp
  )
  target_link_libraries(process_flow_bench PRIVATE
    logicpilot_methods
    benchmark::benchmark_main
  )
endif()

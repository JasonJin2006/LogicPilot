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

add_library(logicpilot_kernel STATIC
  src/binary_heap_scheduler.cpp
)
target_include_directories(logicpilot_kernel PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_compile_features(logicpilot_kernel PUBLIC cxx_std_20)

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
  src/devs/replication.cpp
  src/devs/mm1.cpp
  src/devs/ir_loader.cpp
)
target_link_libraries(logicpilot_phase1b PUBLIC
  logicpilot_kernel
  logicpilot_schemas   # ir_generated.h + flatbuffers runtime
  EnTT::EnTT
)

# lpcli (Phase 1b ships the `run` subcommand; compile lands in Phase 2).
add_subdirectory(apps/lpcli)

if(LOGICPILOT_BUILD_TESTS)
  add_executable(logicpilot_phase1b_tests
    tests/test_agent_runtime.cpp
    tests/test_state_machine.cpp
    tests/test_devs.cpp
    tests/test_ir_loader.cpp
    tests/test_mm1_acceptance.cpp
    tests/test_mm1_failure.cpp
    tests/test_determinism.cpp
    tests/test_perf_baseline.cpp
  )
  target_link_libraries(logicpilot_phase1b_tests PRIVATE
    logicpilot_phase1b
    Catch2::Catch2WithMain
  )
  target_compile_definitions(logicpilot_phase1b_tests PRIVATE
    LOGICPILOT_EXAMPLES_DIR="${CMAKE_SOURCE_DIR}/examples"
  )
  catch_discover_tests(logicpilot_phase1b_tests)
endif()

if(LOGICPILOT_BUILD_TESTS AND LOGICPILOT_BUILD_DSL)
  # IR atomic execution tests compile examples/pulse_chain.lp in-process, so
  # they need the DSL compiler (mirrors logicpilot_server_tests).
  target_sources(logicpilot_phase1b_tests PRIVATE
    tests/test_ir_atomic.cpp
    tests/test_ir_agent.cpp
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
  Boost::headers
  fmt::fmt
)
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
endif()

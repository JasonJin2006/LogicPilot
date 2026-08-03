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
#   add_subdirectory(apps/lp-server)

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

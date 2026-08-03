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

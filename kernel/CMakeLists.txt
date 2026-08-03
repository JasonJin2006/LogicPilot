# LogicPilot kernel build.
#
# Phase 0 ships a minimal translation unit (hello_kernel) so the toolchain can
# be validated end-to-end. Real kernel libraries (core/scheduler, agent,
# statemachine, devs) will be layered on top in later phases.

add_library(logicpilot_kernel INTERFACE)
target_include_directories(logicpilot_kernel INTERFACE
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

# Minimal smoke-test binary: proves the C++20 toolchain + vcpkg wiring works.
add_executable(hello_kernel src/hello_kernel.cpp)
target_link_libraries(hello_kernel PRIVATE logicpilot_kernel)

# Reserved targets (implemented in later phases):
#   add_subdirectory(apps/lpcli)
#   add_subdirectory(apps/lp-server)

if(LOGICPILOT_BUILD_TESTS)
  enable_testing()
  # Catch2 based unit tests land with the scheduler (Phase 1).
  # add_subdirectory(tests)
endif()

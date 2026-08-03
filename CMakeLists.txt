cmake_minimum_required(VERSION 3.25)

project(LogicPilot
  VERSION 0.0.1
  DESCRIPTION "LogicPilot - discrete-event simulation kernel & toolchain"
  LANGUAGES CXX
)

# ---------------------------------------------------------------------------
# Global standards
# ---------------------------------------------------------------------------
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Make vcpkg-installed packages visible in manifest mode.
if(DEFINED ENV{VCPKG_ROOT})
  set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" CACHE STRING "")
endif()

option(LOGICPILOT_BUILD_TESTS "Build kernel unit tests" ON)
option(LOGICPILOT_BUILD_BENCH "Build benchmarks" OFF)
option(LOGICPILOT_BUILD_DSL "Build DSL components (reserved for Phase 2)" OFF)
option(LOGICPILOT_BUILD_WEB_NATIVE "Build web-facing native artifacts (reserved)" OFF)

# ---------------------------------------------------------------------------
# Compiler hygiene
# ---------------------------------------------------------------------------
if(MSVC)
  add_compile_options(/W4 /permissive- /utf-8)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------
# FlatBuffers codegen pipeline (contract freeze points F1/F2, ADR-0004):
# defines `logicpilot_schemas` (generated C++ headers), `logicpilot_codegen`
# and `logicpilot_codegen_ts` targets. See cmake/codegen.cmake.
include(cmake/codegen.cmake)

add_subdirectory(kernel)

# DSL components are intentionally NOT added yet (Phase 2, ADR-0005).
if(LOGICPILOT_BUILD_DSL AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/dsl/CMakeLists.txt")
  add_subdirectory(dsl)
endif()

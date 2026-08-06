cmake_minimum_required(VERSION 3.25)

project(LogicPilot
  VERSION 0.0.1
  DESCRIPTION "LogicPilot - discrete-event simulation kernel & toolchain"
  LANGUAGES C CXX
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
option(LOGICPILOT_BUILD_DSL "Build DSL components (compiler, Phase 2)" ON)
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
# CTest lives at the top level so kernel/ and dsl/ tests both register into
# the same test suite (ctest at the build root sees everything).
if(LOGICPILOT_BUILD_TESTS)
  enable_testing()
endif()

# FlatBuffers codegen pipeline (contract freeze points F1/F2, ADR-0004):
# defines `logicpilot_schemas` (generated C++ headers), `logicpilot_codegen`
# and `logicpilot_codegen_ts` targets. See cmake/codegen.cmake.
include(cmake/codegen.cmake)

add_subdirectory(kernel)

# Method Runtime Layer: per-method plugin libraries (process today; agent,
# system dynamics, statechart, and third-party methods register through the
# same MethodRegistry). See docs/specs/method-runtime.md.
add_subdirectory(methods)

# DSL compiler + vendored tree-sitter runtime (Phase 2, ADR-0005/0008).
if(LOGICPILOT_BUILD_DSL AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/dsl/CMakeLists.txt")
  add_subdirectory(dsl)
endif()

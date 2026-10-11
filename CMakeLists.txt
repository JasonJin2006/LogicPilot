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
# Per-method plugin toggles (Method Runtime Layer, ADR-0068). Turning a
# method OFF removes its runtime from every driver binary and from the
# aggregate registry; models requesting it then fail at run time with
# KR1004. The kernel-native DEVS builtin stays in core (not gated here).
option(LOGICPILOT_METHOD_AGENT "Include the agent method plugin" ON)
option(LOGICPILOT_METHOD_PROCESS "Include the process (DES flow) method plugin" ON)
option(LOGICPILOT_METHOD_SD "Include the system-dynamics method plugin" ON)
option(LOGICPILOT_METHOD_STATECHART "Include the statechart method plugin" ON)
option(LOGICPILOT_METHOD_DEVS "Include the kernel-native DEVS method plugin" ON)

# ---------------------------------------------------------------------------
# Compiler hygiene
# ---------------------------------------------------------------------------
if(MSVC)
  find_program(LOGICPILOT_NODE_FOR_MSVC node REQUIRED)
  set(CMAKE_CL_SHOWINCLUDES_PREFIX "Note: including file:")
  set(CMAKE_C_COMPILER_LAUNCHER "${LOGICPILOT_NODE_FOR_MSVC};${CMAKE_CURRENT_SOURCE_DIR}/cmake/msvc-output.mjs")
  set(CMAKE_CXX_COMPILER_LAUNCHER "${LOGICPILOT_NODE_FOR_MSVC};${CMAKE_CURRENT_SOURCE_DIR}/cmake/msvc-output.mjs")
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

# Method Runtime Layer: per-method plugin libraries registering through the
# shared MethodRegistry. See docs/specs/method-runtime.md and ADR-0068 for
# the pluggability contract.
if(LOGICPILOT_METHOD_AGENT OR LOGICPILOT_METHOD_PROCESS OR LOGICPILOT_METHOD_SD OR LOGICPILOT_METHOD_STATECHART)
  add_subdirectory(methods)
endif()

# DSL compiler + vendored tree-sitter runtime (Phase 2, ADR-0005/0008).
if(LOGICPILOT_BUILD_DSL AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/dsl/CMakeLists.txt")
  add_subdirectory(dsl)
endif()

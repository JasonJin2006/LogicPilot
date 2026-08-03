# Standalone build for the C++ side of the F1/F2 schema interop test.
#
# Kept separate from the main build so it only pulls the `flatbuffers`
# vcpkg port (see vcpkg.json next to this file) instead of the full kernel
# dependency set. Reuses cmake/codegen.cmake for flatc discovery + codegen.
#
# Configure (PowerShell, MinGW example):
#   $env:VCPKG_ROOT = '<path-to-vcpkg>'
#   cmake -S scripts/interop -B build/interop -G Ninja `
#     -DCMAKE_CXX_COMPILER=C:/msys64/ucrt64/bin/g++.exe `
#     "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
#   cmake --build build/interop
#   ./build/interop/schema_interop_writer <output-dir>

cmake_minimum_required(VERSION 3.25)

project(logicpilot_schema_interop LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Repository root (this file lives in <root>/scripts/interop).
get_filename_component(LOGICPILOT_SOURCE_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)

include("${LOGICPILOT_SOURCE_ROOT}/cmake/codegen.cmake")

add_executable(schema_interop_writer writer.cpp)
target_link_libraries(schema_interop_writer PRIVATE logicpilot_schemas)
if(NOT MSVC)
  target_compile_options(schema_interop_writer PRIVATE -Wall -Wextra)
endif()

# LogicPilot FlatBuffers codegen pipeline (contract freeze points F1/F2).
#
# Responsibilities:
#   * locate a flatc compiler (cache override > vcpkg port tools > prebuilt
#     download in .deps/flatc > PATH),
#   * generate C++ headers for schemas/ir.fbs + schemas/wire.fbs into
#     ${LOGICPILOT_GENERATED_DIR} (default: ${CMAKE_BINARY_DIR}/generated),
#   * expose INTERFACE library `logicpilot_schemas` for kernel/tool targets,
#   * provide the `logicpilot_codegen_ts` target regenerating the TypeScript
#     bindings under web/packages/protocol/src/generated/.
#
# Ways to obtain flatc (in search order, see also scripts/fetch-flatc.ps1):
#   1. -DFLATC_EXECUTABLE=<path>        explicit override.
#   2. vcpkg flatbuffers port           installed tools dir, e.g.
#      $VCPKG_ROOT/installed/<triplet>/tools/flatbuffers/flatc(.exe) or
#      <buildtree>/vcpkg_installed/<triplet>/tools/flatbuffers/flatc(.exe).
#   3. prebuilt download                scripts/fetch-flatc.ps1 places the
#      official GitHub Releases binary into <repo>/.deps/flatc/ (gitignored).
#   4. system PATH                      find_program(flatc).
#
# Set LOGICPILOT_AUTO_FETCH_FLATC=ON to let configure run fetch-flatc.ps1
# automatically when no flatc is found (requires PowerShell + network).

if(DEFINED LOGICPILOT_CODEGEN_INCLUDED)
  return()
endif()
set(LOGICPILOT_CODEGEN_INCLUDED TRUE)

# The repository root. Standalone consumers (scripts/interop) pre-set
# LOGICPILOT_SOURCE_ROOT before including this module.
if(NOT DEFINED LOGICPILOT_SOURCE_ROOT)
  set(LOGICPILOT_SOURCE_ROOT "${CMAKE_SOURCE_DIR}")
endif()
set(LOGICPILOT_SCHEMA_DIR "${LOGICPILOT_SOURCE_ROOT}/schemas")
set(LOGICPILOT_IR_SCHEMA "${LOGICPILOT_SCHEMA_DIR}/ir.fbs")
set(LOGICPILOT_V2_SCHEMA "${LOGICPILOT_SCHEMA_DIR}/ir_v2.fbs")
set(LOGICPILOT_WIRE_SCHEMA "${LOGICPILOT_SCHEMA_DIR}/wire.fbs")

if(NOT DEFINED LOGICPILOT_GENERATED_DIR)
  set(LOGICPILOT_GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")
endif()
if(NOT DEFINED LOGICPILOT_TS_OUTPUT_DIR)
  set(LOGICPILOT_TS_OUTPUT_DIR
      "${LOGICPILOT_SOURCE_ROOT}/web/packages/protocol/src/generated")
endif()

# ---------------------------------------------------------------------------
# Locate flatc
# ---------------------------------------------------------------------------
function(_logicpilot_glob_flatc out_var)
  set(_candidates "")
  foreach(_dir IN LISTS ARGN)
    if(EXISTS "${_dir}")
      file(GLOB _found
        "${_dir}/*/tools/flatbuffers/flatc*"
        "${_dir}/tools/flatbuffers/flatc*"
      )
      foreach(_f IN LISTS _found)
        get_filename_component(_name "${_f}" NAME)
        if(_name MATCHES "^flatc(\\.exe)?$")
          list(APPEND _candidates "${_f}")
        endif()
      endforeach()
    endif()
  endforeach()
  set(${out_var} "${_candidates}" PARENT_SCOPE)
endfunction()

if(NOT FLATC_EXECUTABLE OR NOT EXISTS "${FLATC_EXECUTABLE}")
  unset(FLATC_EXECUTABLE CACHE)

  # vcpkg tools (build tree first, then global VCPKG_ROOT install tree).
  set(_vcpkg_roots "")
  if(EXISTS "${CMAKE_BINARY_DIR}/vcpkg_installed")
    list(APPEND _vcpkg_roots "${CMAKE_BINARY_DIR}/vcpkg_installed")
  endif()
  if(DEFINED ENV{VCPKG_ROOT} AND EXISTS "$ENV{VCPKG_ROOT}/installed")
    list(APPEND _vcpkg_roots "$ENV{VCPKG_ROOT}/installed")
  endif()
  _logicpilot_glob_flatc(_flatc_candidates ${_vcpkg_roots})
  if(_flatc_candidates)
    list(GET _flatc_candidates 0 FLATC_EXECUTABLE)
  endif()

  # Prebuilt download into .deps/flatc (scripts/fetch-flatc.ps1).
  if(NOT FLATC_EXECUTABLE)
    if(WIN32)
      set(_deps_flatc "${LOGICPILOT_SOURCE_ROOT}/.deps/flatc/flatc.exe")
    else()
      set(_deps_flatc "${LOGICPILOT_SOURCE_ROOT}/.deps/flatc/flatc")
    endif()
    if(EXISTS "${_deps_flatc}")
      set(FLATC_EXECUTABLE "${_deps_flatc}")
    elseif(LOGICPILOT_AUTO_FETCH_FLATC)
      find_program(_pwsh NAMES pwsh powershell)
      if(_pwsh)
        message(STATUS "flatc not found - running scripts/fetch-flatc.ps1")
        execute_process(
          COMMAND "${_pwsh}" -NoProfile -ExecutionPolicy Bypass -File
                  "${LOGICPILOT_SOURCE_ROOT}/scripts/fetch-flatc.ps1"
          RESULT_VARIABLE _fetch_rc
        )
        if(_fetch_rc EQUAL 0 AND EXISTS "${_deps_flatc}")
          set(FLATC_EXECUTABLE "${_deps_flatc}")
        endif()
      endif()
    endif()
  endif()

  # System PATH as last resort.
  if(NOT FLATC_EXECUTABLE)
    find_program(FLATC_EXECUTABLE NAMES flatc)
  endif()
endif()

set(FLATC_EXECUTABLE "${FLATC_EXECUTABLE}" CACHE FILEPATH
    "FlatBuffers compiler used by the codegen pipeline")

if(NOT FLATC_EXECUTABLE OR NOT EXISTS "${FLATC_EXECUTABLE}")
  message(FATAL_ERROR
    "flatc not found. Either install the flatbuffers vcpkg port, run "
    "'pwsh scripts/fetch-flatc.ps1' (downloads a prebuilt binary into "
    ".deps/flatc), or pass -DFLATC_EXECUTABLE=<path>.")
endif()
message(STATUS "flatc: ${FLATC_EXECUTABLE}")

execute_process(COMMAND "${FLATC_EXECUTABLE}" --version
                OUTPUT_VARIABLE _flatc_version
                OUTPUT_STRIP_TRAILING_WHITESPACE)
message(STATUS "flatc version: ${_flatc_version}")

# ---------------------------------------------------------------------------
# C++ codegen -> ${LOGICPILOT_GENERATED_DIR}
# ---------------------------------------------------------------------------
set(LOGICPILOT_IR_GENERATED "${LOGICPILOT_GENERATED_DIR}/ir_generated.h")
set(LOGICPILOT_V2_GENERATED "${LOGICPILOT_GENERATED_DIR}/ir_v2_generated.h")
set(LOGICPILOT_WIRE_GENERATED "${LOGICPILOT_GENERATED_DIR}/wire_generated.h")

file(MAKE_DIRECTORY "${LOGICPILOT_GENERATED_DIR}")

add_custom_command(
  OUTPUT "${LOGICPILOT_IR_GENERATED}" "${LOGICPILOT_V2_GENERATED}"
         "${LOGICPILOT_WIRE_GENERATED}"
  COMMAND "${FLATC_EXECUTABLE}" --cpp
          -o "${LOGICPILOT_GENERATED_DIR}"
          "${LOGICPILOT_IR_SCHEMA}" "${LOGICPILOT_V2_SCHEMA}"
          "${LOGICPILOT_WIRE_SCHEMA}"
  DEPENDS "${LOGICPILOT_IR_SCHEMA}" "${LOGICPILOT_V2_SCHEMA}"
          "${LOGICPILOT_WIRE_SCHEMA}"
  COMMENT "flatc: generating C++ headers for ir.fbs (F1) + ir_v2.fbs (F3) + wire.fbs (F2)"
  VERBATIM
)

add_custom_target(logicpilot_codegen DEPENDS
  "${LOGICPILOT_IR_GENERATED}" "${LOGICPILOT_V2_GENERATED}"
  "${LOGICPILOT_WIRE_GENERATED}")

# INTERFACE library consumed by kernel/tool targets:
#   target_link_libraries(<tgt> PRIVATE logicpilot_schemas)
add_library(logicpilot_schemas INTERFACE)
add_dependencies(logicpilot_schemas logicpilot_codegen)
target_include_directories(logicpilot_schemas INTERFACE
  "${LOGICPILOT_GENERATED_DIR}")

# The generated headers need the FlatBuffers runtime headers. Prefer the
# vcpkg-provided package; degrade gracefully when it is not configured yet.
find_package(Flatbuffers CONFIG QUIET)
if(TARGET flatbuffers::flatbuffers)
  target_link_libraries(logicpilot_schemas INTERFACE flatbuffers::flatbuffers)
elseif(DEFINED Flatbuffers_INCLUDE_DIR)
  target_include_directories(logicpilot_schemas INTERFACE
    "${Flatbuffers_INCLUDE_DIR}")
else()
  message(WARNING
    "FlatBuffers package not found; logicpilot_schemas exposes only the "
    "generated headers. Linking consumers may need flatbuffers includes.")
endif()

# ---------------------------------------------------------------------------
# TypeScript codegen -> web/packages/protocol/src/generated
# ---------------------------------------------------------------------------
add_custom_target(logicpilot_codegen_ts
  COMMAND "${CMAKE_COMMAND}" -E remove_directory "${LOGICPILOT_TS_OUTPUT_DIR}"
  COMMAND "${FLATC_EXECUTABLE}" --ts
          -o "${LOGICPILOT_TS_OUTPUT_DIR}"
          "${LOGICPILOT_IR_SCHEMA}" "${LOGICPILOT_V2_SCHEMA}"
          "${LOGICPILOT_WIRE_SCHEMA}"
  DEPENDS "${LOGICPILOT_IR_SCHEMA}" "${LOGICPILOT_V2_SCHEMA}"
          "${LOGICPILOT_WIRE_SCHEMA}"
  COMMENT "flatc: generating TypeScript bindings for ir.fbs + ir_v2.fbs + wire.fbs (F1/F3/F2)"
  VERBATIM
)

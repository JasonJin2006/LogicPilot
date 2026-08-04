# LogicPilot DSL compiler (Phase 2b, task #6).
#
# Targets:
#   tree_sitter_runtime - vendored tree-sitter C runtime v0.26.11
#                         (third_party/tree-sitter, ADR-0008)
#   logicpilot_dsl      - checked-in grammar parser.c (ADR-0005) + parser
#                         wrapper, semantic analysis and FlatBuffers IR
#                         lowering (namespace logicpilot::dsl)
#
# No tree-sitter CLI invocation happens at build time.

set(LOGICPILOT_TS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/tree-sitter")
set(LOGICPILOT_GRAMMAR_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../tree-sitter-logicpilot")

# ---------------------------------------------------------------------------
# Vendored tree-sitter C runtime (ADR-0008): upstream amalgamation unit.
# ---------------------------------------------------------------------------
add_library(tree_sitter_runtime STATIC "${LOGICPILOT_TS_DIR}/src/lib.c")
set_target_properties(tree_sitter_runtime PROPERTIES
  C_STANDARD 11
  C_STANDARD_REQUIRED ON
)
target_include_directories(tree_sitter_runtime PUBLIC
  "${LOGICPILOT_TS_DIR}/include"
)
target_include_directories(tree_sitter_runtime PRIVATE
  "${LOGICPILOT_TS_DIR}/src"
)
# Upstream vendored code: build warning-suppressed; never patched locally.
if(MSVC)
  target_compile_options(tree_sitter_runtime PRIVATE /W0)
else()
  target_compile_options(tree_sitter_runtime PRIVATE -w)
endif()

# ---------------------------------------------------------------------------
# The compiler library.
# ---------------------------------------------------------------------------
add_library(logicpilot_dsl STATIC
  "${LOGICPILOT_GRAMMAR_DIR}/src/parser.c"
  src/diagnostics.cpp
  src/experiments_json.cpp
  src/json_diagnostics.cpp
  src/parser.cpp
  src/registry.cpp
  src/semantic.cpp
  src/lowering.cpp
  src/compile.cpp
  src/ir_dump.cpp
)
target_include_directories(logicpilot_dsl PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_link_libraries(logicpilot_dsl PUBLIC
  tree_sitter_runtime
  logicpilot_schemas      # ir_v2_generated.h + FlatBuffers runtime (F1)
  logicpilot_phase1b      # IrModelFile view used by ir_dump / e2e tests
)
# The grammar artifact is generated code: silence its warnings.
set_source_files_properties("${LOGICPILOT_GRAMMAR_DIR}/src/parser.c"
  PROPERTIES COMPILE_OPTIONS
  "$<$<COMPILE_LANG_AND_ID:C,GNU,Clang>:-w>;$<$<COMPILE_LANG_AND_ID:C,MSVC>:/W0>"
)

if(LOGICPILOT_BUILD_TESTS)
  add_subdirectory(tests)
endif()

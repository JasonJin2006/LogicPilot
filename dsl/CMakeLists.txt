# DSL toolchain aggregate (Phase 2, ADR-0005 / ADR-0008).
#
# Components:
#   dsl/tree-sitter-logicpilot  grammar + checked-in parser.c (not built
#                               here; consumed by dsl/compiler)
#   dsl/compiler                C++ compiler: parser wrapper, semantic
#                               analysis, IR lowering (logicpilot_dsl)
#
# The tree-sitter CLI is NEVER invoked during builds (ADR-0005/0008); the
# runtime only needs a C compiler, enabled here.

if(NOT CMAKE_C_COMPILER_LOADED)
  enable_language(C)
endif()

add_subdirectory(compiler)

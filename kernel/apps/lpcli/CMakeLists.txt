# lpcli - LogicPilot command line tool.
#
# Phase 1b shipped the `run` subcommand + built-in model registry (task #4);
# Phase 2b (task #6) adds the `compile` subcommand (DSL -> IR) when the DSL
# compiler (logicpilot_dsl) is built.

add_executable(lpcli
  main.cpp
  run_command.cpp
  builtin_registry.cpp
)
target_link_libraries(lpcli PRIVATE
  logicpilot_phase1b
  fmt::fmt
)

if(LOGICPILOT_BUILD_DSL)
  target_sources(lpcli PRIVATE compile_command.cpp serve_command.cpp)
  target_link_libraries(lpcli PRIVATE logicpilot_dsl lp_server_core)
  target_compile_definitions(lpcli PRIVATE LOGICPILOT_HAS_DSL=1)
endif()

# lpcli - LogicPilot command line tool.
#
# Phase 1b shipped the `run` subcommand + built-in model registry (task #4);
# Phase 2b (task #6) adds the `compile` subcommand (DSL -> IR) when the DSL
# compiler (logicpilot_dsl) is built.

add_executable(lpcli
  main.cpp
  run_command.cpp
  trace_compare_command.cpp
)
target_link_libraries(lpcli PRIVATE
  logicpilot_kernel
  logicpilot_methods
  fmt::fmt
)

if(LOGICPILOT_BUILD_DSL)
  target_sources(lpcli PRIVATE compile_command.cpp)
  target_link_libraries(lpcli PRIVATE logicpilot_dsl)
  target_compile_definitions(lpcli PRIVATE LOGICPILOT_HAS_DSL=1)
  if(LOGICPILOT_METHOD_DEVS)
    # `serve` embeds the WebSocket gateway, which requires the DEVS plugin.
    target_sources(lpcli PRIVATE serve_command.cpp)
    target_link_libraries(lpcli PRIVATE lp_server_core)
    target_compile_definitions(lpcli PRIVATE LOGICPILOT_HAS_SERVE=1)
  endif()
endif()

# lpcli - LogicPilot command line tool.
#
# Phase 1b ships the `run` subcommand + built-in model registry (task #4).
# The `compile` subcommand (DSL -> IR) is added by Phase 2 (task #6) in
# separate source files.

add_executable(lpcli
  main.cpp
  run_command.cpp
  builtin_registry.cpp
)
target_link_libraries(lpcli PRIVATE
  logicpilot_phase1b
  fmt::fmt
)

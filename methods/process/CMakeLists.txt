# Process method runtime - wraps the legacy flow engines behind
# SimulationMethod (Phase 1 of the Method Runtime Layer).
add_library(logicpilot_method_process STATIC
  process_flow.cpp
  process_runtime.cpp
)
target_include_directories(logicpilot_method_process PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_method_process PUBLIC
  logicpilot_phase1b
)

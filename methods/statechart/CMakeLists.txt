# Statechart method runtime - second method plugin (Phase 4): verifies the
# Method Runtime Layer architecture with zero kernel changes.
add_library(logicpilot_method_statechart STATIC
  statechart_replication.cpp
  statechart_runtime.cpp
)
target_include_directories(logicpilot_method_statechart PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_method_statechart PUBLIC
  logicpilot_phase1b
)

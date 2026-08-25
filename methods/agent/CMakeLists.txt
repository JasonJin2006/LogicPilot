# Agent method runtime plugin. The implementation wraps the existing
# AgentReplicationModel behind the shared SimulationMethod lifecycle.
add_library(logicpilot_method_agent STATIC
  agent_runtime.cpp
  ir_agent.cpp
)
target_include_directories(logicpilot_method_agent PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_method_agent PUBLIC
  logicpilot_kernel
)

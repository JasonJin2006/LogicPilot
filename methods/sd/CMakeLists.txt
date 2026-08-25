# System-dynamics method runtime plugin. The implementation wraps the fixed
# RK4 ContinuousReplicationModel behind the shared SimulationMethod lifecycle.
add_library(logicpilot_method_sd STATIC
  sd_runtime.cpp
)
target_include_directories(logicpilot_method_sd PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_method_sd PUBLIC
  logicpilot_kernel
)

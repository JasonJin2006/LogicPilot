# Method Runtime Layer (docs/specs/method-runtime.md).
#
# Each modeling method ships as a static library that links the kernel and
# registers itself into logicpilot::MethodRegistry. The kernel never depends
# on a specific method; drivers link the method libraries they want to
# support and call register_all_methods() (or the per-method register
# function) at startup.

add_subdirectory(process)
add_subdirectory(statechart)

# Aggregate method library: links every built-in method plugin and provides
# the single register_all_methods() entry point used by drivers/tests.
add_library(logicpilot_methods STATIC
  register.cpp
)
target_include_directories(logicpilot_methods PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_methods PUBLIC
  logicpilot_method_process
  logicpilot_method_statechart
)

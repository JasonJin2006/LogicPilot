# Method Runtime Layer (docs/specs/method-runtime.md).
#
# Each modeling method ships as a static library that links the kernel and
# registers itself into logicpilot::MethodRegistry. The kernel never depends
# on a specific method; drivers link the method libraries they want to
# support and call register_all_methods() (or the per-method register
# function) at startup.

if(LOGICPILOT_METHOD_AGENT)
  add_subdirectory(agent)
endif()
if(LOGICPILOT_METHOD_PROCESS)
  add_subdirectory(process)
endif()
if(LOGICPILOT_METHOD_SD)
  add_subdirectory(sd)
endif()
if(LOGICPILOT_METHOD_STATECHART)
  add_subdirectory(statechart)
endif()
# The kernel-native DEVS method is an ordinary plugin target now (ADR-0068
# Phase B); it gains a LOGICPILOT_METHOD_DEVS toggle together with the
# minimal-kernel CI tree in Phase C.

# Aggregate method library: links every built-in method plugin and provides
# the single register_all_methods() entry point used by drivers/tests.
add_library(logicpilot_methods STATIC
  register.cpp
)
target_include_directories(logicpilot_methods PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
)
target_link_libraries(logicpilot_methods PUBLIC
)
if(LOGICPILOT_METHOD_DEVS)
  target_link_libraries(logicpilot_methods PUBLIC logicpilot_method_devs)
  target_compile_definitions(logicpilot_methods PRIVATE LP_WITH_METHOD_DEVS=1)
endif()
if(LOGICPILOT_METHOD_AGENT)
  target_link_libraries(logicpilot_methods PUBLIC logicpilot_method_agent)
  target_compile_definitions(logicpilot_methods PRIVATE LP_WITH_METHOD_AGENT=1)
endif()
if(LOGICPILOT_METHOD_PROCESS)
  target_link_libraries(logicpilot_methods PUBLIC logicpilot_method_process)
  target_compile_definitions(logicpilot_methods PRIVATE LP_WITH_METHOD_PROCESS=1)
endif()
if(LOGICPILOT_METHOD_SD)
  target_link_libraries(logicpilot_methods PUBLIC logicpilot_method_sd)
  target_compile_definitions(logicpilot_methods PRIVATE LP_WITH_METHOD_SD=1)
endif()
if(LOGICPILOT_METHOD_STATECHART)
  target_link_libraries(logicpilot_methods PUBLIC logicpilot_method_statechart)
  target_compile_definitions(logicpilot_methods PRIVATE LP_WITH_METHOD_STATECHART=1)
endif()

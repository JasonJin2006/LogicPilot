# Catch2 unit tests for the kernel (CTest-registered via catch_discover_tests).

add_executable(logicpilot_kernel_tests
  test_time.cpp
  test_scheduler.cpp
  test_random.cpp
  test_memory.cpp
)
target_link_libraries(logicpilot_kernel_tests PRIVATE
  logicpilot_kernel
  Catch2::Catch2WithMain
)

catch_discover_tests(logicpilot_kernel_tests)

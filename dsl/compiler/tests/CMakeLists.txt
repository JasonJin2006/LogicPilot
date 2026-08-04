# DSL compiler tests (Catch2) + lpcli CLI-level integration (CTest).

find_package(Catch2 3 REQUIRED)
include(Catch)

add_executable(logicpilot_dsl_tests
  test_dsl_parser.cpp
  test_dsl_semantic.cpp
  test_dsl_lowering.cpp
  test_dsl_e2e.cpp
  test_diagnostics_json.cpp
)
target_link_libraries(logicpilot_dsl_tests PRIVATE
  logicpilot_dsl
  Catch2::Catch2WithMain
)
target_include_directories(logicpilot_dsl_tests PRIVATE
  "${CMAKE_SOURCE_DIR}/kernel/tests"  # expect_json.h shared test utility
)
target_compile_definitions(logicpilot_dsl_tests PRIVATE
  LOGICPILOT_EXAMPLES_DIR="${CMAKE_SOURCE_DIR}/examples"
  LOGICPILOT_DSL_GOLDEN_DIR="${CMAKE_CURRENT_SOURCE_DIR}/golden"
)
catch_discover_tests(logicpilot_dsl_tests)

# ---------------------------------------------------------------------------
# CLI-level integration: lpcli compile -> lpcli run on the produced IR.
# ---------------------------------------------------------------------------
add_test(NAME lpcli_compile_mm1
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/mm1.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/mm1.ir.bin")
set_tests_properties(lpcli_compile_mm1 PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_compiled_mm1
  COMMAND lpcli run --model-file "${CMAKE_CURRENT_BINARY_DIR}/mm1.ir.bin"
          --seed=42 --reps=2 --arrivals=1000 --warmup=100)
set_tests_properties(lpcli_run_compiled_mm1 PROPERTIES
  DEPENDS lpcli_compile_mm1
  PASS_REGULAR_EXPRESSION "summary: 2 replications")

# Milestone 1: the failure model must survive the full DSL -> IR -> runtime
# chain (multi-server + breakdown wiring in build_replication_model).
add_test(NAME lpcli_compile_mm1_failure
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/mm1_failure.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/mm1_failure.ir.bin")
set_tests_properties(lpcli_compile_mm1_failure PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_mm1_failure
  COMMAND lpcli run --model-file
          "${CMAKE_CURRENT_BINARY_DIR}/mm1_failure.ir.bin"
          --seed=42 --reps=3 --arrivals=4000 --warmup=400)
set_tests_properties(lpcli_run_mm1_failure PROPERTIES
  DEPENDS lpcli_compile_mm1_failure
  PASS_REGULAR_EXPRESSION "summary: 3 replications")

# Milestone 1b: DEVS atomic blocks survive the DSL -> IR -> executor chain.
add_test(NAME lpcli_compile_atomic
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/pulse_chain.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/pulse_chain.ir.bin")
set_tests_properties(lpcli_compile_atomic PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_atomic
  COMMAND lpcli run --model-file
          "${CMAKE_CURRENT_BINARY_DIR}/pulse_chain.ir.bin"
          --seed=42 --reps=1 --arrivals=5 --warmup=0)
set_tests_properties(lpcli_run_atomic PROPERTIES
  DEPENDS lpcli_compile_atomic
  PASS_REGULAR_EXPRESSION "summary: 1 replications")

# Milestone 1c: ABM agent blocks survive the DSL -> IR -> runtime chain.
add_test(NAME lpcli_compile_agents
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/agents.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/agents.ir.bin")
set_tests_properties(lpcli_compile_agents PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_agents
  COMMAND lpcli run --model-file
          "${CMAKE_CURRENT_BINARY_DIR}/agents.ir.bin"
          --seed=42 --reps=1 --arrivals=5 --warmup=0)
set_tests_properties(lpcli_run_agents PROPERTIES
  DEPENDS lpcli_compile_agents
  PASS_REGULAR_EXPRESSION "summary: 1 replications")

# Multi-server example (M/M/2) must survive the DSL -> IR -> runtime chain.
add_test(NAME lpcli_compile_two_servers
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/two_servers.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/two_servers.ir.bin")
set_tests_properties(lpcli_compile_two_servers PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

# IR v2 migration: emit the v2 contract and run it through the auto-converter.
add_test(NAME lpcli_compile_ir_v2
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/mm1.lp"
          --ir-version 2 -o "${CMAKE_CURRENT_BINARY_DIR}/mm1.v2.lpir")
set_tests_properties(lpcli_compile_ir_v2 PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_ir_v2
  COMMAND lpcli run --model-file "${CMAKE_CURRENT_BINARY_DIR}/mm1.v2.lpir"
          --seed=42 --reps=2 --arrivals=1000 --warmup=100)
set_tests_properties(lpcli_run_ir_v2 PROPERTIES
  DEPENDS lpcli_compile_ir_v2
  PASS_REGULAR_EXPRESSION "summary: 2 replications")

# IR v2 for the DEVS atomic contract: emit v2 and run through the converter.
add_test(NAME lpcli_compile_ir_v2_atomic
  COMMAND lpcli compile "${CMAKE_SOURCE_DIR}/examples/pulse_chain.lp"
          --ir-version 2 -o "${CMAKE_CURRENT_BINARY_DIR}/pulse_chain.v2.lpir")
set_tests_properties(lpcli_compile_ir_v2_atomic PROPERTIES
  PASS_REGULAR_EXPRESSION "compiled")

add_test(NAME lpcli_run_ir_v2_atomic
  COMMAND lpcli run --model-file
          "${CMAKE_CURRENT_BINARY_DIR}/pulse_chain.v2.lpir"
          --seed=42 --reps=1 --arrivals=5 --warmup=0)
set_tests_properties(lpcli_run_ir_v2_atomic PROPERTIES
  DEPENDS lpcli_compile_ir_v2_atomic
  PASS_REGULAR_EXPRESSION "summary: 1 replications")

# AI model build loop (rule-based provider, offline): NL -> DSL -> compile ->
# diagnostics repair -> run. Requires node (available in the kernel CI job).
add_test(NAME ai_build_smoke
  COMMAND node ${CMAKE_SOURCE_DIR}/scripts/test-ai-build.mjs
          --lpcli $<TARGET_FILE:lpcli>)
set_tests_properties(ai_build_smoke PROPERTIES
  PASS_REGULAR_EXPRESSION "AI-BUILD TEST: PASS")

# AI build endpoint (IDE dev server middleware): POST /api/ai-build.
add_test(NAME ai_endpoint_smoke
  COMMAND node
          ${CMAKE_SOURCE_DIR}/web/apps/ide/scripts/test-ai-endpoint.mjs
          --lpcli $<TARGET_FILE:lpcli>)
set_tests_properties(ai_endpoint_smoke PROPERTIES
  PASS_REGULAR_EXPRESSION "AI-ENDPOINT TEST: PASS")

# Parameter optimization (grid via lpcli + deterministic GA) and the NL
# optimization path.
add_test(NAME ai_optimize_smoke
  COMMAND node ${CMAKE_SOURCE_DIR}/scripts/test-optimize.mjs
          --lpcli $<TARGET_FILE:lpcli>)
set_tests_properties(ai_optimize_smoke PROPERTIES
  PASS_REGULAR_EXPRESSION "OPTIMIZE TEST: PASS")

# Bottleneck attribution (run + rule-based explanation).
add_test(NAME ai_explain_smoke
  COMMAND node ${CMAKE_SOURCE_DIR}/scripts/test-explain.mjs
          --lpcli $<TARGET_FILE:lpcli>)
set_tests_properties(ai_explain_smoke PROPERTIES
  PASS_REGULAR_EXPRESSION "EXPLAIN TEST: PASS")

add_test(NAME lpcli_compile_rejects_missing_capacity
  COMMAND lpcli compile
          "${CMAKE_CURRENT_SOURCE_DIR}/bad_sources/missing_capacity.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/bad.ir.bin")
set_tests_properties(lpcli_compile_rejects_missing_capacity PROPERTIES
  PASS_REGULAR_EXPRESSION "error\\[LP2001\\]")

add_test(NAME lpcli_compile_rejects_unresolved_resource
  COMMAND lpcli compile
          "${CMAKE_CURRENT_SOURCE_DIR}/bad_sources/unresolved_resource.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/bad2.ir.bin")
set_tests_properties(lpcli_compile_rejects_unresolved_resource PROPERTIES
  PASS_REGULAR_EXPRESSION "error\\[LP4001\\]")

add_test(NAME lpcli_compile_rejects_bad_experiment
  COMMAND lpcli compile
          "${CMAKE_CURRENT_SOURCE_DIR}/bad_sources/bad_experiment.lp"
          -o "${CMAKE_CURRENT_BINARY_DIR}/bad3.ir.bin")
set_tests_properties(lpcli_compile_rejects_bad_experiment PROPERTIES
  PASS_REGULAR_EXPRESSION "error\\[LP7001\\]")

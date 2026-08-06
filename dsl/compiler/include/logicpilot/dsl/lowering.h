// IR lowering: well-formed DSL AST -> FlatBuffers ModelFile
// (schemas/ir_v2.fbs, file_identifier "LP2R", schema_version 2).
//
// Mapping (dsl-spec.md section 4, made concrete):
//   * model     -> ModelFile.root = core/model Node whose children carry
//                   their method semantics (resource/process/devs/agent/sd);
//   * resource  -> {process, resource} Node with typed params capacity /
//                   failure_rate;
//   * process   -> {process, flow} Node; stages become source/queue/service
//                   child Nodes in declaration order, chained by Couplings;
//   * atomic    -> {devs, atomic} Node with a Statechart behavior;
//   * agent     -> {agent, agent} Node with behavior bindings;
//   * continuous-> {sd, equation} Node with structured equations;
//   * experiment-> ModelFile.experiments entries.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/dsl/ast.h"
#include "logicpilot/dsl/registry.h"

namespace logicpilot::dsl {

struct LoweredIr {
  std::vector<std::uint8_t> bytes;  // FlatBuffers ModelFile ("LP2R")
};

// Precondition: analyze_model() returned no diagnostics for `model`.
[[nodiscard]] LoweredIr lower_to_ir_v2(const ModelAst& model,
                                       const std::string& source_file,
                                       const LibraryRegistry* registry = nullptr,
                                       const std::string* source_text = nullptr);

}  // namespace logicpilot::dsl

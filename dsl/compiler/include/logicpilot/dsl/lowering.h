// IR lowering: well-formed DSL AST -> FlatBuffers ModelFile (ir.fbs, F1).
//
// Mapping (dsl-spec.md section 4, made concrete):
//   * model      -> ModelFile.root = CoupledModel (metadata carries the
//                   model name + source span);
//   * resource   -> AtomicModel child (passive, ta = Infinite) whose params
//                   hold capacity (IntValue) and failure_rate (FloatValue);
//   * process    -> ProcessModel child; stages become ProcessNodes in
//                   declaration order, chained by Couplings
//                   (node_i.out -> node_{i+1}.in);
//   * source     -> SourceNode with a Poisson arrival Distribution;
//   * queue      -> QueueNode (Fifo) with the declared capacity;
//   * service    -> ServiceNode whose service_time is the lowered
//                   distribution, resource = the resolved resource name,
//                   servers = that resource's capacity.
// Distributions: poisson(r)->Poisson[r], exponential(r)->Exponential[r],
// normal(m,s)->Normal[m,s], constant(v)->Constant[v].
// The buffer is finished with file_identifier "LPIR" and schema_version 1.
// The v2 lowering (lower_to_ir_v2) emits the thin Node/SemanticsRef contract
// ("LP2R", schema_version 2) directly, so the compile path no longer needs
// the v1->v2 converter (which remains a compatibility/migration tool).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/dsl/ast.h"

namespace logicpilot::dsl {

struct LoweredIr {
  std::vector<std::uint8_t> bytes;  // FlatBuffers ModelFile ("LPIR")
};

// Precondition: analyze_model() returned no diagnostics for `model`.
[[nodiscard]] LoweredIr lower_to_ir(const ModelAst& model,
                                    const std::string& source_file);

// v2 contract ("LP2R", schema_version 2): model -> core/model Node whose
// children carry their method semantics (process/devs/agent); experiment
// blocks lower into ModelFile.experiments. Same precondition as lower_to_ir.
[[nodiscard]] LoweredIr lower_to_ir_v2(const ModelAst& model,
                                       const std::string& source_file);

}  // namespace logicpilot::dsl

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

}  // namespace logicpilot::dsl

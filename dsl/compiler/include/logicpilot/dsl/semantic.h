// Semantic analysis (v0 minimal, dsl-spec.md section 2).
//
// Checks performed on the typed AST:
//   * scope resolution & redeclaration: model member names and per-process
//     stage names must be unique (LP1001); fields must not repeat (LP1002);
//   * required fields: resource.capacity, queue.capacity, source.arrival,
//     service.time (LP2001); a process needs a source and a service (LP2002)
//     and at most one source/queue/service each in v0 (LP2003);
//   * numeric validity: resource capacity >= 1, queue capacity >= 0,
//     failure_rate in [0, 1], all distribution parameters > 0 (LP3001);
//   * reference resolution: a service's identifier must name a declared
//     resource (LP4001).
#pragma once

#include <vector>

#include "logicpilot/dsl/ast.h"
#include "logicpilot/dsl/diagnostics.h"
#include "logicpilot/dsl/registry.h"

namespace logicpilot::dsl {

// Returns all semantic diagnostics (empty => the model is well-formed).
// `registry` overrides the built-in process registry (a merged registry that
// layers custom `use`d libraries); `libraries` lists the loaded library
// names so `use <name>` resolves.
[[nodiscard]] std::vector<Diagnostic> analyze_model(
    const ModelAst& model, const LibraryRegistry* registry = nullptr,
    const std::vector<std::string>* libraries = nullptr);

}  // namespace logicpilot::dsl

// End-to-end compile pipeline: source text -> diagnostics + IR bytes.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/dsl/ast.h"
#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

struct CompileResult {
  bool ok{false};
  std::vector<Diagnostic> diagnostics;
  std::vector<std::uint8_t> ir_bytes;  // empty unless ok()
  std::string model_name;              // lowered model identifier
  // Declared experiment blocks (sidecar for the AI optimizer; not in F1).
  std::vector<ExperimentDecl> experiments;
};

// Compile one .lp buffer. `path` is used for diagnostics and IR provenance.
[[nodiscard]] CompileResult compile_source(const std::string& source,
                                           const std::string& path);

// Read `path` and compile it. IO failures yield a single LP0002 diagnostic.
[[nodiscard]] CompileResult compile_file(const std::string& path);

}  // namespace logicpilot::dsl

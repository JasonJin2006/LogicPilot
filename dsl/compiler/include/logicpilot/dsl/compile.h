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
  std::vector<std::uint8_t> v2_bytes;  // v2 contract ("LP2R"), empty unless ok
  std::string model_name;              // lowered model identifier
  // Declared experiment blocks (carried in ModelFile.experiments).
  std::vector<ExperimentDecl> experiments;
};

// Compile one .lp buffer. `path` is used for diagnostics and IR provenance.
[[nodiscard]] CompileResult compile_source(const std::string& source,
                                           const std::string& path);

// Compile with `use`d library search directories (each dir is searched for
// `<library>.lplib`; the model's own directory and `libraries/` under the
// working directory are searched as well).
[[nodiscard]] CompileResult compile_source(
    const std::string& source, const std::string& path,
    const std::vector<std::string>& library_dirs);

// Read `path` and compile it. IO failures yield a single LP0002 diagnostic.
[[nodiscard]] CompileResult compile_file(const std::string& path);
[[nodiscard]] CompileResult compile_file(
    const std::string& path,
    const std::vector<std::string>& library_dirs);

}  // namespace logicpilot::dsl

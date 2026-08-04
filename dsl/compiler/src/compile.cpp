// End-to-end compile pipeline implementation.
#include "logicpilot/dsl/compile.h"

#include <fstream>
#include <sstream>
#include <utility>

#include "logicpilot/dsl/lowering.h"
#include "logicpilot/dsl/parser.h"
#include "logicpilot/dsl/semantic.h"

namespace logicpilot::dsl {

CompileResult compile_source(const std::string& source,
                             const std::string& path) {
  CompileResult result;

  ParseOutput parsed = parse_source(source, path);
  if (!parsed.ok()) {
    result.diagnostics = std::move(parsed.diagnostics);
    return result;
  }

  std::vector<Diagnostic> semantic = analyze_model(*parsed.model);
  if (!semantic.empty()) {
    result.diagnostics = std::move(semantic);
    return result;
  }

  LoweredIr lowered = lower_to_ir_v2(*parsed.model, path);
  result.ok = true;
  result.v2_bytes = std::move(lowered.bytes);
  result.model_name = parsed.model->name;
  result.experiments = std::move(parsed.model->experiments);
  return result;
}

CompileResult compile_file(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    CompileResult result;
    Diagnostic diagnostic;
    diagnostic.severity = Severity::kError;
    diagnostic.code = "LP0002";
    diagnostic.message = "cannot read file '" + path + "'";
    result.diagnostics.push_back(std::move(diagnostic));
    return result;
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return compile_source(buffer.str(), path);
}

}  // namespace logicpilot::dsl

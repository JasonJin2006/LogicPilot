// Parser front end: tree-sitter parse -> typed AST (cursor-based queries).
//
// Wraps the vendored tree-sitter C runtime (ADR-0008) and the checked-in
// grammar (dsl/tree-sitter-logicpilot/src/parser.c, ADR-0005). Syntax
// problems are reported as LP0001 diagnostics; when the tree is clean the
// typed AST is extracted for semantic analysis.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include "logicpilot/dsl/ast.h"
#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

struct ParseOutput {
  std::vector<Diagnostic> diagnostics;
  // Present only when the parse tree is error-free.
  std::optional<ModelAst> model;

  [[nodiscard]] bool ok() const {
    return diagnostics.empty() && model.has_value();
  }
};

// Parse one whole .lp source buffer. `path` is used only for diagnostics.
[[nodiscard]] ParseOutput parse_source(const std::string& source,
                                       const std::string& path);

// Parse one whole library file (libraries/*.lplib). `path` is used only for
// diagnostics.
struct ParseLibraryOutput {
  std::vector<Diagnostic> diagnostics;
  // Present only when the parse tree is error-free.
  std::optional<LibraryAst> library;

  [[nodiscard]] bool ok() const {
    return diagnostics.empty() && library.has_value();
  }
};

[[nodiscard]] ParseLibraryOutput parse_library_source(
    const std::string& source, const std::string& path);

}  // namespace logicpilot::dsl

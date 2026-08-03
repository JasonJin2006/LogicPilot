// Diagnostic formatting (machine-readable, IDE-friendly).
#include "logicpilot/dsl/diagnostics.h"

#include <string>

namespace logicpilot::dsl {

const char* to_string(Severity severity) {
  switch (severity) {
    case Severity::kError: return "error";
    case Severity::kWarning: return "warning";
    case Severity::kNote: return "note";
  }
  return "unknown";
}

std::string format_diagnostic(const std::string& path,
                              const Diagnostic& diagnostic) {
  std::string text = path;
  text += ':';
  text += std::to_string(diagnostic.span.line);
  text += ':';
  text += std::to_string(diagnostic.span.column);
  text += ": ";
  text += to_string(diagnostic.severity);
  text += '[';
  text += diagnostic.code;
  text += "]: ";
  text += diagnostic.message;
  return text;
}

std::string format_diagnostics(const std::string& path,
                               const std::vector<Diagnostic>& diagnostics) {
  std::string joined;
  for (std::size_t i = 0; i < diagnostics.size(); ++i) {
    if (i != 0) {
      joined += '\n';
    }
    joined += format_diagnostic(path, diagnostics[i]);
  }
  return joined;
}

}  // namespace logicpilot::dsl

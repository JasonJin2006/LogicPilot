// DSL compiler diagnostics - structured, machine-readable, span-carrying.
//
// Diagnostic codes form a stable registry so tooling (lpcli today, the web
// IDE gateway in Phase 3) can key on them:
//
//   LP0001  syntax error (tree-sitter ERROR / MISSING node, bad literal)
//   LP0002  io error (source file unreadable)
//   LP1001  duplicate declaration (model member or process stage)
//   LP1002  duplicate field inside a declaration body
//   LP2001  missing required field
//   LP2002  process lacks a required stage kind (source / service)
//   LP2003  stage multiplicity violation (v0: at most one source/queue/service)
//   LP3001  numeric value out of range
//   LP4001  unresolved resource reference
//   LP5001  effect references an undeclared state variable
//   LP5002  coupling references an undeclared atomic model
//   LP5003  coupling port is not an emitted output / declared input
//   LP6001  unknown agent behavior handler
//   LP6002  agent behavior argument mismatch
//   LP7001  experiment field value is not supported (v0.1)
//
// Phase 3 will extend this registry (warnings, notes, fixits); the struct
// layout is already the wire shape used by the diagnostics protocol.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace logicpilot::dsl {

enum class Severity { kError, kWarning, kNote };

[[nodiscard]] const char* to_string(Severity severity);

// Source span: 1-based line/column (tree-sitter is 0-based internally),
// plus the byte range into the source buffer. Zeroed fields = unknown.
struct Span {
  std::uint32_t line{0};
  std::uint32_t column{0};
  std::uint32_t byte_offset{0};
  std::uint32_t byte_length{0};
};

struct Diagnostic {
  Severity severity{Severity::kError};
  std::string code;  // registry entry, e.g. "LP2001"
  std::string message;
  Span span;
};

// "<path>:<line>:<col>: <severity>[<code>]: <message>"
[[nodiscard]] std::string format_diagnostic(const std::string& path,
                                            const Diagnostic& diagnostic);

// All diagnostics joined by newlines (no trailing newline when empty).
[[nodiscard]] std::string format_diagnostics(
    const std::string& path, const std::vector<Diagnostic>& diagnostics);

}  // namespace logicpilot::dsl

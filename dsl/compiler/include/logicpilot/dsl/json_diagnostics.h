// Machine-readable diagnostics JSON (AI copilot loop contract).
//
// lpcli compile --diagnostics-json emits this document so tooling (and
// eventually the LLM-driven model generator) can consume compile failures
// without parsing human text. Always valid JSON:
//
//   {
//     "ok": false,
//     "source_file": "examples/bad.lp",
//     "diagnostics": [
//       { "code": "LP2001", "severity": "error", "message": "...",
//         "span": { "line": 1, "column": 5,
//                   "byte_offset": 10, "byte_length": 4 } }
//     ]
//   }
#pragma once

#include <string>
#include <vector>

#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

// Serializes a compile outcome. `ok` mirrors CompileResult.ok; every string
// is JSON-escaped (quotes, backslashes, control characters).
[[nodiscard]] std::string diagnostics_to_json(
    const std::string& source_file, bool ok,
    const std::vector<Diagnostic>& diagnostics);

}  // namespace logicpilot::dsl

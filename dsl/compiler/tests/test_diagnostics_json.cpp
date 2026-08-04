// Structured JSON diagnostics tests (AI copilot loop contract).
//
// The document shape is stable: { ok, source_file, diagnostics[] } with
// per-diagnostic code/severity/message/span. These tests pin the escaping
// rules and the exact field names so tooling can rely on it.
#include <string>

#include <catch2/catch_test_macros.hpp>

#include "logicpilot/dsl/diagnostics.h"
#include "logicpilot/dsl/json_diagnostics.h"

using namespace logicpilot::dsl;

namespace {

int brace_balance(const std::string& text) {
  int depth = 0;
  bool in_string = false;
  for (std::size_t i = 0; i < text.size(); ++i) {
    const char c = text[i];
    if (in_string) {
      if (c == '\\') {
        ++i;
      } else if (c == '"') {
        in_string = false;
      }
      continue;
    }
    if (c == '"') {
      in_string = true;
    } else if (c == '{') {
      ++depth;
    } else if (c == '}') {
      --depth;
    }
  }
  return depth;
}

Diagnostic make_error(const std::string& code, const std::string& message,
                      std::uint32_t line, std::uint32_t column,
                      std::uint32_t byte_offset, std::uint32_t byte_length) {
  Diagnostic d;
  d.severity = Severity::kError;
  d.code = code;
  d.message = message;
  d.span = Span{line, column, byte_offset, byte_length};
  return d;
}

}  // namespace

TEST_CASE("diagnostics JSON: failure document carries the full contract",
          "[dsl][diagnostics][json]") {
  std::vector<Diagnostic> diagnostics;
  diagnostics.push_back(
      make_error("LP2001", "missing required field 'capacity'", 3, 4, 40, 10));
  diagnostics.push_back(
      make_error("LP1001", "duplicate declaration 'Server'", 7, 1, 90, 8));

  const std::string json = diagnostics_to_json("examples/bad.lp", false,
                                               diagnostics);
  REQUIRE(json.find("{\n  \"ok\": false") == 0);
  REQUIRE(json.find("\"source_file\": \"examples/bad.lp\"") !=
          std::string::npos);
  REQUIRE(json.find("\"code\": \"LP2001\"") != std::string::npos);
  REQUIRE(json.find("\"code\": \"LP1001\"") != std::string::npos);
  REQUIRE(json.find("\"severity\": \"error\"") != std::string::npos);
  REQUIRE(json.find("missing required field 'capacity'") != std::string::npos);
  REQUIRE(json.find("\"span\": { \"line\": 3, \"column\": 4, "
                    "\"byte_offset\": 40, \"byte_length\": 10 }") !=
          std::string::npos);
  REQUIRE(brace_balance(json) == 0);
}

TEST_CASE("diagnostics JSON: success document has an empty list",
          "[dsl][diagnostics][json]") {
  const std::string json = diagnostics_to_json("examples/mm1.lp", true, {});
  REQUIRE(json.find("{\n  \"ok\": true") == 0);
  REQUIRE(json.find("\"diagnostics\": []") != std::string::npos);
  REQUIRE(brace_balance(json) == 0);
}

TEST_CASE("diagnostics JSON: quotes, backslashes and control chars are "
          "escaped", "[dsl][diagnostics][json]") {
  Diagnostic d;
  d.severity = Severity::kWarning;
  d.code = "LP9999";
  d.message = "line1\nline2 \"quoted\" back\\slash";
  const std::string json = diagnostics_to_json("bad\"name.lp", false, {d});

  // No raw control characters other than the document's formatting
  // newlines (JSON whitespace between tokens).
  for (const char c : json) {
    const unsigned char u = static_cast<unsigned char>(c);
    const bool printable = u >= 0x20 || c == '\n';
    REQUIRE(printable);
  }
  // The newline inside the message became a \n escape, never a raw LF.
  REQUIRE(json.find("line1\nline2") == std::string::npos);
  REQUIRE(json.find("line1\\nline2") != std::string::npos);
  // Quotes and backslashes are escaped.
  REQUIRE(json.find("\\\"quoted\\\"") != std::string::npos);
  REQUIRE(json.find("back\\\\slash") != std::string::npos);
  REQUIRE(json.find("bad\\\"name.lp") != std::string::npos);
  REQUIRE(brace_balance(json) == 0);
}

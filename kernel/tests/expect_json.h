// Minimal JSON value lookup for the mm1 acceptance contract.
//
// examples/mm1.expect.json is the single source of tolerance constants. The
// file is a small, hand-controlled document (nested objects of scalars), so
// a scanner beats pulling in a JSON dependency just for tests.
#pragma once

#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>

namespace logicpilot::testing {

inline std::string read_text_file(const std::string& path) {
  std::ifstream in(path);
  if (!in) {
    return {};
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

// Find the substring of the object value belonging to `"section"` (balanced
// braces). Returns an empty string when absent.
inline std::string json_section(const std::string& text,
                                std::string_view section) {
  const std::string key = "\"" + std::string(section) + "\"";
  const std::size_t at = text.find(key);
  if (at == std::string::npos) {
    return {};
  }
  const std::size_t open = text.find('{', at + key.size());
  if (open == std::string::npos) {
    return {};
  }
  int depth = 0;
  bool in_string = false;
  for (std::size_t i = open; i < text.size(); ++i) {
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
      if (depth == 0) {
        return text.substr(open, i - open + 1);
      }
    }
  }
  return {};
}

// Look up `"key": <number>` inside `scope` (whole text when scope empty).
inline std::optional<double> json_number(const std::string& scope,
                                         std::string_view key) {
  const std::string pattern = "\"" + std::string(key) + "\"";
  std::size_t at = 0;
  for (;;) {
    at = scope.find(pattern, at);
    if (at == std::string::npos) {
      return std::nullopt;
    }
    // The key must be followed by ':' (skipping whitespace); otherwise this
    // occurrence is a string value (e.g. "metric": "wq") - keep searching.
    std::size_t cursor = at + pattern.size();
    while (cursor < scope.size() &&
           (scope[cursor] == ' ' || scope[cursor] == '\t' ||
            scope[cursor] == '\n' || scope[cursor] == '\r')) {
      ++cursor;
    }
    if (cursor < scope.size() && scope[cursor] == ':') {
      at = cursor;
      break;
    }
    at += pattern.size();
  }
  ++at;
  while (at < scope.size() && (scope[at] == ' ' || scope[at] == '\t' ||
                               scope[at] == '\n' || scope[at] == '\r')) {
    ++at;
  }
  try {
    std::size_t consumed = 0;
    const double value = std::stod(scope.substr(at), &consumed);
    if (consumed == 0) {
      return std::nullopt;
    }
    return value;
  } catch (...) {
    return std::nullopt;
  }
}

}  // namespace logicpilot::testing

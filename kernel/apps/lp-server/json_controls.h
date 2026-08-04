// Minimal JSON helpers for the lp-server control plane (task #7).
//
// Control messages are flat objects of the form {"cmd": "...", "speed": n}.
// The parser is deliberately minimal (v0): no nesting, no arrays, no escape
// un-escaping. It lives in a header so the boundary behavior (escaping,
// truncation, number formats) is unit-tested without booting a server.
#pragma once

#include <cctype>
#include <charconv>
#include <cstddef>
#include <string>

namespace logicpilot::server {

// Minimal JSON string escaping. Error replies echo caller-supplied input, so
// quotes/backslashes/control characters must be escaped or the reply itself
// becomes invalid JSON (breaking the client's parser).
inline std::string json_escape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 8);
  for (const char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default: out += c; break;
    }
  }
  return out;
}

inline std::string json_error(const std::string& message) {
  return "{\"ok\":false,\"error\":\"" + json_escape(message) + "\"}";
}

inline std::string json_ok(const std::string& cmd) {
  return "{\"ok\":true,\"cmd\":\"" + json_escape(cmd) + "\"}";
}

// Find `"name"` followed by ':' and return the index just past the colon,
// or std::string::npos.
inline std::size_t field_value_start(const std::string& text,
                                     const char* name) {
  const std::string key = std::string{"\""} + name + "\"";
  std::size_t pos = text.find(key);
  if (pos == std::string::npos) {
    return std::string::npos;
  }
  pos = text.find(':', pos + key.size());
  if (pos == std::string::npos) {
    return std::string::npos;
  }
  return pos + 1;
}

// Strict JSON number grammar: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?.
// Validating the token up front keeps accept/reject deterministic across
// toolchains: std::from_chars differs between MSVC and libstdc++ on leading
// '+' signs and dangling exponents, so the parser never lets platform quirks
// decide whether a control message is well-formed.
inline bool is_json_number(const char* first, const char* last) {
  const char* p = first;
  if (p < last && *p == '-') {
    ++p;
  }
  if (p >= last) {
    return false;
  }
  if (*p == '0') {
    ++p;
  } else if (*p >= '1' && *p <= '9') {
    while (p < last && std::isdigit(static_cast<unsigned char>(*p))) {
      ++p;
    }
  } else {
    return false;
  }
  if (p < last && *p == '.') {
    ++p;
    if (p >= last || !std::isdigit(static_cast<unsigned char>(*p))) {
      return false;
    }
    while (p < last && std::isdigit(static_cast<unsigned char>(*p))) {
      ++p;
    }
  }
  if (p < last && (*p == 'e' || *p == 'E')) {
    ++p;
    if (p < last && (*p == '+' || *p == '-')) {
      ++p;
    }
    if (p >= last || !std::isdigit(static_cast<unsigned char>(*p))) {
      return false;
    }
    while (p < last && std::isdigit(static_cast<unsigned char>(*p))) {
      ++p;
    }
  }
  return p == last;
}

inline bool json_string_field(const std::string& text, const char* name,
                              std::string& out) {
  const std::size_t start = field_value_start(text, name);
  if (start == std::string::npos) {
    return false;
  }
  const std::size_t open = text.find('"', start);
  if (open == std::string::npos) {
    return false;
  }
  const std::size_t close = text.find('"', open + 1);
  if (close == std::string::npos) {
    return false;
  }
  out = text.substr(open + 1, close - open - 1);
  return true;
}

inline bool json_number_field(const std::string& text, const char* name,
                              double& out) {
  const std::size_t start = field_value_start(text, name);
  if (start == std::string::npos) {
    return false;
  }
  std::size_t i = start;
  while (i < text.size() && std::isspace(static_cast<unsigned char>(text[i]))) {
    ++i;
  }
  std::size_t end = i;
  while (end < text.size()) {
    const char c = text[end];
    if (std::isdigit(static_cast<unsigned char>(c)) || c == '-' || c == '+' ||
        c == '.' || c == 'e' || c == 'E') {
      ++end;
    } else {
      break;
    }
  }
  if (end == i) {
    return false;
  }
  if (!is_json_number(text.data() + i, text.data() + end)) {
    return false;
  }
  const auto [ptr, ec] =
      std::from_chars(text.data() + i, text.data() + end, out);
  return ec == std::errc{};
}

}  // namespace logicpilot::server

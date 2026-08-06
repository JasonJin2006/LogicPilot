// Minimal JSON value model + recursive-descent parser for the lp-lsp
// language server (P2). Small and self-contained; LSP messages are small
// enough that a full library is overkill. Strings support the common
// escapes (\" \\ \/ \b \f \n \r \t and \uXXXX decoded as UTF-8).
#pragma once

#include <cctype>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace logicpilot::lsp {

struct JsonValue {
  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };

  Type type{Type::kNull};
  bool bool_value{false};
  double number_value{0.0};
  std::string string_value;
  std::vector<JsonValue> array;
  // Entries are owned via unique_ptr: std::pair with an incomplete value type
  // is rejected by strict standard libraries (GCC/Clang), unlike a vector of
  // the (C++17-ok) incomplete JsonValue itself.
  std::vector<std::pair<std::string, std::unique_ptr<JsonValue>>> object;

  [[nodiscard]] bool is_null() const { return type == Type::kNull; }
  [[nodiscard]] bool is_number() const { return type == Type::kNumber; }
  [[nodiscard]] bool is_string() const { return type == Type::kString; }
  [[nodiscard]] bool is_array() const { return type == Type::kArray; }
  [[nodiscard]] bool is_object() const { return type == Type::kObject; }

  [[nodiscard]] const JsonValue* find(const std::string& key) const {
    if (type != Type::kObject) {
      return nullptr;
    }
    for (const auto& [name, value] : object) {
      if (name == key) {
        return value.get();
      }
    }
    return nullptr;
  }

  [[nodiscard]] std::string string_or(const std::string& key,
                                      const std::string& fallback) const {
    const JsonValue* value = find(key);
    return value != nullptr && value->is_string() ? value->string_value
                                                  : fallback;
  }
};

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

inline std::string json_string(const std::string& text) {
  return "\"" + json_escape(text) + "\"";
}

namespace detail {

inline void skip_ws(const char*& p, const char* end) {
  while (p < end && std::isspace(static_cast<unsigned char>(*p))) {
    ++p;
  }
}

inline bool parse_string(const char*& p, const char* end,
                         std::string& out) {
  if (p >= end || *p != '"') {
    return false;
  }
  ++p;
  out.clear();
  while (p < end && *p != '"') {
    if (*p == '\\') {
      ++p;
      if (p >= end) {
        return false;
      }
      switch (*p) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          if (p + 4 >= end) {
            return false;
          }
          std::uint32_t code = 0;
          for (int i = 0; i < 4; ++i) {
            const char c = p[i + 1];
            code <<= 4;
            if (c >= '0' && c <= '9') code |= static_cast<std::uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') code |= static_cast<std::uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') code |= static_cast<std::uint32_t>(c - 'A' + 10);
            else return false;
          }
          p += 4;
          // Encode as UTF-8 (BMP; surrogate pairs are left as-is for v1).
          if (code < 0x80) {
            out += static_cast<char>(code);
          } else if (code < 0x800) {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
          } else {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
          }
          break;
        }
        default: return false;
      }
      ++p;
    } else {
      out += *p;
      ++p;
    }
  }
  if (p >= end) {
    return false;
  }
  ++p;  // closing quote
  return true;
}

inline bool parse_number(const char*& p, const char* end, double& out) {
  const char* start = p;
  if (p < end && (*p == '-' || *p == '+')) {
    ++p;
  }
  bool digit = false;
  while (p < end && std::isdigit(static_cast<unsigned char>(*p))) {
    ++p;
    digit = true;
  }
  if (p < end && *p == '.') {
    ++p;
    while (p < end && std::isdigit(static_cast<unsigned char>(*p))) {
      ++p;
      digit = true;
    }
  }
  if (!digit) {
    p = start;
    return false;
  }
  if (p < end && (*p == 'e' || *p == 'E')) {
    ++p;
    if (p < end && (*p == '-' || *p == '+')) {
      ++p;
    }
    bool exp_digit = false;
    while (p < end && std::isdigit(static_cast<unsigned char>(*p))) {
      ++p;
      exp_digit = true;
    }
    if (!exp_digit) {
      p = start;
      return false;
    }
  }
  out = std::strtod(std::string(start, p - start).c_str(), nullptr);
  return true;
}

}  // namespace detail

namespace detail {

inline bool parse_value(const char*& p, const char* end, JsonValue& out);

inline bool parse_array(const char*& p, const char* end, JsonValue& out) {
  ++p;  // '['
  out.type = JsonValue::Type::kArray;
  skip_ws(p, end);
  if (p < end && *p == ']') {
    ++p;
    return true;
  }
  for (;;) {
    JsonValue item;
    if (!parse_value(p, end, item)) {
      return false;
    }
    out.array.push_back(std::move(item));
    skip_ws(p, end);
    if (p >= end) {
      return false;
    }
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == ']') {
      ++p;
      return true;
    }
    return false;
  }
}

inline bool parse_object(const char*& p, const char* end, JsonValue& out) {
  ++p;  // '{'
  out.type = JsonValue::Type::kObject;
  skip_ws(p, end);
  if (p < end && *p == '}') {
    ++p;
    return true;
  }
  for (;;) {
    skip_ws(p, end);
    std::string key;
    if (p >= end || !parse_string(p, end, key)) {
      return false;
    }
    skip_ws(p, end);
    if (p >= end || *p != ':') {
      return false;
    }
    ++p;
    JsonValue value;
    if (!parse_value(p, end, value)) {
      return false;
    }
    out.object.emplace_back(std::move(key),
                            std::make_unique<JsonValue>(std::move(value)));
    skip_ws(p, end);
    if (p >= end) {
      return false;
    }
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == '}') {
      ++p;
      return true;
    }
    return false;
  }
}

inline bool parse_value(const char*& p, const char* end, JsonValue& out) {
  skip_ws(p, end);
  if (p >= end) {
    return false;
  }
  switch (*p) {
    case 'n': {
      constexpr char kNull[] = "null";
      for (int i = 0; i < 4; ++i) {
        if (p + i >= end || p[i] != kNull[i]) {
          return false;
        }
      }
      p += 4;
      out.type = JsonValue::Type::kNull;
      return true;
    }
    case 't': {
      constexpr char kTrue[] = "true";
      for (int i = 0; i < 4; ++i) {
        if (p + i >= end || p[i] != kTrue[i]) {
          return false;
        }
      }
      p += 4;
      out.type = JsonValue::Type::kBool;
      out.bool_value = true;
      return true;
    }
    case 'f': {
      constexpr char kFalse[] = "false";
      for (int i = 0; i < 5; ++i) {
        if (p + i >= end || p[i] != kFalse[i]) {
          return false;
        }
      }
      p += 5;
      out.type = JsonValue::Type::kBool;
      out.bool_value = false;
      return true;
    }
    case '"':
      out.type = JsonValue::Type::kString;
      return parse_string(p, end, out.string_value);
    case '[':
      return parse_array(p, end, out);
    case '{':
      return parse_object(p, end, out);
    default:
      out.type = JsonValue::Type::kNumber;
      return parse_number(p, end, out.number_value);
  }
}

}  // namespace detail

// Parse one JSON value. Returns kNull (with `error` set) on malformed input.
inline JsonValue parse_json(const std::string& text, std::string* error) {
  const char* p = text.data();
  const char* end = p + text.size();
  JsonValue root;
  if (!detail::parse_value(p, end, root)) {
    if (error != nullptr) {
      *error = "malformed JSON at offset " +
               std::to_string(static_cast<std::size_t>(p - text.data()));
    }
    return JsonValue{};
  }
  detail::skip_ws(p, end);
  if (p != end && error != nullptr) {
    *error = "trailing JSON content";
  }
  return root;
}

}  // namespace logicpilot::lsp

// Minimal reader for `*.lpproj` project bundles (docs/specs/project-format.md).
//
// A bundle is a single-file JSON envelope:
//   { "schema": "logicpilot.project", "format": "bundle", "version": 1,
//     "manifest": { "name": "...", "model": "model/main.lp", ... },
//     "files": { "model/main.lp": "<DSL source>", ... } }
// The parser only reads the fields the CLI consumes (schema marker, manifest
// name, the DSL entry source) and decodes JSON string escapes properly, so
// quotes/newlines/backslashes inside the DSL source survive extraction.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace logicpilot::cli {

struct ProjectBundleInfo {
  std::string name;          // manifest.name (may be empty)
  std::string model_path;    // manifest.model (default "model/main.lp")
  std::string model_source;  // extracted DSL source
};

// Extract manifest name + model source from a bundle. Returns false with
// `error` filled when the envelope is malformed or the model source is
// missing.
inline bool read_project_bundle(const std::string& text,
                                ProjectBundleInfo& out,
                                std::string& error);

// Minimal JSON string escaping (same rules as lp-server's json_controls.h).
inline std::string json_escape(const std::string& text) {
  std::string escaped;
  escaped.reserve(text.size() + 8);
  for (const char c : text) {
    switch (c) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default: escaped += c; break;
    }
  }
  return escaped;
}

namespace detail {

inline std::size_t skip_ws(const std::string& text, std::size_t i) {
  while (i < text.size() && (text[i] == ' ' || text[i] == '\t' ||
                             text[i] == '\r' || text[i] == '\n')) {
    ++i;
  }
  return i;
}

inline void append_utf8(std::string& out, std::uint32_t cp) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
}

inline int hex_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Decode the JSON string starting at `open` (which must point at '"').
// Returns false on a malformed string; `end` is the index just past the
// closing quote.
inline bool parse_json_string(const std::string& text, std::size_t open,
                              std::string& out, std::size_t& end) {
  if (open >= text.size() || text[open] != '"') {
    return false;
  }
  std::size_t i = open + 1;
  while (i < text.size()) {
    const char c = text[i];
    if (c == '"') {
      end = i + 1;
      return true;
    }
    if (c != '\\') {
      out += c;
      ++i;
      continue;
    }
    if (i + 1 >= text.size()) {
      return false;
    }
    const char escape = text[i + 1];
    switch (escape) {
      case '"': out += '"'; i += 2; break;
      case '\\': out += '\\'; i += 2; break;
      case '/': out += '/'; i += 2; break;
      case 'b': out += '\b'; i += 2; break;
      case 'f': out += '\f'; i += 2; break;
      case 'n': out += '\n'; i += 2; break;
      case 'r': out += '\r'; i += 2; break;
      case 't': out += '\t'; i += 2; break;
      case 'u': {
        if (i + 6 > text.size()) {
          return false;
        }
        std::uint32_t cp = 0;
        for (int k = 0; k < 4; ++k) {
          const int digit = hex_value(text[i + 2 + k]);
          if (digit < 0) {
            return false;
          }
          cp = cp * 16 + static_cast<std::uint32_t>(digit);
        }
        i += 6;
        // Combine a UTF-16 surrogate pair.
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= text.size() &&
            text[i] == '\\' && text[i + 1] == 'u') {
          std::uint32_t low = 0;
          bool ok = true;
          for (int k = 0; k < 4; ++k) {
            const int digit = hex_value(text[i + 2 + k]);
            if (digit < 0) {
              ok = false;
              break;
            }
            low = low * 16 + static_cast<std::uint32_t>(digit);
          }
          if (ok && low >= 0xDC00 && low <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
            i += 6;
          }
        }
        append_utf8(out, cp);
        break;
      }
      default:
        return false;
    }
  }
  return false;
}

// Find `"key"` and parse the following JSON string value. `from` is the
// search start, `stop` the exclusive end of the region to scan.
inline bool find_string(const std::string& text, const std::string& key,
                        std::size_t from, std::size_t stop,
                        std::string& out) {
  const std::string needle = "\"" + key + "\"";
  std::size_t pos = text.find(needle, from);
  while (pos != std::string::npos && pos + needle.size() <= stop) {
    const std::size_t colon = text.find(':', pos + needle.size());
    if (colon == std::string::npos || colon >= stop) {
      return false;
    }
    const std::size_t open = skip_ws(text, colon + 1);
    std::size_t end = 0;
    if (parse_json_string(text, open, out, end)) {
      return true;
    }
    // The key matched but the value was not a JSON string (or the match
    // landed inside another string); keep scanning for the next occurrence.
    pos = text.find(needle, pos + needle.size());
  }
  return false;
}

}  // namespace detail

inline bool read_project_bundle(const std::string& text,
                                ProjectBundleInfo& out,
                                std::string& error) {
  std::string schema;
  if (!detail::find_string(text, "schema", 0, text.size(), schema)) {
    error = "not a LogicPilot project bundle (missing schema)";
    return false;
  }
  if (schema != "logicpilot.project") {
    error = "unsupported project schema '" + schema + "'";
    return false;
  }

  const std::string manifest_key = "\"manifest\"";
  const std::string files_key = "\"files\"";
  const std::size_t manifest_pos = text.find(manifest_key);
  const std::size_t files_pos = text.find(files_key);
  const std::size_t scope =
      files_pos != std::string::npos ? files_pos : text.size();

  std::string name;
  std::string model_path;
  if (manifest_pos != std::string::npos) {
    detail::find_string(text, "name", manifest_pos, scope, name);
    detail::find_string(text, "model", manifest_pos, scope, model_path);
  }
  if (model_path.empty()) {
    model_path = "model/main.lp";
  }
  out.name = name;
  out.model_path = model_path;

  if (files_pos == std::string::npos) {
    error = "project bundle has no files table";
    return false;
  }
  const std::size_t files_value = files_pos + files_key.size();
  std::string source;
  if (!detail::find_string(text, model_path, files_value, text.size(),
                           source) ||
      source.empty()) {
    error = "project bundle is missing model source '" + model_path + "'";
    return false;
  }
  out.model_source = source;
  return true;
}

}  // namespace logicpilot::cli

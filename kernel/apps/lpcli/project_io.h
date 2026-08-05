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
#include <filesystem>
#include <fstream>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace logicpilot::cli {

struct ProjectBundleInfo {
  std::string name;            // manifest.name (may be empty)
  std::string model_path;      // manifest.model (default "model/main.lp")
  std::string model_source;    // merged DSL source (main + model parts)
  std::vector<std::string> part_paths;  // manifest.modelParts
};

inline bool read_text_file(const std::string& path, std::string& out) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return false;
  }
  out.assign((std::istreambuf_iterator<char>(in)),
             std::istreambuf_iterator<char>());
  return true;
}

// Replace `instance <name> = "<path>"` lines with the referenced scene's
// container text (resolved via `lookup`). Scenes are canonical: the instance
// name equals the scene's container name, so no renaming is needed. Missing
// scenes leave the line untouched (the compiler will report the unknown
// kind).
inline std::string resolve_instances(
    const std::string& source,
    const std::function<std::string(const std::string&)>& lookup) {
  std::string out;
  out.reserve(source.size());
  std::size_t i = 0;
  const std::size_t n = source.size();
  while (i < n) {
    std::size_t line_end = source.find('\n', i);
    if (line_end == std::string::npos) {
      line_end = n;
    }
    const std::string line = source.substr(i, line_end - i);
    const std::size_t start = line.find_first_not_of(" \t\r");
    if (start != std::string::npos && line.compare(start, 8, "instance") == 0) {
      const std::size_t open = line.find('"', start + 8);
      const std::size_t close =
          open == std::string::npos ? std::string::npos : line.find('"', open + 1);
      if (open != std::string::npos && close != std::string::npos) {
        const std::string path = line.substr(open + 1, close - open - 1);
        const std::string scene = lookup(path);
        if (!scene.empty()) {
          out += scene;
          if (!scene.ends_with('\n')) {
            out += '\n';
          }
          i = line_end < n ? line_end + 1 : n;
          continue;
        }
      }
    }
    out += line;
    if (line_end < n) {
      out += '\n';
    }
    i = line_end < n ? line_end + 1 : n;
  }
  return out;
}

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

// Parse a JSON array of strings, e.g. manifest.modelParts. `open` must point
// at '['. Returns false on malformed input.
inline bool parse_json_string_array(const std::string& text, std::size_t open,
                                    std::vector<std::string>& out) {
  if (open >= text.size() || text[open] != '[') {
    return false;
  }
  std::size_t i = skip_ws(text, open + 1);
  if (i < text.size() && text[i] == ']') {
    return true;  // empty array
  }
  for (;;) {
    i = skip_ws(text, i);
    if (i >= text.size() || text[i] != '"') {
      return false;
    }
    std::string value;
    std::size_t end = 0;
    if (!parse_json_string(text, i, value, end)) {
      return false;
    }
    out.push_back(std::move(value));
    i = skip_ws(text, end);
    if (i >= text.size()) {
      return false;
    }
    if (text[i] == ']') {
      return true;
    }
    if (text[i] != ',') {
      return false;
    }
    ++i;
  }
}

// Insert `parts` (already indented as model members) before the model's
// closing brace. The scan is intentionally simple: the main file written by
// the IDE is `model <name> { ... }` without string literals containing
// braces.
inline std::string merge_model_parts(
    const std::string& main_source,
    const std::vector<std::pair<std::string, std::string>>& parts) {
  std::string chunks;
  for (const auto& [path, content] : parts) {
    (void)path;
    if (content.find_first_not_of(" \t\r\n") != std::string::npos) {
      chunks += content;
      if (chunks.empty() || chunks.back() != '\n') {
        chunks += '\n';
      }
    }
  }
  if (chunks.empty()) {
    return main_source;
  }
  const std::size_t open = main_source.find('{');
  if (open == std::string::npos) {
    return main_source;
  }
  std::size_t depth = 1;
  std::size_t i = open + 1;
  while (i < main_source.size() && depth > 0) {
    if (main_source[i] == '{') {
      ++depth;
    } else if (main_source[i] == '}') {
      --depth;
    }
    ++i;
  }
  const std::size_t close = depth == 0 ? i - 1 : main_source.size();
  return main_source.substr(0, close) + "\n" + chunks + main_source.substr(close);
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

  // Per-concern model part files (manifest.modelParts) are merged into the
  // model body before compiling.
  std::vector<std::string> part_paths;
  const std::string parts_key = "\"modelParts\"";
  const std::size_t parts_pos = text.find(parts_key);
  if (parts_pos != std::string::npos) {
    const std::size_t colon = text.find(':', parts_pos + parts_key.size());
    if (colon != std::string::npos) {
      const std::size_t open = detail::skip_ws(text, colon + 1);
      detail::parse_json_string_array(text, open, part_paths);
    }
  }
  std::vector<std::pair<std::string, std::string>> parts;
  for (const std::string& part_path : part_paths) {
    std::string part_source;
    if (detail::find_string(text, part_path, files_value, text.size(),
                            part_source)) {
      parts.emplace_back(part_path, std::move(part_source));
    }
  }
  out.part_paths = std::move(part_paths);
  out.model_source = detail::merge_model_parts(source, parts);
  // Expand `instance` members by looking the referenced scenes up in the
  // bundle's files table.
  out.model_source = resolve_instances(out.model_source, [&](const std::string& path) {
    std::string content;
    detail::find_string(text, path, files_value, text.size(), content);
    return content;
  });
  return true;
}

// Read an on-disk project directory: <dir>/logicpilot.json plus the declared
// model source and part fragments (merged), mirroring read_project_bundle.
inline bool read_project_dir(const std::string& dir, ProjectBundleInfo& out,
                             std::string& error) {
  const std::filesystem::path root{dir};
  std::string manifest;
  if (!read_text_file((root / "logicpilot.json").string(), manifest)) {
    error = "project directory has no logicpilot.json";
    return false;
  }
  std::string name;
  std::string model_path;
  detail::find_string(manifest, "name", 0, manifest.size(), name);
  detail::find_string(manifest, "model", 0, manifest.size(), model_path);
  if (model_path.empty()) {
    model_path = "model/main.lp";
  }
  std::vector<std::string> part_paths;
  const std::string parts_key = "\"modelParts\"";
  const std::size_t parts_pos = manifest.find(parts_key);
  if (parts_pos != std::string::npos) {
    const std::size_t colon = manifest.find(':', parts_pos + parts_key.size());
    if (colon != std::string::npos) {
      detail::parse_json_string_array(
          manifest, detail::skip_ws(manifest, colon + 1), part_paths);
    }
  }
  std::string main_source;
  if (!read_text_file((root / model_path).string(), main_source)) {
    error = "cannot read model source '" + model_path + "'";
    return false;
  }
  std::vector<std::pair<std::string, std::string>> parts;
  for (const std::string& part_path : part_paths) {
    std::string content;
    if (read_text_file((root / part_path).string(), content)) {
      parts.emplace_back(part_path, std::move(content));
    }
  }
  out.name = name;
  out.model_path = model_path;
  out.part_paths = std::move(part_paths);
  out.model_source = detail::merge_model_parts(main_source, parts);
  // Expand `instance` members by reading the referenced scenes from disk.
  out.model_source = resolve_instances(out.model_source, [&](const std::string& path) {
    std::string content;
    read_text_file((root / path).string(), content);
    return content;
  });
  return true;
}

}  // namespace logicpilot::cli

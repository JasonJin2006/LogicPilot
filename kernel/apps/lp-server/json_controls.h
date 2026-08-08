// JSON helpers for the lp-server control plane (task #7).
//
// Control messages are objects of the form {"cmd": "...", "speed": n}.
// Parsing uses nlohmann/json so malformed input, escapes, nested decoy keys
// and platform-specific number edge cases have standard JSON semantics.
#pragma once

#include <cmath>
#include <string>

#include <nlohmann/json.hpp>

namespace logicpilot::server {

// JSON string escaping. Error replies echo caller-supplied input, so
// quotes/backslashes/control characters must be escaped or the reply itself
// becomes invalid JSON (breaking the client's parser).
inline std::string json_escape(const std::string& text) {
  const std::string quoted = nlohmann::json(text).dump();
  return quoted.substr(1, quoted.size() - 2);
}

inline std::string json_error(const std::string& message) {
  return "{\"ok\":false,\"error\":\"" + json_escape(message) + "\"}";
}

inline std::string json_ok(const std::string& cmd) {
  return "{\"ok\":true,\"cmd\":\"" + json_escape(cmd) + "\"}";
}

inline nlohmann::json parse_json_object(const std::string& text) {
  auto value = nlohmann::json::parse(text, nullptr, false);
  return value.is_object() ? std::move(value) : nlohmann::json{};
}

inline bool json_string_field(const std::string& text, const char* name,
                              std::string& out) {
  const auto object = parse_json_object(text);
  const auto it = object.find(name);
  if (it == object.end() || !it->is_string()) {
    return false;
  }
  out = it->get<std::string>();
  return true;
}

inline bool json_number_field(const std::string& text, const char* name,
                              double& out) {
  const auto object = parse_json_object(text);
  const auto it = object.find(name);
  if (it == object.end() || !it->is_number()) {
    return false;
  }
  out = it->get<double>();
  return std::isfinite(out);
}

}  // namespace logicpilot::server

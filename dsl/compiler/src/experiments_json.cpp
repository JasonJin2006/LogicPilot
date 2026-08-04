// Experiment sidecar serializer (see experiments_json.h).
#include "logicpilot/dsl/experiments_json.h"

#include <cstddef>

namespace logicpilot::dsl {
namespace {

std::string json_escape(const std::string& text) {
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

}  // namespace

std::string experiments_to_json(
    const std::vector<ExperimentDecl>& experiments) {
  std::string out = "{\n  \"experiments\": [";
  for (std::size_t i = 0; i < experiments.size(); ++i) {
    const ExperimentDecl& e = experiments[i];
    out += i == 0 ? "\n" : ",\n";
    out += "    { \"name\": \"";
    out += json_escape(e.name);
    out += "\", \"objective\": \"";
    out += json_escape(e.objective);
    out += "\", \"metric\": \"";
    out += json_escape(e.metric);
    out += "\", \"variable\": \"";
    out += json_escape(e.variable);
    out += "\", \"range\": [";
    out += std::to_string(e.range_min);
    out += ", ";
    out += std::to_string(e.range_max);
    out += "], \"budget\": ";
    out += std::to_string(e.budget);
    out += " }";
  }
  out += experiments.empty() ? "]\n" : "\n  ]\n";
  out += "}\n";
  return out;
}

}  // namespace logicpilot::dsl

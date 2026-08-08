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
    out += "\", \"kind\": \"";
    out += json_escape(e.kind.empty()
                           ? (!e.axes.empty()
                                  ? "parameter_variation"
                                  : (e.has_objective || e.has_variable || e.has_range
                                         ? "optimization"
                                         : "simulation"))
                           : e.kind);
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
    out += ", \"replications\": ";
    out += std::to_string(e.replications);
    out += ", \"seed\": ";
    out += std::to_string(e.seed);
    out += ", \"seed_mode\": \"" + e.seed_mode + "\"";
    out += ", \"replication_mode\": \"" + e.replication_mode + "\"";
    out += ", \"min_replications\": " + std::to_string(e.min_replications);
    out += ", \"max_replications\": " + std::to_string(e.max_replications);
    out += ", \"confidence\": " + std::to_string(e.confidence);
    out += ", \"error_percent\": " + std::to_string(e.error_percent);
    out += ", \"axes\": [";
    for (std::size_t axis_index = 0; axis_index < e.axes.size(); ++axis_index) {
      const VariationAxis& axis = e.axes[axis_index];
      if (axis_index > 0) out += ", ";
      out += "{\"name\": \"" + axis.name + "\", \"variable\": \"" +
             axis.variable + "\", \"min\": " + std::to_string(axis.range_min) +
             ", \"max\": " + std::to_string(axis.range_max) +
             ", \"step\": " + std::to_string(axis.step) + "}";
    }
    out += "]";
    out += " }";
  }
  out += experiments.empty() ? "]\n" : "\n  ]\n";
  out += "}\n";
  return out;
}

}  // namespace logicpilot::dsl

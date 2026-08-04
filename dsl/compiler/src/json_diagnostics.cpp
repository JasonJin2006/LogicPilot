// JSON diagnostics serializer (see json_diagnostics.h). Hand-rolled minimal
// JSON output keeps the compiler dependency-free; the document shape is the
// stable wire contract for the AI copilot loop.
#include "logicpilot/dsl/json_diagnostics.h"

#include <cstddef>

namespace logicpilot::dsl {
namespace {

std::string json_escape(const std::string& text) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out;
  out.reserve(text.size() + 8);
  for (const char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          out += "\\u00";
          out += kHex[(static_cast<unsigned char>(c) >> 4) & 0xF];
          out += kHex[static_cast<unsigned char>(c) & 0xF];
        } else {
          out += c;
        }
        break;
    }
  }
  return out;
}

}  // namespace

std::string diagnostics_to_json(const std::string& source_file, bool ok,
                                const std::vector<Diagnostic>& diagnostics) {
  std::string out;
  out.reserve(256 + diagnostics.size() * 96);
  out += "{\n  \"ok\": ";
  out += ok ? "true" : "false";
  out += ",\n  \"source_file\": \"";
  out += json_escape(source_file);
  out += "\",\n  \"diagnostics\": [";
  for (std::size_t i = 0; i < diagnostics.size(); ++i) {
    const Diagnostic& d = diagnostics[i];
    out += i == 0 ? "\n" : ",\n";
    out += "    { \"code\": \"";
    out += json_escape(d.code);
    out += "\", \"severity\": \"";
    out += to_string(d.severity);
    out += "\", \"message\": \"";
    out += json_escape(d.message);
    out += "\", \"span\": { \"line\": ";
    out += std::to_string(d.span.line);
    out += ", \"column\": ";
    out += std::to_string(d.span.column);
    out += ", \"byte_offset\": ";
    out += std::to_string(d.span.byte_offset);
    out += ", \"byte_length\": ";
    out += std::to_string(d.span.byte_length);
    out += " } }";
  }
  out += diagnostics.empty() ? "]\n" : "\n  ]\n";
  out += "}\n";
  return out;
}

}  // namespace logicpilot::dsl

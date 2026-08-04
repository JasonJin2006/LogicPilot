// Structural IR dump implementation (deterministic text rendering used by
// golden regression tests; raw FlatBuffers bytes are order-sensitive).
// Dumps the v2 Node/SemanticsRef tree (schemas/ir_v2.fbs).
#include "logicpilot/dsl/ir_dump.h"

#include <sstream>
#include <string>

#include "ir_v2_generated.h"

namespace logicpilot::dsl {
namespace {

using logicpilot::ir::v2::Distribution;
using logicpilot::ir::v2::Node;
using logicpilot::ir::v2::Var;
using logicpilot::ir::v2::VarType_Bool;
using logicpilot::ir::v2::VarType_Int;
using logicpilot::ir::v2::VarType_Float;
using logicpilot::ir::v2::VarType_String;
using logicpilot::ir::v2::VarType_Distribution;

std::string format_double(double value) {
  std::ostringstream out;
  out.precision(10);
  out << value;
  return out.str();
}

const char* node_name(const Node* node) {
  if (node != nullptr && node->metadata() != nullptr &&
      node->metadata()->name() != nullptr) {
    return node->metadata()->name()->c_str();
  }
  return "<unnamed>";
}

const char* node_library(const Node* node) {
  if (node != nullptr && node->semantics() != nullptr &&
      node->semantics()->library() != nullptr) {
    return node->semantics()->library()->c_str();
  }
  return "";
}

const char* node_block(const Node* node) {
  if (node != nullptr && node->semantics() != nullptr &&
      node->semantics()->block() != nullptr) {
    return node->semantics()->block()->c_str();
  }
  return "";
}

std::string distribution_text(const Distribution* dist) {
  if (dist == nullptr) {
    return "<none>";
  }
  const char* kind = "Unknown";
  switch (dist->kind()) {
    case 0: kind = "Constant"; break;
    case 1: kind = "Uniform"; break;
    case 2: kind = "Normal"; break;
    case 3: kind = "Exponential"; break;
    case 4: kind = "Poisson"; break;
  }
  std::string text = kind;
  text += " params=[";
  if (dist->params() != nullptr) {
    for (flatbuffers::uoffset_t i = 0; i < dist->params()->size(); ++i) {
      if (i != 0) {
        text += ", ";
      }
      text += format_double(dist->params()->Get(i));
    }
  }
  text += ']';
  return text;
}

void dump_var(std::ostringstream& out, const Var* var) {
  if (var == nullptr) {
    out << "<none>\n";
    return;
  }
  out << (var->name() != nullptr ? var->name()->c_str() : "<unnamed>")
      << " = ";
  switch (var->type()) {
    case VarType_Bool:
      out << "bool(" << (var->bool_value() ? "true" : "false") << ')';
      break;
    case VarType_Int:
      out << "int(" << var->int_value() << ')';
      break;
    case VarType_Float:
      out << "float(" << format_double(var->float_value()) << ')';
      break;
    case VarType_String:
      out << "string('"
          << (var->string_value() != nullptr ? var->string_value()->c_str()
                                             : "")
          << "')";
      break;
    case VarType_Distribution:
      out << "distribution(" << distribution_text(var->distribution())
          << ')';
      break;
    default:
      out << "<none>";
      break;
  }
  out << '\n';
}

void dump_vars(std::ostringstream& out, const std::string& indent,
               const char* label,
               const flatbuffers::Vector<flatbuffers::Offset<Var>>* vars) {
  if (vars == nullptr) {
    return;
  }
  for (const Var* var : *vars) {
    out << indent << label << ' ';
    dump_var(out, var);
  }
}

void dump_couplings(
    std::ostringstream& out, const std::string& indent,
    const flatbuffers::Vector<
        flatbuffers::Offset<logicpilot::ir::v2::Coupling>>* couplings) {
  if (couplings == nullptr) {
    return;
  }
  for (const auto* coupling : *couplings) {
    out << indent << "coupling '"
        << (coupling->from_model() != nullptr
                ? coupling->from_model()->c_str()
                : "")
        << "'." << (coupling->from_port() != nullptr
                        ? coupling->from_port()->c_str()
                        : "")
        << " -> '"
        << (coupling->to_model() != nullptr ? coupling->to_model()->c_str()
                                            : "")
        << "'." << (coupling->to_port() != nullptr
                        ? coupling->to_port()->c_str()
                        : "")
        << '\n';
  }
}

void dump_node(std::ostringstream& out, const std::string& indent,
               const Node* node) {
  if (node == nullptr) {
    out << indent << "node <null>\n";
    return;
  }
  out << indent << "node '" << node_name(node) << "' library='"
      << node_library(node) << "' block='" << node_block(node) << "'\n";
  dump_vars(out, indent + "  ", "state", node->state());
  dump_vars(out, indent + "  ", "param", node->params());
  if (node->ports() != nullptr) {
    for (const auto* port : *node->ports()) {
      out << indent << "  port '"
          << (port->name() != nullptr ? port->name()->c_str() : "") << "' dir="
          << (port->direction() == logicpilot::ir::v2::PortDirection_Input
                  ? "input"
                  : "output")
          << '\n';
    }
  }
  if (node->children() != nullptr) {
    for (const Node* child : *node->children()) {
      dump_node(out, indent + "  ", child);
    }
  }
  dump_couplings(out, indent + "  ", node->couplings());
  if (node->continuous() != nullptr) {
    for (const auto* equation : *node->continuous()) {
      out << indent << "  equation "
          << (equation->lhs() != nullptr ? equation->lhs()->c_str() : "")
          << " = "
          << (equation->rhs_text() != nullptr
                  ? equation->rhs_text()->c_str()
                  : "")
          << " (initial " << format_double(equation->initial_value()) << ")\n";
    }
  }
  if (node->behavior() != nullptr &&
      node->behavior()->transitions() != nullptr) {
    for (const auto* transition : *node->behavior()->transitions()) {
      out << indent << "  transition "
          << (transition->from() != nullptr ? transition->from()->c_str() : "")
          << " -> "
          << (transition->to() != nullptr ? transition->to()->c_str() : "")
          << " trigger=" << static_cast<int>(transition->trigger()) << '\n';
    }
  }
}

}  // namespace

std::string dump_ir(const IrModelFile& file) {
  std::ostringstream out;
  if (file.v2_root == nullptr) {
    return "ModelFile <empty>\n";
  }
  out << "ModelFile schema_version=" << file.v2_root->schema_version() << '\n';
  if (file.v2_root->metadata() != nullptr) {
    out << "metadata name='"
        << (file.v2_root->metadata()->name() != nullptr
                ? file.v2_root->metadata()->name()->c_str()
                : "")
        << "'\n";
  }
  if (file.v2_root->root() != nullptr) {
    dump_node(out, "root ", file.v2_root->root());
  }
  if (file.v2_root->experiments() != nullptr) {
    for (const auto* experiment : *file.v2_root->experiments()) {
      out << "experiment '"
          << (experiment->name() != nullptr ? experiment->name()->c_str() : "")
          << "' objective='"
          << (experiment->objective() != nullptr
                  ? experiment->objective()->c_str()
                  : "")
          << "' metric='"
          << (experiment->metric() != nullptr ? experiment->metric()->c_str()
                                              : "")
          << "' variable='"
          << (experiment->variable() != nullptr
                  ? experiment->variable()->c_str()
                  : "")
          << "' range=" << experiment->range_min() << ".."
          << experiment->range_max() << " budget=" << experiment->budget()
          << '\n';
    }
  }
  return out.str();
}

}  // namespace logicpilot::dsl

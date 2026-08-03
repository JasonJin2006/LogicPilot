// Structural IR dump implementation (deterministic text rendering used by
// golden regression tests; raw FlatBuffers bytes are order-sensitive).
#include "logicpilot/dsl/ir_dump.h"

#include <sstream>
#include <string>

#include "ir_generated.h"

namespace logicpilot::dsl {
namespace {

using logicpilot::ir::Model;

std::string format_double(double value) {
  std::ostringstream out;
  out.precision(10);
  out << value;
  return out.str();
}

std::string meta_name(const logicpilot::ir::Metadata* meta) {
  if (meta != nullptr && meta->name() != nullptr) {
    return meta->name()->str();
  }
  return "<unnamed>";
}

std::string distribution_text(const logicpilot::ir::Distribution* dist) {
  if (dist == nullptr) {
    return "<none>";
  }
  const char* kind = "Unknown";
  switch (dist->kind()) {
    case logicpilot::ir::DistributionKind_Constant: kind = "Constant"; break;
    case logicpilot::ir::DistributionKind_Uniform: kind = "Uniform"; break;
    case logicpilot::ir::DistributionKind_Normal: kind = "Normal"; break;
    case logicpilot::ir::DistributionKind_Exponential:
      kind = "Exponential";
      break;
    case logicpilot::ir::DistributionKind_Poisson: kind = "Poisson"; break;
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

void dump_param(std::ostringstream& out, const std::string& indent,
                const logicpilot::ir::Param* param) {
  out << indent << "param "
      << (param->name() != nullptr ? param->name()->c_str() : "<unnamed>")
      << " = ";
  switch (param->value_type()) {
    case logicpilot::ir::ParamValue_IntValue:
      out << "int(" << param->value_as_IntValue()->value() << ')';
      break;
    case logicpilot::ir::ParamValue_FloatValue:
      out << "float("
          << format_double(param->value_as_FloatValue()->value()) << ')';
      break;
    case logicpilot::ir::ParamValue_BoolValue:
      out << "bool("
          << (param->value_as_BoolValue()->value() ? "true" : "false")
          << ')';
      break;
    case logicpilot::ir::ParamValue_StringValue:
      out << "string('" << param->value_as_StringValue()->value()->c_str()
          << "')";
      break;
    case logicpilot::ir::ParamValue_Distribution:
      out << "distribution("
          << distribution_text(param->value_as_Distribution()) << ')';
      break;
    default:
      out << "<none>";
      break;
  }
  out << '\n';
}

void dump_params(std::ostringstream& out, const std::string& indent,
                 const flatbuffers::Vector<
                     flatbuffers::Offset<logicpilot::ir::Param>>* params) {
  if (params == nullptr) {
    return;
  }
  for (const logicpilot::ir::Param* param : *params) {
    dump_param(out, indent, param);
  }
}

void dump_couplings(
    std::ostringstream& out, const std::string& indent,
    const flatbuffers::Vector<
        flatbuffers::Offset<logicpilot::ir::Coupling>>* couplings) {
  if (couplings == nullptr) {
    return;
  }
  for (const logicpilot::ir::Coupling* coupling : *couplings) {
    out << indent << "coupling '"
        << (coupling->from_model() ? coupling->from_model()->c_str() : "")
        << "'." << (coupling->from_port() ? coupling->from_port()->c_str()
                                           : "")
        << " -> '"
        << (coupling->to_model() ? coupling->to_model()->c_str() : "") << "'."
        << (coupling->to_port() ? coupling->to_port()->c_str() : "") << '\n';
  }
}

void dump_process_node(std::ostringstream& out, const std::string& indent,
                       const logicpilot::ir::ProcessNode* node) {
  out << indent << "node '"
      << (node->name() != nullptr ? node->name()->c_str() : "<unnamed>")
      << "' kind=";
  switch (node->kind_type()) {
    case logicpilot::ir::ProcessNodeKind_SourceNode: {
      out << "SourceNode\n";
      const auto* spec = node->kind_as_SourceNode();
      out << indent << "  arrival " << distribution_text(spec->arrival())
          << '\n';
      out << indent << "  max_arrivals " << spec->max_arrivals() << '\n';
      break;
    }
    case logicpilot::ir::ProcessNodeKind_QueueNode: {
      out << "QueueNode\n";
      const auto* spec = node->kind_as_QueueNode();
      out << indent << "  capacity " << spec->capacity() << '\n';
      out << indent << "  discipline "
          << (spec->discipline() == logicpilot::ir::QueueDiscipline_Fifo
                  ? "Fifo"
                  : spec->discipline() == logicpilot::ir::QueueDiscipline_Lifo
                        ? "Lifo"
                        : "Priority")
          << '\n';
      break;
    }
    case logicpilot::ir::ProcessNodeKind_ServiceNode: {
      out << "ServiceNode\n";
      const auto* spec = node->kind_as_ServiceNode();
      out << indent << "  service_time "
          << distribution_text(spec->service_time()) << '\n';
      out << indent << "  resource '"
          << (spec->resource() != nullptr ? spec->resource()->c_str() : "")
          << "'\n";
      out << indent << "  servers " << spec->servers() << '\n';
      break;
    }
    case logicpilot::ir::ProcessNodeKind_SinkNode:
      out << "SinkNode\n";
      break;
    case logicpilot::ir::ProcessNodeKind_DelayNode: {
      out << "DelayNode\n";
      const auto* spec = node->kind_as_DelayNode();
      out << indent << "  delay " << distribution_text(spec->delay())
          << '\n';
      break;
    }
    default:
      out << "Unknown\n";
      break;
  }
}

void dump_atomic(std::ostringstream& out, const std::string& indent,
                 const logicpilot::ir::AtomicModel* atomic) {
  out << indent << "AtomicModel name='" << meta_name(atomic->metadata())
      << "'\n";
  if (atomic->ta() != nullptr) {
    out << indent << "  ta kind=";
    switch (atomic->ta()->kind()) {
      case logicpilot::ir::TimeAdvanceKind_Constant:
        out << "Constant value=" << format_double(atomic->ta()->value());
        break;
      case logicpilot::ir::TimeAdvanceKind_Distribution:
        out << "Distribution " << distribution_text(atomic->ta()->distribution());
        break;
      case logicpilot::ir::TimeAdvanceKind_Expression:
        out << "Expression";
        break;
      case logicpilot::ir::TimeAdvanceKind_Infinite:
        out << "Infinite";
        break;
    }
    out << '\n';
  }
  dump_params(out, indent + "  ", atomic->params());
}

void dump_process(std::ostringstream& out, const std::string& indent,
                  const logicpilot::ir::ProcessModel* process) {
  out << indent << "ProcessModel name='" << meta_name(process->metadata())
      << "'\n";
  if (process->nodes() != nullptr) {
    for (const logicpilot::ir::ProcessNode* node : *process->nodes()) {
      dump_process_node(out, indent + "  ", node);
    }
  }
  dump_couplings(out, indent + "  ", process->couplings());
  dump_params(out, indent + "  ", process->params());
}

void dump_model(std::ostringstream& out, const std::string& indent,
                const Model* model) {
  switch (model->kind_type()) {
    case logicpilot::ir::ModelKind_AtomicModel:
      dump_atomic(out, indent, model->kind_as_AtomicModel());
      break;
    case logicpilot::ir::ModelKind_CoupledModel: {
      const auto* coupled = model->kind_as_CoupledModel();
      out << indent << "CoupledModel name='"
          << meta_name(coupled->metadata()) << "'\n";
      if (coupled->children() != nullptr) {
        for (const Model* child : *coupled->children()) {
          dump_model(out, indent + "  ", child);
        }
      }
      dump_couplings(out, indent + "  ", coupled->couplings());
      dump_params(out, indent + "  ", coupled->params());
      break;
    }
    case logicpilot::ir::ModelKind_AgentModel: {
      const auto* agent = model->kind_as_AgentModel();
      out << indent << "AgentModel name='" << meta_name(agent->metadata())
          << "'\n";
      break;
    }
    case logicpilot::ir::ModelKind_ProcessModel:
      dump_process(out, indent, model->kind_as_ProcessModel());
      break;
    case logicpilot::ir::ModelKind_EquationModel: {
      const auto* equation = model->kind_as_EquationModel();
      out << indent << "EquationModel name='"
          << meta_name(equation->metadata()) << "'\n";
      break;
    }
    default:
      out << indent << "UnknownModel\n";
      break;
  }
}

}  // namespace

std::string dump_ir(const IrModelFile& file) {
  std::ostringstream out;
  if (file.root == nullptr || file.root->root() == nullptr) {
    return "ModelFile <empty>\n";
  }
  out << "ModelFile schema_version=" << file.root->schema_version() << '\n';
  if (file.root->metadata() != nullptr) {
    out << "metadata name='" << meta_name(file.root->metadata()) << "'\n";
  }
  dump_model(out, "root ", file.root->root());
  return out.str();
}

}  // namespace logicpilot::dsl

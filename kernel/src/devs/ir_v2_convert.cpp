// IR v2 <-> v1 converters (process path). See ir_v2_convert.h.
#include "logicpilot/devs/ir_v2_convert.h"

#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include <flatbuffers/flatbuffers.h>

#include "ir_generated.h"
#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

namespace v1 = logicpilot::ir;
namespace v2 = logicpilot::ir::v2;

std::vector<std::uint8_t> fail(std::string* error,
                               const std::string& message) {
  if (error != nullptr) {
    *error = message;
  }
  return {};
}

// ---------------------------------------------------------------------------
// v1 building helpers
// ---------------------------------------------------------------------------

flatbuffers::Offset<v1::Metadata> meta_v1(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const char* source_file) {
  const auto name_offset = name != nullptr ? builder.CreateString(name) : 0;
  const auto file_offset =
      source_file != nullptr ? builder.CreateString(source_file) : 0;
  return v1::CreateMetadata(builder, name_offset, 0, file_offset, 0);
}

flatbuffers::Offset<v1::Distribution> dist_v1(
    flatbuffers::FlatBufferBuilder& builder,
    const v1::Distribution* distribution) {
  if (distribution == nullptr) {
    return 0;
  }
  std::vector<double> params;
  if (distribution->params() != nullptr) {
    for (flatbuffers::uoffset_t i = 0; i < distribution->params()->size();
         ++i) {
      params.push_back(distribution->params()->Get(i));
    }
  }
  return v1::CreateDistribution(builder, distribution->kind(),
                                builder.CreateVector(params));
}

flatbuffers::Offset<v1::Distribution> dist_v1(
    flatbuffers::FlatBufferBuilder& builder,
    const v2::Distribution* distribution) {
  if (distribution == nullptr) {
    return 0;
  }
  std::vector<double> params;
  if (distribution->params() != nullptr) {
    for (flatbuffers::uoffset_t i = 0; i < distribution->params()->size();
         ++i) {
      params.push_back(distribution->params()->Get(i));
    }
  }
  return v1::CreateDistribution(
      builder, static_cast<v1::DistributionKind>(distribution->kind()),
                                builder.CreateVector(params));
}

flatbuffers::Offset<v1::Param> int_param_v1(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    std::int64_t value) {
  const auto name_offset = builder.CreateString(name);
  const auto value_offset =
      v1::CreateIntValue(builder, value).Union();
  return v1::CreateParam(builder, name_offset,
                         v1::ParamValue_IntValue, value_offset);
}

flatbuffers::Offset<v1::Param> float_param_v1(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    double value) {
  const auto name_offset = builder.CreateString(name);
  const auto value_offset =
      v1::CreateFloatValue(builder, value).Union();
  return v1::CreateParam(builder, name_offset,
                         v1::ParamValue_FloatValue, value_offset);
}

// Read a named FloatValue / IntValue from a v2 Node's typed params.
double node_float_param(const v2::Node* node, const char* name,
                        double fallback) {
  if (node != nullptr && node->params() != nullptr) {
    for (const v2::Var* var : *node->params()) {
      if (var->name() != nullptr && var->name()->str() == name &&
          var->type() == v2::VarType_Float) {
        return var->float_value();
      }
    }
  }
  return fallback;
}

std::int64_t node_int_param(const v2::Node* node, const char* name,
                            std::int64_t fallback) {
  if (node != nullptr && node->params() != nullptr) {
    for (const v2::Var* var : *node->params()) {
      if (var->name() != nullptr && var->name()->str() == name &&
          var->type() == v2::VarType_Int) {
        return var->int_value();
      }
    }
  }
  return fallback;
}

bool node_has_float_param(const v2::Node* node, const char* name) {
  if (node != nullptr && node->params() != nullptr) {
    for (const v2::Var* var : *node->params()) {
      if (var->name() != nullptr && var->name()->str() == name &&
          var->type() == v2::VarType_Float) {
        return true;
      }
    }
  }
  return false;
}

const v2::Distribution* node_dist_param(const v2::Node* node,
                                        const char* name) {
  if (node != nullptr && node->params() != nullptr) {
    for (const v2::Var* var : *node->params()) {
      if (var->name() != nullptr && var->name()->str() == name &&
          var->type() == v2::VarType_Distribution &&
          var->distribution() != nullptr) {
        return var->distribution();
      }
    }
  }
  return nullptr;
}

// ---------------------------------------------------------------------------
// v2 building helpers
// ---------------------------------------------------------------------------

flatbuffers::Offset<v2::Metadata> meta_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* name) {
  const auto name_offset = name != nullptr ? builder.CreateString(name) : 0;
  return v2::CreateMetadata(builder, name_offset, 0, 0, 0);
}

flatbuffers::Offset<v2::SemanticsRef> semantics_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* library,
    const char* block) {
  const auto library_offset = builder.CreateString(library);
  const auto block_offset = builder.CreateString(block);
  return v2::CreateSemanticsRef(builder, library_offset, block_offset, 0, 0);
}

flatbuffers::Offset<v2::Var> var_float_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    double value) {
  const auto name_offset = builder.CreateString(name);
  return v2::CreateVar(builder, name_offset, v2::VarType_Float, false, 0,
                       value, 0, 0);
}

flatbuffers::Offset<v2::Var> var_int_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    std::int64_t value) {
  const auto name_offset = builder.CreateString(name);
  return v2::CreateVar(builder, name_offset, v2::VarType_Int, false, value, 0.0,
                       0, 0);
}

flatbuffers::Offset<v2::Var> var_string_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const char* value) {
  const auto name_offset = builder.CreateString(name);
  const auto value_offset = builder.CreateString(value);
  return v2::CreateVar(builder, name_offset, v2::VarType_String, false, 0, 0.0,
                       value_offset, 0);
}

flatbuffers::Offset<v2::Var> var_dist_v2(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const v1::Distribution* distribution) {
  const auto name_offset = builder.CreateString(name);
  std::vector<double> params;
  if (distribution != nullptr && distribution->params() != nullptr) {
    for (flatbuffers::uoffset_t i = 0; i < distribution->params()->size();
         ++i) {
      params.push_back(distribution->params()->Get(i));
    }
  }
  const auto dist_offset = v2::CreateDistribution(
      builder, distribution != nullptr ? distribution->kind() : 0,
      builder.CreateVector(params));
  return v2::CreateVar(builder, name_offset, v2::VarType_Distribution, false,
                       0, 0.0, 0, dist_offset);
}

// ---------------------------------------------------------------------------
// v1 -> v2 (process path)
// ---------------------------------------------------------------------------

// One v1 resource AtomicModel -> v2 resource block Node.
flatbuffers::Offset<v2::Node> resource_to_v2(
    flatbuffers::FlatBufferBuilder& builder, const v1::AtomicModel* resource) {
  const char* name = nullptr;
  if (resource->metadata() != nullptr &&
      resource->metadata()->name() != nullptr) {
    name = resource->metadata()->name()->c_str();
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  if (resource->params() != nullptr) {
    for (const v1::Param* param : *resource->params()) {
      if (param->name() == nullptr) {
        continue;
      }
      const std::string param_name = param->name()->str();
      if (param_name == "capacity" &&
          param->value_type() == v1::ParamValue_IntValue) {
        params.push_back(var_int_v2(builder, "capacity",
                                    param->value_as_IntValue()->value()));
      } else if (param_name == "failure_rate" &&
                 param->value_type() == v1::ParamValue_FloatValue) {
        params.push_back(var_float_v2(builder, "failure_rate",
                                      param->value_as_FloatValue()->value()));
      } else if (param_name == "repair_rate" &&
                 param->value_type() == v1::ParamValue_FloatValue) {
        params.push_back(var_float_v2(builder, "repair_rate",
                                      param->value_as_FloatValue()->value()));
      }
    }
  }
  return v2::CreateNode(builder, meta_v2(builder, name),
                        builder.CreateVector(std::vector<
                            flatbuffers::Offset<v2::Var>>{}),
                        builder.CreateVector(params), 0,
                        semantics_v2(builder, "process", "resource"), 0, 0, 0,
                        0);
}

// One v1 ProcessNode -> v2 block Node (source / queue / service).
flatbuffers::Offset<v2::Node> stage_to_v2(
    flatbuffers::FlatBufferBuilder& builder, const v1::ProcessNode* node) {
  const char* name = node->name() != nullptr ? node->name()->c_str() : "";
  std::vector<flatbuffers::Offset<v2::Var>> params;
  const char* block = "block";
  switch (node->kind_type()) {
    case v1::ProcessNodeKind_SourceNode: {
      block = "source";
      const v1::SourceNode* source = node->kind_as_SourceNode();
      if (source != nullptr) {
        params.push_back(var_dist_v2(builder, "arrival", source->arrival()));
        if (source->max_arrivals() >= 0) {
          params.push_back(var_int_v2(builder, "max_arrivals",
                                      source->max_arrivals()));
        }
      }
      break;
    }
    case v1::ProcessNodeKind_QueueNode: {
      block = "queue";
      const v1::QueueNode* queue = node->kind_as_QueueNode();
      if (queue != nullptr) {
        params.push_back(
            var_int_v2(builder, "capacity", queue->capacity()));
      }
      break;
    }
    case v1::ProcessNodeKind_ServiceNode: {
      block = "service";
      const v1::ServiceNode* service = node->kind_as_ServiceNode();
      if (service != nullptr) {
        params.push_back(
            var_dist_v2(builder, "rate", service->service_time()));
        if (service->resource() != nullptr) {
          params.push_back(
              var_string_v2(builder, "resource", service->resource()->c_str()));
        }
        params.push_back(
            var_int_v2(builder, "servers", service->servers()));
      }
      break;
    }
    default:
      break;
  }
  return v2::CreateNode(builder, meta_v2(builder, name),
                        builder.CreateVector(std::vector<
                            flatbuffers::Offset<v2::Var>>{}),
                        builder.CreateVector(params), 0,
                        semantics_v2(builder, "process", block), 0, 0, 0, 0);
}

// v1 ProcessModel -> v2 flow Node (children blocks + couplings).
flatbuffers::Offset<v2::Node> process_to_v2(
    flatbuffers::FlatBufferBuilder& builder, const v1::ProcessModel* process) {
  const char* name = nullptr;
  if (process->metadata() != nullptr &&
      process->metadata()->name() != nullptr) {
    name = process->metadata()->name()->c_str();
  }
  std::vector<flatbuffers::Offset<v2::Node>> children;
  if (process->nodes() != nullptr) {
    for (const v1::ProcessNode* node : *process->nodes()) {
      children.push_back(stage_to_v2(builder, node));
    }
  }
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  if (process->couplings() != nullptr) {
    for (const v1::Coupling* coupling : *process->couplings()) {
      if (coupling->from_model() == nullptr ||
          coupling->from_port() == nullptr ||
          coupling->to_model() == nullptr ||
          coupling->to_port() == nullptr) {
        continue;
      }
      couplings.push_back(v2::CreateCoupling(
          builder, builder.CreateString(coupling->from_model()->str()),
          builder.CreateString(coupling->from_port()->str()),
          builder.CreateString(coupling->to_model()->str()),
          builder.CreateString(coupling->to_port()->str())));
    }
  }
  return v2::CreateNode(builder, meta_v2(builder, name),
                        builder.CreateVector(std::vector<
                            flatbuffers::Offset<v2::Var>>{}),
                        builder.CreateVector(std::vector<
                            flatbuffers::Offset<v2::Var>>{}),
                        0, semantics_v2(builder, "process", "flow"),
                        builder.CreateVector(children),
                        builder.CreateVector(couplings), 0, 0);
}

// ---------------------------------------------------------------------------
// v2 -> v1 (process path)
// ---------------------------------------------------------------------------

// v2 resource block Node -> v1 passive AtomicModel.
flatbuffers::Offset<v1::Model> resource_to_v1(
    flatbuffers::FlatBufferBuilder& builder, const v2::Node* node) {
  const char* name =
      node->metadata() != nullptr && node->metadata()->name() != nullptr
          ? node->metadata()->name()->c_str()
          : "<unnamed>";
  const auto metadata = meta_v1(builder, name, nullptr);
  const auto ta = v1::CreateTimeAdvance(builder, v1::TimeAdvanceKind_Infinite);
  std::vector<flatbuffers::Offset<v1::Param>> params;
  params.push_back(int_param_v1(
      builder, "capacity", node_int_param(node, "capacity", 1)));
  const double failure_rate = node_float_param(node, "failure_rate", 0.0);
  params.push_back(float_param_v1(builder, "failure_rate", failure_rate));
  if (node_has_float_param(node, "repair_rate")) {
    params.push_back(
        float_param_v1(builder, "repair_rate",
                       node_float_param(node, "repair_rate", 1.0)));
  }
  const auto atomic = v1::CreateAtomicModel(
      builder, metadata, 0, ta, 0, 0, 0, 0, builder.CreateVector(params));
  return v1::CreateModel(builder, v1::ModelKind_AtomicModel, atomic.Union());
}

// v2 flow block Node -> v1 ProcessModel.
flatbuffers::Offset<v1::Model> flow_to_v1(
    flatbuffers::FlatBufferBuilder& builder, const v2::Node* node) {
  const char* name =
      node->metadata() != nullptr && node->metadata()->name() != nullptr
          ? node->metadata()->name()->c_str()
          : "<flow>";
  const auto metadata = meta_v1(builder, name, nullptr);
  std::vector<flatbuffers::Offset<v1::ProcessNode>> nodes;
  if (node->children() != nullptr) {
    for (const v2::Node* child : *node->children()) {
      const char* block = nullptr;
      if (child->semantics() != nullptr &&
          child->semantics()->block() != nullptr) {
        block = child->semantics()->block()->c_str();
      }
      const auto child_name = builder.CreateString(
          child->metadata() != nullptr && child->metadata()->name() != nullptr
              ? child->metadata()->name()->c_str()
              : "");
      if (block != nullptr && std::strcmp(block, "source") == 0) {
        const v2::Distribution* arrival = node_dist_param(child, "arrival");
        const auto source = v1::CreateSourceNode(
            builder, dist_v1(builder, arrival),
            node_int_param(child, "max_arrivals", -1));
        nodes.push_back(v1::CreateProcessNode(
            builder, child_name, v1::ProcessNodeKind_SourceNode,
            source.Union()));
      } else if (block != nullptr && std::strcmp(block, "queue") == 0) {
        const auto queue = v1::CreateQueueNode(
            builder, node_int_param(child, "capacity", -1),
            v1::QueueDiscipline_Fifo);
        nodes.push_back(v1::CreateProcessNode(
            builder, child_name, v1::ProcessNodeKind_QueueNode,
            queue.Union()));
      } else if (block != nullptr && std::strcmp(block, "service") == 0) {
        const v2::Distribution* rate = node_dist_param(child, "rate");
        const char* resource = nullptr;
        if (child->params() != nullptr) {
          for (const v2::Var* var : *child->params()) {
            if (var->name() != nullptr &&
                var->name()->str() == "resource" &&
                var->type() == v2::VarType_String &&
                var->string_value() != nullptr) {
              resource = var->string_value()->c_str();
              break;
            }
          }
        }
        const auto resource_offset =
            resource != nullptr ? builder.CreateString(resource) : 0;
        const auto service = v1::CreateServiceNode(
            builder, dist_v1(builder, rate), resource_offset,
            node_int_param(child, "servers", 1));
        nodes.push_back(v1::CreateProcessNode(
            builder, child_name, v1::ProcessNodeKind_ServiceNode,
            service.Union()));
      } else {
        continue;  // sinks/delays: v1 keeps them as accepted no-ops
      }
    }
  }
  std::vector<flatbuffers::Offset<v1::Coupling>> couplings;
  if (node->couplings() != nullptr) {
    for (const v2::Coupling* coupling : *node->couplings()) {
      if (coupling->from_model() == nullptr ||
          coupling->from_port() == nullptr ||
          coupling->to_model() == nullptr ||
          coupling->to_port() == nullptr) {
        continue;
      }
      couplings.push_back(v1::CreateCoupling(
          builder, builder.CreateString(coupling->from_model()->str()),
          builder.CreateString(coupling->from_port()->str()),
          builder.CreateString(coupling->to_model()->str()),
          builder.CreateString(coupling->to_port()->str())));
    }
  }
  const auto process = v1::CreateProcessModel(
      builder, metadata, builder.CreateVector(nodes),
      builder.CreateVector(couplings));
  return v1::CreateModel(builder, v1::ModelKind_ProcessModel,
                         process.Union());
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

bool is_process_node(const v2::Node* node, const char* block) {
  return node != nullptr && node->semantics() != nullptr &&
         node->semantics()->block() != nullptr &&
         std::strcmp(node->semantics()->block()->c_str(), block) == 0;
}

}  // namespace

std::vector<std::uint8_t> convert_v2_to_v1(const std::uint8_t* data,
                                           std::size_t size,
                                           std::string* error) {
  flatbuffers::Verifier verifier(data, size);
  if (!v2::VerifyModelFileBuffer(verifier)) {
    return fail(error, "v2 verifier rejected the buffer");
  }
  const v2::ModelFile* file = v2::GetModelFile(data);
  if (file->schema_version() != 2) {
    return fail(error, "unexpected v2 schema_version");
  }
  const v2::Node* root = file->root();
  if (root == nullptr) {
    return fail(error, "v2 ModelFile has no root node");
  }
  if (root->semantics() == nullptr ||
      root->semantics()->library() == nullptr ||
      std::strcmp(root->semantics()->library()->c_str(), "process") != 0) {
    return fail(error,
                "v2 -> v1 converter supports the process library only (got '" +
                    std::string(root->semantics() != nullptr &&
                                        root->semantics()->library() != nullptr
                                    ? root->semantics()->library()->c_str()
                                    : "?") +
                    "')");
  }

  flatbuffers::FlatBufferBuilder builder;
  std::vector<flatbuffers::Offset<v1::Model>> children;
  const v2::Node* flow = nullptr;
  if (is_process_node(root, "model")) {
    if (root->children() != nullptr) {
      for (const v2::Node* child : *root->children()) {
        if (is_process_node(child, "resource")) {
          children.push_back(resource_to_v1(builder, child));
        } else if (is_process_node(child, "flow")) {
          flow = child;
        }
      }
    }
  } else if (is_process_node(root, "flow")) {
    flow = root;
  } else {
    return fail(error, "v2 root must be a process model or flow node");
  }
  if (flow == nullptr) {
    return fail(error, "v2 process model has no flow node");
  }
  children.push_back(flow_to_v1(builder, flow));

  const auto root_metadata = meta_v1(
      builder,
      root->metadata() != nullptr && root->metadata()->name() != nullptr
          ? root->metadata()->name()->c_str()
          : nullptr,
      nullptr);
  const auto coupled = v1::CreateCoupledModel(
      builder, root_metadata, builder.CreateVector(children));
  const auto root_model = v1::CreateModel(builder, v1::ModelKind_CoupledModel,
                                          coupled.Union());
  const auto file_metadata = meta_v1(
      builder,
      root->metadata() != nullptr && root->metadata()->name() != nullptr
          ? root->metadata()->name()->c_str()
          : nullptr,
      nullptr);
  const auto model_file =
      v1::CreateModelFile(builder, 1, root_model, 0, file_metadata);
  builder.Finish(model_file, "LPIR");
  return std::vector<std::uint8_t>(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());
}

std::vector<std::uint8_t> convert_v1_to_v2(const std::uint8_t* data,
                                           std::size_t size,
                                           std::string* error) {
  flatbuffers::Verifier verifier(data, size);
  if (!v1::VerifyModelFileBuffer(verifier)) {
    return fail(error, "v1 verifier rejected the buffer");
  }
  const v1::ModelFile* file = v1::GetModelFile(data);
  if (file->schema_version() != 1) {
    return fail(error, "unexpected v1 schema_version");
  }

  flatbuffers::FlatBufferBuilder builder;
  std::vector<flatbuffers::Offset<v2::Node>> children;
  const v1::Model* root = file->root();
  if (root == nullptr) {
    return fail(error, "v1 ModelFile has no root model");
  }

  // Bare ProcessModel root -> flow node (no resource children).
  if (root->kind_type() == v1::ModelKind_ProcessModel) {
    const auto flow = process_to_v2(builder, root->kind_as_ProcessModel());
    const auto file_metadata = meta_v2(
        builder,
        file->metadata() != nullptr && file->metadata()->name() != nullptr
            ? file->metadata()->name()->c_str()
            : nullptr);
    const auto model_file =
        v2::CreateModelFile(builder, 2, flow, 0, file_metadata);
    builder.Finish(model_file, "LP2R");
    return std::vector<std::uint8_t>(
        builder.GetBufferPointer(),
        builder.GetBufferPointer() + builder.GetSize());
  }

  if (root->kind_type() != v1::ModelKind_CoupledModel) {
    return fail(error,
                "v1 -> v2 converter supports process models only (got " +
                    std::string(
                        v1::EnumNameModelKind(root->kind_type())) + ")");
  }
  const v1::CoupledModel* coupled = root->kind_as_CoupledModel();
  if (coupled->children() != nullptr) {
    for (const v1::Model* child : *coupled->children()) {
      if (child->kind_type() == v1::ModelKind_AtomicModel) {
        children.push_back(resource_to_v2(builder, child->kind_as_AtomicModel()));
      } else if (child->kind_type() == v1::ModelKind_ProcessModel) {
        children.push_back(process_to_v2(builder, child->kind_as_ProcessModel()));
      } else {
        return fail(error,
                    "v1 -> v2 converter supports process models only");
      }
    }
  }
  const auto root_metadata = meta_v2(
      builder,
      coupled->metadata() != nullptr && coupled->metadata()->name() != nullptr
          ? coupled->metadata()->name()->c_str()
          : nullptr);
  const auto root_node = v2::CreateNode(
      builder, root_metadata,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      semantics_v2(builder, "process", "model"), builder.CreateVector(children),
      0, 0, 0);
  const auto file_metadata = meta_v2(
      builder,
      file->metadata() != nullptr && file->metadata()->name() != nullptr
          ? file->metadata()->name()->c_str()
          : nullptr);
  const auto model_file =
      v2::CreateModelFile(builder, 2, root_node, 0, file_metadata);
  builder.Finish(model_file, "LP2R");
  return std::vector<std::uint8_t>(
      builder.GetBufferPointer(),
      builder.GetBufferPointer() + builder.GetSize());
}

}  // namespace logicpilot

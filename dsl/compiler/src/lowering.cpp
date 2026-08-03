// IR lowering implementation (see lowering.h for the mapping contract).
#include "logicpilot/dsl/lowering.h"

#include <flatbuffers/flatbuffers.h>

#include <unordered_map>
#include <vector>

#include "ir_generated.h"

namespace logicpilot::dsl {
namespace {

flatbuffers::Offset<logicpilot::ir::Distribution> lower_distribution(
    flatbuffers::FlatBufferBuilder& builder, const Distribution& dist) {
  logicpilot::ir::DistributionKind kind =
      logicpilot::ir::DistributionKind_Constant;
  switch (dist.kind) {
    case DistKind::kPoisson:
      kind = logicpilot::ir::DistributionKind_Poisson;
      break;
    case DistKind::kExponential:
      kind = logicpilot::ir::DistributionKind_Exponential;
      break;
    case DistKind::kNormal:
      kind = logicpilot::ir::DistributionKind_Normal;
      break;
    case DistKind::kConstant:
      kind = logicpilot::ir::DistributionKind_Constant;
      break;
  }
  return logicpilot::ir::CreateDistribution(
      builder, kind, builder.CreateVector(dist.params));
}

flatbuffers::Offset<logicpilot::ir::SourceSpan> lower_span(
    flatbuffers::FlatBufferBuilder& builder, const Span& span) {
  return logicpilot::ir::CreateSourceSpan(builder, span.line, span.column,
                                          span.byte_offset, span.byte_length);
}

flatbuffers::Offset<logicpilot::ir::Metadata> lower_metadata(
    flatbuffers::FlatBufferBuilder& builder, const std::string& name,
    const std::string& source_file, const Span& span) {
  const auto name_offset = builder.CreateString(name);
  const auto file_offset = builder.CreateString(source_file);
  const auto span_offset = lower_span(builder, span);
  return logicpilot::ir::CreateMetadata(builder, name_offset, 0, file_offset,
                                        span_offset);
}

flatbuffers::Offset<logicpilot::ir::Param> make_int_param(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    std::int64_t value) {
  const auto name_offset = builder.CreateString(name);
  const auto value_offset =
      logicpilot::ir::CreateIntValue(builder, value).Union();
  return logicpilot::ir::CreateParam(
      builder, name_offset, logicpilot::ir::ParamValue_IntValue, value_offset);
}

flatbuffers::Offset<logicpilot::ir::Param> make_float_param(
    flatbuffers::FlatBufferBuilder& builder, const char* name, double value) {
  const auto name_offset = builder.CreateString(name);
  const auto value_offset =
      logicpilot::ir::CreateFloatValue(builder, value).Union();
  return logicpilot::ir::CreateParam(
      builder, name_offset, logicpilot::ir::ParamValue_FloatValue,
      value_offset);
}

// resource -> passive AtomicModel carrying the resource parameters.
flatbuffers::Offset<logicpilot::ir::Model> lower_resource(
    flatbuffers::FlatBufferBuilder& builder, const ResourceDecl& resource,
    const std::string& source_file) {
  const auto metadata = lower_metadata(builder, resource.name, source_file,
                                       resource.span);
  const auto ta = logicpilot::ir::CreateTimeAdvance(
      builder, logicpilot::ir::TimeAdvanceKind_Infinite);
  std::vector<flatbuffers::Offset<logicpilot::ir::Param>> params;
  params.push_back(
      make_int_param(builder, "capacity", resource.capacity));
  params.push_back(make_float_param(builder, "failure_rate",
                                    resource.failure_rate));
  const auto atomic = logicpilot::ir::CreateAtomicModel(
      builder, metadata, 0, ta, 0, 0, 0, 0, builder.CreateVector(params));
  return logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_AtomicModel, atomic.Union());
}

flatbuffers::Offset<logicpilot::ir::ProcessNode> lower_stage(
    flatbuffers::FlatBufferBuilder& builder, const StageDecl& stage,
    const std::unordered_map<std::string, const ResourceDecl*>& resources) {
  const auto name = builder.CreateString(stage.name);
  switch (stage.kind) {
    case StageDecl::Kind::kSource: {
      const auto arrival = lower_distribution(builder, stage.arrival);
      const auto node =
          logicpilot::ir::CreateSourceNode(builder, arrival, -1).Union();
      return logicpilot::ir::CreateProcessNode(
          builder, name, logicpilot::ir::ProcessNodeKind_SourceNode, node);
    }
    case StageDecl::Kind::kQueue: {
      const auto node =
          logicpilot::ir::CreateQueueNode(
              builder, stage.capacity, logicpilot::ir::QueueDiscipline_Fifo)
              .Union();
      return logicpilot::ir::CreateProcessNode(
          builder, name, logicpilot::ir::ProcessNodeKind_QueueNode, node);
    }
    case StageDecl::Kind::kService: {
      const auto service_time = lower_distribution(builder,
                                                   stage.service_time);
      const auto resource_name = builder.CreateString(stage.name);
      std::int64_t servers = 1;
      const auto it = resources.find(stage.name);
      if (it != resources.end()) {
        servers = it->second->capacity;
      }
      const auto node =
          logicpilot::ir::CreateServiceNode(builder, service_time,
                                            resource_name, servers)
              .Union();
      return logicpilot::ir::CreateProcessNode(
          builder, name, logicpilot::ir::ProcessNodeKind_ServiceNode, node);
    }
  }
  return {};
}

// process -> ProcessModel with declaration-order nodes + chain couplings.
flatbuffers::Offset<logicpilot::ir::Model> lower_process(
    flatbuffers::FlatBufferBuilder& builder, const ProcessDecl& process,
    const std::string& source_file,
    const std::unordered_map<std::string, const ResourceDecl*>& resources) {
  const auto metadata = lower_metadata(builder, process.name, source_file,
                                       process.span);

  std::vector<flatbuffers::Offset<logicpilot::ir::ProcessNode>> nodes;
  nodes.reserve(process.stages.size());
  for (const StageDecl& stage : process.stages) {
    nodes.push_back(lower_stage(builder, stage, resources));
  }

  // Chain couplings: stage_i.out -> stage_{i+1}.in (declaration order).
  const auto port_out = builder.CreateString("out");
  const auto port_in = builder.CreateString("in");
  std::vector<flatbuffers::Offset<logicpilot::ir::Coupling>> couplings;
  for (std::size_t i = 0; i + 1 < process.stages.size(); ++i) {
    const auto from = builder.CreateString(process.stages[i].name);
    const auto to = builder.CreateString(process.stages[i + 1].name);
    couplings.push_back(
        logicpilot::ir::CreateCoupling(builder, from, port_out, to, port_in));
  }

  const auto model = logicpilot::ir::CreateProcessModel(
      builder, metadata, builder.CreateVector(nodes),
      builder.CreateVector(couplings));
  return logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_ProcessModel, model.Union());
}

}  // namespace

LoweredIr lower_to_ir(const ModelAst& model, const std::string& source_file) {
  flatbuffers::FlatBufferBuilder builder;

  std::unordered_map<std::string, const ResourceDecl*> resources;
  for (const ResourceDecl& resource : model.resources) {
    resources.emplace(resource.name, &resource);
  }

  std::vector<flatbuffers::Offset<logicpilot::ir::Model>> children;
  for (const ResourceDecl& resource : model.resources) {
    children.push_back(lower_resource(builder, resource, source_file));
  }
  for (const ProcessDecl& process : model.processes) {
    children.push_back(
        lower_process(builder, process, source_file, resources));
  }

  const auto root_metadata = lower_metadata(builder, model.name, source_file,
                                            model.span);
  const auto coupled = logicpilot::ir::CreateCoupledModel(
      builder, root_metadata, builder.CreateVector(children));
  const auto root = logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_CoupledModel, coupled.Union());

  const auto file_metadata = lower_metadata(builder, model.name, source_file,
                                            model.span);
  const auto file = logicpilot::ir::CreateModelFile(builder, 1, root, 0,
                                                    file_metadata);
  builder.Finish(file, "LPIR");

  LoweredIr lowered;
  lowered.bytes.assign(builder.GetBufferPointer(),
                       builder.GetBufferPointer() + builder.GetSize());
  return lowered;
}

}  // namespace logicpilot::dsl

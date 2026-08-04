// IR lowering implementation (see lowering.h for the mapping contract).
#include "logicpilot/dsl/lowering.h"

#include <flatbuffers/flatbuffers.h>

#include <unordered_map>
#include <vector>

#include "ir_generated.h"
#include "ir_v2_generated.h"

namespace logicpilot::dsl {
namespace {

namespace v2 = logicpilot::ir::v2;

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

// atomic -> ir::AtomicModel (state params, ta, single external/internal
// transition with literal effects, ports from the transitions).
flatbuffers::Offset<logicpilot::ir::Model> lower_atomic(
    flatbuffers::FlatBufferBuilder& builder, const AtomicDecl& atomic,
    const std::string& source_file) {
  const auto metadata = lower_metadata(builder, atomic.name, source_file,
                                       atomic.span);

  std::vector<flatbuffers::Offset<logicpilot::ir::Param>> state;
  for (const StateVarDecl& var : atomic.state) {
    const auto name = builder.CreateString(var.name);
    switch (var.value.kind) {
      case AtomicValueKind::kBool: {
        const auto value = logicpilot::ir::CreateBoolValue(
                               builder, var.value.bool_value)
                               .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_BoolValue, value));
        break;
      }
      case AtomicValueKind::kInt: {
        const auto value =
            logicpilot::ir::CreateIntValue(builder, var.value.int_value)
                .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_IntValue, value));
        break;
      }
      case AtomicValueKind::kFloat: {
        const auto value =
            logicpilot::ir::CreateFloatValue(builder, var.value.float_value)
                .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_FloatValue, value));
        break;
      }
    }
  }

  flatbuffers::Offset<logicpilot::ir::TimeAdvance> ta;
  if (!atomic.ta.has) {
    // Absent time_advance = passive model (ta = infinity).
    ta = logicpilot::ir::CreateTimeAdvance(
        builder, logicpilot::ir::TimeAdvanceKind_Infinite);
  } else {
    switch (atomic.ta.kind) {
      case TaKind::kConstant:
        ta = logicpilot::ir::CreateTimeAdvance(
            builder, logicpilot::ir::TimeAdvanceKind_Constant,
            atomic.ta.value, 0, 0);
        break;
      case TaKind::kExponential: {
        const std::vector<double> params{atomic.ta.value};
        const auto dist = logicpilot::ir::CreateDistribution(
            builder, logicpilot::ir::DistributionKind_Exponential,
            builder.CreateVector(params));
        ta = logicpilot::ir::CreateTimeAdvance(
            builder, logicpilot::ir::TimeAdvanceKind_Distribution, 0.0, dist,
            0);
        break;
      }
      default:
        ta = logicpilot::ir::CreateTimeAdvance(
            builder, logicpilot::ir::TimeAdvanceKind_Infinite);
        break;
    }
  }

  const auto lower_effects =
      [&](const std::vector<Effect>& effects)
      -> flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<
          logicpilot::ir::Param>>> {
    std::vector<flatbuffers::Offset<logicpilot::ir::Param>> params;
    for (const Effect& effect : effects) {
      const auto name = builder.CreateString(effect.name);
      switch (effect.value.kind) {
        case AtomicValueKind::kBool: {
          const auto value = logicpilot::ir::CreateBoolValue(
                                 builder, effect.value.bool_value)
                                 .Union();
          params.push_back(logicpilot::ir::CreateParam(
              builder, name, logicpilot::ir::ParamValue_BoolValue, value));
          break;
        }
        case AtomicValueKind::kInt: {
          const auto value =
              logicpilot::ir::CreateIntValue(builder, effect.value.int_value)
                  .Union();
          params.push_back(logicpilot::ir::CreateParam(
              builder, name, logicpilot::ir::ParamValue_IntValue, value));
          break;
        }
        case AtomicValueKind::kFloat: {
          const auto value = logicpilot::ir::CreateFloatValue(
                                 builder, effect.value.float_value)
                                 .Union();
          params.push_back(logicpilot::ir::CreateParam(
              builder, name, logicpilot::ir::ParamValue_FloatValue, value));
          break;
        }
      }
    }
    return builder.CreateVector(params);
  };

  std::vector<flatbuffers::Offset<logicpilot::ir::Port>> input_ports;
  std::vector<flatbuffers::Offset<logicpilot::ir::Port>> output_ports;
  flatbuffers::Offset<logicpilot::ir::TransitionSpec> external = 0;
  flatbuffers::Offset<logicpilot::ir::TransitionSpec> internal = 0;

  if (atomic.on_input.size() == 1) {
    const TransitionDecl& t = atomic.on_input.front();
    const auto trigger = builder.CreateString(t.port);
    const auto description = builder.CreateString("on_input " + t.port);
    external = logicpilot::ir::CreateTransitionSpec(
        builder, description, trigger, 0, 0, lower_effects(t.effects));
    const auto port = builder.CreateString(t.port);
    input_ports.push_back(logicpilot::ir::CreatePort(
        builder, port, logicpilot::ir::PortDirection_Input, 0));
  }
  if (atomic.on_timeout.has) {
    const auto description = builder.CreateString("on_timeout");
    flatbuffers::Offset<flatbuffers::String> output = 0;
    if (atomic.on_timeout.emit) {
      output = builder.CreateString(atomic.on_timeout.emit_port);
      const auto port = builder.CreateString(atomic.on_timeout.emit_port);
      output_ports.push_back(logicpilot::ir::CreatePort(
          builder, port, logicpilot::ir::PortDirection_Output, 0));
    }
    internal = logicpilot::ir::CreateTransitionSpec(
        builder, description, 0, output, 0,
        lower_effects(atomic.on_timeout.effects));
  }

  const auto model = logicpilot::ir::CreateAtomicModel(
      builder, metadata, builder.CreateVector(state), ta, external, internal,
      builder.CreateVector(input_ports), builder.CreateVector(output_ports),
      0);
  return logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_AtomicModel, model.Union());
}

// agent -> ir::AgentModel (state params, on_tick behaviors with a built-in
// handler_ref + optional argument param, population count as a param).
flatbuffers::Offset<logicpilot::ir::Model> lower_agent(
    flatbuffers::FlatBufferBuilder& builder, const AgentDecl& agent,
    const std::string& source_file) {
  const auto metadata = lower_metadata(builder, agent.name, source_file,
                                       agent.span);

  std::vector<flatbuffers::Offset<logicpilot::ir::Param>> state;
  for (const StateVarDecl& var : agent.state) {
    const auto name = builder.CreateString(var.name);
    switch (var.value.kind) {
      case AtomicValueKind::kBool: {
        const auto value = logicpilot::ir::CreateBoolValue(
                               builder, var.value.bool_value)
                               .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_BoolValue, value));
        break;
      }
      case AtomicValueKind::kInt: {
        const auto value =
            logicpilot::ir::CreateIntValue(builder, var.value.int_value)
                .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_IntValue, value));
        break;
      }
      case AtomicValueKind::kFloat: {
        const auto value =
            logicpilot::ir::CreateFloatValue(builder, var.value.float_value)
                .Union();
        state.push_back(logicpilot::ir::CreateParam(
            builder, name, logicpilot::ir::ParamValue_FloatValue, value));
        break;
      }
    }
  }

  std::vector<flatbuffers::Offset<logicpilot::ir::Behavior>> behaviors;
  for (const TickBehavior& behavior : agent.behaviors) {
    const auto behavior_name =
        builder.CreateString("on_tick " + behavior.handler);
    const auto trigger = builder.CreateString("on_tick");
    const auto handler_ref = builder.CreateString(behavior.handler);
    std::vector<flatbuffers::Offset<logicpilot::ir::Param>> params;
    if (behavior.has_arg) {
      // The flip argument travels as a param whose *name* is the target
      // state variable (value is unused by the kernel handler).
      const auto arg = builder.CreateString(behavior.arg);
      const auto value =
          logicpilot::ir::CreateBoolValue(builder, true).Union();
      params.push_back(logicpilot::ir::CreateParam(
          builder, arg, logicpilot::ir::ParamValue_BoolValue, value));
    }
    behaviors.push_back(logicpilot::ir::CreateBehavior(
        builder, behavior_name, trigger, handler_ref,
        builder.CreateVector(params)));
  }

  // Population size rides as a model param (AgentModel.params, F1).
  const auto count_name = builder.CreateString("count");
  const auto count_value =
      logicpilot::ir::CreateIntValue(builder, agent.count).Union();
  std::vector<flatbuffers::Offset<logicpilot::ir::Param>> params;
  params.push_back(logicpilot::ir::CreateParam(
      builder, count_name, logicpilot::ir::ParamValue_IntValue, count_value));

  const auto model = logicpilot::ir::CreateAgentModel(
      builder, metadata, 0, builder.CreateVector(behaviors), 0,
      builder.CreateVector(state), builder.CreateVector(params));
  return logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_AgentModel, model.Union());
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

// continuous -> ir::EquationModel (variables = state with initial values,
// equations = rhs strings, params = named constants).
flatbuffers::Offset<logicpilot::ir::Model> lower_continuous_v1(
    flatbuffers::FlatBufferBuilder& builder, const EquationDecl& continuous,
    const std::string& source_file) {
  const auto metadata = lower_metadata(builder, continuous.name, source_file,
                                       continuous.span);
  std::vector<flatbuffers::Offset<logicpilot::ir::EquationVariable>> variables;
  const auto initial_value = [](const AtomicValue& value) {
    if (value.kind == AtomicValueKind::kFloat) {
      return value.float_value;
    }
    if (value.kind == AtomicValueKind::kInt) {
      return static_cast<double>(value.int_value);
    }
    return 0.0;
  };
  for (const StateVarDecl& var : continuous.state) {
    variables.push_back(logicpilot::ir::CreateEquationVariable(
        builder, builder.CreateString(var.name), initial_value(var.value), 0));
  }
  std::vector<flatbuffers::Offset<flatbuffers::String>> equations;
  for (const EquationDecl::Equation& equation : continuous.equations) {
    equations.push_back(builder.CreateString(equation.rhs_text));
  }
  std::vector<flatbuffers::Offset<logicpilot::ir::Param>> params;
  for (const EquationDecl::ParamDecl& param : continuous.params) {
    params.push_back(make_float_param(builder, param.name.c_str(), param.value));
  }
  const auto model = logicpilot::ir::CreateEquationModel(
      builder, metadata, builder.CreateVector(variables),
      builder.CreateVector(equations), builder.CreateVector(params));
  return logicpilot::ir::CreateModel(
      builder, logicpilot::ir::ModelKind_EquationModel, model.Union());
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
  for (const AtomicDecl& atomic : model.atomics) {
    children.push_back(lower_atomic(builder, atomic, source_file));
  }
  for (const AgentDecl& agent : model.agents) {
    children.push_back(lower_agent(builder, agent, source_file));
  }
  for (const EquationDecl& continuous : model.continuous) {
    children.push_back(
        lower_continuous_v1(builder, continuous, source_file));
  }

  // Root-level couplings from `couple` declarations (atomic wiring).
  std::vector<flatbuffers::Offset<logicpilot::ir::Coupling>> couplings;
  for (const CoupleDecl& couple : model.couplings) {
    const auto from_model = builder.CreateString(couple.from_model);
    const auto from_port = builder.CreateString(couple.from_port);
    const auto to_model = builder.CreateString(couple.to_model);
    const auto to_port = builder.CreateString(couple.to_port);
    couplings.push_back(logicpilot::ir::CreateCoupling(
        builder, from_model, from_port, to_model, to_port));
  }

  const auto root_metadata = lower_metadata(builder, model.name, source_file,
                                            model.span);
  const auto coupled = logicpilot::ir::CreateCoupledModel(
      builder, root_metadata, builder.CreateVector(children),
      builder.CreateVector(couplings));
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

// ---------------------------------------------------------------------------
// v2 lowering (thin Node / SemanticsRef contract, "LP2R")
// ---------------------------------------------------------------------------

namespace {

flatbuffers::Offset<v2::Metadata> v2_metadata(
    flatbuffers::FlatBufferBuilder& builder, const std::string& name,
    const std::string& source_file) {
  const auto name_offset = builder.CreateString(name);
  const auto file_offset = builder.CreateString(source_file);
  return v2::CreateMetadata(builder, name_offset, 0, file_offset, 0);
}

flatbuffers::Offset<v2::SemanticsRef> v2_semantics(
    flatbuffers::FlatBufferBuilder& builder, const char* library,
    const char* block) {
  return v2::CreateSemanticsRef(builder, builder.CreateString(library),
                                builder.CreateString(block), 0, 0);
}

// v2 Distribution.kind is a raw byte mirroring the v1 DistributionKind
// values (Constant=0, Uniform=1, Normal=2, Exponential=3, Poisson=4).
flatbuffers::Offset<v2::Distribution> v2_distribution(
    flatbuffers::FlatBufferBuilder& builder, const Distribution& dist) {
  std::uint8_t kind = 0;
  switch (dist.kind) {
    case DistKind::kPoisson: kind = 4; break;
    case DistKind::kExponential: kind = 3; break;
    case DistKind::kNormal: kind = 2; break;
    case DistKind::kConstant: kind = 0; break;
  }
  return v2::CreateDistribution(builder, kind,
                                builder.CreateVector(dist.params));
}

flatbuffers::Offset<v2::Var> v2_var_bool(
    flatbuffers::FlatBufferBuilder& builder, const char* name, bool value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Bool,
                       value, 0, 0.0, 0, 0);
}

flatbuffers::Offset<v2::Var> v2_var_int(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    std::int64_t value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Int,
                       false, value, 0.0, 0, 0);
}

flatbuffers::Offset<v2::Var> v2_var_float(
    flatbuffers::FlatBufferBuilder& builder, const char* name, double value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_Float,
                       false, 0, value, 0, 0);
}

flatbuffers::Offset<v2::Var> v2_var_string(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const std::string& value) {
  return v2::CreateVar(builder, builder.CreateString(name), v2::VarType_String,
                       false, 0, 0.0, builder.CreateString(value), 0);
}

flatbuffers::Offset<v2::Var> v2_var_distribution(
    flatbuffers::FlatBufferBuilder& builder, const char* name,
    const Distribution& dist) {
  return v2::CreateVar(builder, builder.CreateString(name),
                       v2::VarType_Distribution, false, 0, 0.0, 0,
                       v2_distribution(builder, dist));
}

flatbuffers::Offset<v2::Var> v2_var_from_value(
    flatbuffers::FlatBufferBuilder& builder, const std::string& name,
    const AtomicValue& value) {
  switch (value.kind) {
    case AtomicValueKind::kBool:
      return v2_var_bool(builder, name.c_str(), value.bool_value);
    case AtomicValueKind::kInt:
      return v2_var_int(builder, name.c_str(), value.int_value);
    case AtomicValueKind::kFloat:
      return v2_var_float(builder, name.c_str(), value.float_value);
  }
  return 0;
}

// resource -> process/resource block Node (typed capacity/failure_rate).
flatbuffers::Offset<v2::Node> v2_resource(
    flatbuffers::FlatBufferBuilder& builder, const ResourceDecl& resource,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  params.push_back(v2_var_int(builder, "capacity", resource.capacity));
  params.push_back(
      v2_var_float(builder, "failure_rate", resource.failure_rate));
  return v2::CreateNode(
      builder, v2_metadata(builder, resource.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2_semantics(builder, "process", "resource"), 0, 0, 0, 0, 0);
}

// process stage -> process source/queue/service block Node.
flatbuffers::Offset<v2::Node> v2_stage(
    flatbuffers::FlatBufferBuilder& builder, const StageDecl& stage,
    const std::unordered_map<std::string, const ResourceDecl*>& resources,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  const char* block = "block";
  switch (stage.kind) {
    case StageDecl::Kind::kSource:
      block = "source";
      params.push_back(v2_var_distribution(builder, "arrival",
                                           stage.arrival));
      break;
    case StageDecl::Kind::kQueue:
      block = "queue";
      params.push_back(v2_var_int(builder, "capacity", stage.capacity));
      break;
    case StageDecl::Kind::kService: {
      block = "service";
      params.push_back(v2_var_distribution(builder, "rate",
                                           stage.service_time));
      params.push_back(v2_var_string(builder, "resource", stage.name));
      std::int64_t servers = 1;
      const auto it = resources.find(stage.name);
      if (it != resources.end()) {
        servers = it->second->capacity;
      }
      params.push_back(v2_var_int(builder, "servers", servers));
      break;
    }
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, stage.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0, v2_semantics(builder, "process", block),
      0, 0, 0, 0, 0);
}

// process -> process/flow Node (block children + chain couplings).
flatbuffers::Offset<v2::Node> v2_process(
    flatbuffers::FlatBufferBuilder& builder, const ProcessDecl& process,
    const std::unordered_map<std::string, const ResourceDecl*>& resources,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Node>> children;
  for (const StageDecl& stage : process.stages) {
    children.push_back(v2_stage(builder, stage, resources, source_file));
  }
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  for (std::size_t i = 0; i + 1 < process.stages.size(); ++i) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(process.stages[i].name),
        builder.CreateString("out"),
        builder.CreateString(process.stages[i + 1].name),
        builder.CreateString("in")));
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, process.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2_semantics(builder, "process", "flow"),
      builder.CreateVector(children), builder.CreateVector(couplings), 0, 0,
      0);
}

// atomic -> devs/atomic Node with a one-state Statechart.
flatbuffers::Offset<v2::Node> v2_atomic(
    flatbuffers::FlatBufferBuilder& builder, const AtomicDecl& atomic,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const StateVarDecl& var : atomic.state) {
    state.push_back(v2_var_from_value(builder, var.name, var.value));
  }
  std::vector<flatbuffers::Offset<v2::Port>> ports;
  if (!atomic.on_input.empty()) {
    ports.push_back(v2::CreatePort(
        builder, builder.CreateString(atomic.on_input.front().port),
        v2::PortDirection_Input, 0));
  }
  if (atomic.on_timeout.emit) {
    ports.push_back(v2::CreatePort(
        builder, builder.CreateString(atomic.on_timeout.emit_port),
        v2::PortDirection_Output, 0));
  }
  const auto active = builder.CreateString("active");
  std::vector<flatbuffers::Offset<v2::State>> states;
  states.push_back(v2::CreateState(builder, active));
  std::vector<flatbuffers::Offset<v2::Transition>> transitions;
  const auto effects_to_actions =
      [&](const std::vector<Effect>& effects)
      -> std::vector<flatbuffers::Offset<v2::Action>> {
    std::vector<flatbuffers::Offset<v2::Action>> actions;
    for (const Effect& effect : effects) {
      actions.push_back(v2::CreateAction(
          builder, 0,
          v2_var_from_value(builder, effect.name, effect.value), 0));
    }
    return actions;
  };
  if (!atomic.on_input.empty()) {
    const TransitionDecl& t = atomic.on_input.front();
    transitions.push_back(v2::CreateTransition(
        builder, active, active, v2::TriggerKind_Message, 0.0, 0, 0.0,
        builder.CreateString(t.port), 0,
        builder.CreateVector(effects_to_actions(t.effects))));
  }
  if (atomic.on_timeout.has) {
    std::vector<flatbuffers::Offset<v2::Action>> actions =
        effects_to_actions(atomic.on_timeout.effects);
    if (atomic.on_timeout.emit) {
      actions.push_back(v2::CreateAction(
          builder, 0, 0, builder.CreateString(atomic.on_timeout.emit_port)));
    }
    double timeout_value = 0.0;
    flatbuffers::Offset<v2::Distribution> timeout_distribution = 0;
    if (atomic.ta.has) {
      if (atomic.ta.kind == TaKind::kConstant) {
        timeout_value = atomic.ta.value;
      } else if (atomic.ta.kind == TaKind::kExponential) {
        const std::vector<double> params{atomic.ta.value};
        timeout_distribution = v2::CreateDistribution(
            builder, 3, builder.CreateVector(params));
      }
    }
    transitions.push_back(v2::CreateTransition(
        builder, active, active, v2::TriggerKind_Timeout, timeout_value,
        timeout_distribution, 0.0, 0, 0,
        builder.CreateVector(actions)));
  }
  const auto statechart =
      v2::CreateStatechart(builder, builder.CreateVector(states),
                           builder.CreateVector(transitions), active);
  return v2::CreateNode(
      builder, v2_metadata(builder, atomic.name, source_file),
      builder.CreateVector(state),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(ports), v2_semantics(builder, "devs", "atomic"), 0,
      0, statechart, 0, 0);
}

// agent -> agent Node (typed state, count param, behavior bindings).
flatbuffers::Offset<v2::Node> v2_agent(
    flatbuffers::FlatBufferBuilder& builder, const AgentDecl& agent,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const StateVarDecl& var : agent.state) {
    state.push_back(v2_var_from_value(builder, var.name, var.value));
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  params.push_back(v2_var_int(builder, "count", agent.count));
  std::vector<flatbuffers::Offset<v2::BehaviorBinding>> behaviors;
  for (const TickBehavior& behavior : agent.behaviors) {
    std::vector<flatbuffers::Offset<v2::Var>> behavior_params;
    if (behavior.has_arg) {
      behavior_params.push_back(v2_var_bool(builder, behavior.arg.c_str(),
                                            true));
    }
    behaviors.push_back(v2::CreateBehaviorBinding(
        builder, builder.CreateString("on_tick"),
        builder.CreateString(behavior.handler),
        builder.CreateVector(behavior_params)));
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, agent.name, source_file),
      builder.CreateVector(state), builder.CreateVector(params), 0,
      v2_semantics(builder, "agent", "agent"), 0, 0, 0,
      builder.CreateVector(behaviors), 0);
}

// continuous -> {sd, equation} Node: typed state (initial), params, and
// structured continuous equations.
flatbuffers::Offset<v2::Node> v2_continuous(
    flatbuffers::FlatBufferBuilder& builder, const EquationDecl& continuous,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  const auto initial_value = [](const AtomicValue& value) {
    if (value.kind == AtomicValueKind::kFloat) {
      return value.float_value;
    }
    if (value.kind == AtomicValueKind::kInt) {
      return static_cast<double>(value.int_value);
    }
    return 0.0;
  };
  for (const StateVarDecl& var : continuous.state) {
    state.push_back(v2_var_float(builder, var.name.c_str(),
                                 initial_value(var.value)));
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  for (const EquationDecl::ParamDecl& param : continuous.params) {
    params.push_back(v2_var_float(builder, param.name.c_str(), param.value));
  }
  std::vector<flatbuffers::Offset<v2::Equation>> equations;
  const auto state_initial = [&](const std::string& name) {
    for (const StateVarDecl& var : continuous.state) {
      if (var.name == name) {
        return initial_value(var.value);
      }
    }
    return 0.0;
  };
  for (const EquationDecl::Equation& equation : continuous.equations) {
    equations.push_back(v2::CreateEquation(
        builder, builder.CreateString(equation.var),
        builder.CreateString(equation.rhs_text),
        state_initial(equation.var)));
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, continuous.name, source_file),
      builder.CreateVector(state), builder.CreateVector(params), 0,
      v2_semantics(builder, "sd", "equation"), 0, 0, 0, 0,
      builder.CreateVector(equations));
}

flatbuffers::Offset<v2::Experiment> v2_experiment(
    flatbuffers::FlatBufferBuilder& builder, const ExperimentDecl& experiment) {
  return v2::CreateExperiment(
      builder, v2::ExperimentKind_Optimization,
      builder.CreateString(experiment.name),
      builder.CreateString(experiment.variable),
      builder.CreateString(experiment.objective),
      builder.CreateString(experiment.metric), experiment.range_min,
      experiment.range_max, static_cast<std::uint32_t>(experiment.budget), 0,
      0);
}

}  // namespace

LoweredIr lower_to_ir_v2(const ModelAst& model,
                         const std::string& source_file) {
  flatbuffers::FlatBufferBuilder builder;

  std::unordered_map<std::string, const ResourceDecl*> resources;
  for (const ResourceDecl& resource : model.resources) {
    resources.emplace(resource.name, &resource);
  }

  std::vector<flatbuffers::Offset<v2::Node>> children;
  for (const ResourceDecl& resource : model.resources) {
    children.push_back(v2_resource(builder, resource, source_file));
  }
  for (const ProcessDecl& process : model.processes) {
    children.push_back(
        v2_process(builder, process, resources, source_file));
  }
  for (const AtomicDecl& atomic : model.atomics) {
    children.push_back(v2_atomic(builder, atomic, source_file));
  }
  for (const AgentDecl& agent : model.agents) {
    children.push_back(v2_agent(builder, agent, source_file));
  }
  for (const EquationDecl& continuous : model.continuous) {
    children.push_back(v2_continuous(builder, continuous, source_file));
  }

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  for (const CoupleDecl& couple : model.couplings) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(couple.from_model),
        builder.CreateString(couple.from_port),
        builder.CreateString(couple.to_model),
        builder.CreateString(couple.to_port)));
  }

  const auto root_metadata =
      v2_metadata(builder, model.name, source_file);
  const auto root = v2::CreateNode(
      builder, root_metadata,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}), 0,
      v2_semantics(builder, "core", "model"), builder.CreateVector(children),
      builder.CreateVector(couplings), 0, 0, 0);

  std::vector<flatbuffers::Offset<v2::Experiment>> experiments;
  for (const ExperimentDecl& experiment : model.experiments) {
    experiments.push_back(v2_experiment(builder, experiment));
  }

  const auto file_metadata =
      v2_metadata(builder, model.name, source_file);
  const auto file = v2::CreateModelFile(builder, 2, root,
                                        builder.CreateVector(experiments),
                                        file_metadata);
  builder.Finish(file, "LP2R");

  LoweredIr lowered;
  lowered.bytes.assign(builder.GetBufferPointer(),
                       builder.GetBufferPointer() + builder.GetSize());
  return lowered;
}

}  // namespace logicpilot::dsl

// IR lowering implementation (see lowering.h for the mapping contract).
#include "logicpilot/dsl/lowering.h"

#include <flatbuffers/flatbuffers.h>

#include <unordered_map>
#include <vector>

#include "ir_v2_generated.h"

namespace logicpilot::dsl {

// ---------------------------------------------------------------------------
// v2 lowering (thin Node / SemanticsRef contract, "LP2R")
// ---------------------------------------------------------------------------

namespace {

namespace v2 = logicpilot::ir::v2;

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

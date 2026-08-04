// IR lowering implementation (see lowering.h for the mapping contract).
//
// Generic kind dispatch: every DSL Node lowers 1:1 to an IR v2 Node with a
// SemanticsRef{library, block}; process library blocks become
// {process, <block>} nodes with typed params, method containers become
// {devs,atomic} / {agent,agent} / {sd,equation} / {process,flow}.
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
    const Value& value) {
  switch (value.kind) {
    case ValueKind::kBool:
      return v2_var_bool(builder, name.c_str(), value.bool_value);
    case ValueKind::kInt:
      return v2_var_int(builder, name.c_str(), value.int_value);
    case ValueKind::kFloat:
      return v2_var_float(builder, name.c_str(), value.float_value);
    case ValueKind::kString:
    case ValueKind::kIdentifier:
      return v2_var_string(builder, name.c_str(), value.string_value);
    case ValueKind::kCall:
      break;  // call values are not state variable initializers
  }
  return v2_var_float(builder, name.c_str(), 0.0);
}

const Field* field_of(const Node& node, const char* name) {
  for (const Field& field : node.fields) {
    if (field.name == name) {
      return &field;
    }
  }
  return nullptr;
}

// ---------------------------------------------------------------------------
// Process library blocks
// ---------------------------------------------------------------------------

// resource -> process/resource block Node (typed capacity/failure_rate).
flatbuffers::Offset<v2::Node> v2_resource(
    flatbuffers::FlatBufferBuilder& builder, const Node& resource,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  const Field* capacity = field_of(resource, "capacity");
  params.push_back(v2_var_int(
      builder, "capacity",
      capacity && capacity->value.kind == ValueKind::kInt
          ? capacity->value.int_value
          : 0));
  const Field* failure_rate = field_of(resource, "failure_rate");
  params.push_back(v2_var_float(
      builder, "failure_rate",
      failure_rate && failure_rate->value.kind == ValueKind::kFloat
          ? failure_rate->value.float_value
          : 0.0));
  return v2::CreateNode(
      builder, v2_metadata(builder, resource.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2_semantics(builder, "process", "resource"), 0, 0, 0, 0, 0);
}

// process stage -> process source/queue/service/sink block Node.
flatbuffers::Offset<v2::Node> v2_process_block(
    flatbuffers::FlatBufferBuilder& builder, const Node& stage,
    const std::unordered_map<std::string, const Node*>& resources,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  if (stage.kind == "source") {
    Distribution arrival;
    const Field* field = field_of(stage, "arrival");
    if (field != nullptr) {
      (void)distribution_from_value(field->value, arrival);
    }
    params.push_back(v2_var_distribution(builder, "arrival", arrival));
  } else if (stage.kind == "queue") {
    const Field* field = field_of(stage, "capacity");
    params.push_back(v2_var_int(
        builder, "capacity",
        field && field->value.kind == ValueKind::kInt ? field->value.int_value
                                                      : 0));
  } else if (stage.kind == "service") {
    Distribution service_time;
    const Field* field = field_of(stage, "time");
    if (field != nullptr) {
      (void)distribution_from_value(field->value, service_time);
    }
    params.push_back(v2_var_distribution(builder, "rate", service_time));
    params.push_back(v2_var_string(builder, "resource", stage.name));
    std::int64_t servers = 1;
    const auto it = resources.find(stage.name);
    if (it != resources.end()) {
      const Field* capacity = field_of(*it->second, "capacity");
      if (capacity && capacity->value.kind == ValueKind::kInt) {
        servers = capacity->value.int_value;
      }
    }
    params.push_back(v2_var_int(builder, "servers", servers));
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, stage.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2_semantics(builder, "process", stage.kind.c_str()), 0, 0, 0, 0, 0);
}

// process -> process/flow Node (block children + chain couplings).
flatbuffers::Offset<v2::Node> v2_process(
    flatbuffers::FlatBufferBuilder& builder, const Node& process,
    const std::unordered_map<std::string, const Node*>& resources,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Node>> children;
  for (const Node& stage : process.children) {
    children.push_back(
        v2_process_block(builder, stage, resources, source_file));
  }
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  for (std::size_t i = 0; i + 1 < process.children.size(); ++i) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(process.children[i].name),
        builder.CreateString("out"),
        builder.CreateString(process.children[i + 1].name),
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

// ---------------------------------------------------------------------------
// Method containers
// ---------------------------------------------------------------------------

// atomic -> devs/atomic Node with a one-state Statechart.
flatbuffers::Offset<v2::Node> v2_atomic(
    flatbuffers::FlatBufferBuilder& builder, const Node& atomic,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const VarDecl& var : atomic.vars) {
    if (var.keyword == "state") {
      state.push_back(v2_var_from_value(builder, var.name, var.value));
    }
  }
  std::vector<flatbuffers::Offset<v2::Port>> ports;
  for (const PortDecl& port : atomic.ports) {
    const auto direction = port.direction == "in"
                               ? v2::PortDirection_Input
                               : (port.direction == "out"
                                      ? v2::PortDirection_Output
                                      : v2::PortDirection_InOut);
    ports.push_back(v2::CreatePort(
        builder, builder.CreateString(port.name.empty() ? "entity"
                                                        : port.name),
        direction, 0));
  }
  const Behavior* on_input = nullptr;
  const Behavior* on_timeout = nullptr;
  for (const Behavior& behavior : atomic.behaviors) {
    if (behavior.trigger == "input" && on_input == nullptr) {
      on_input = &behavior;
    } else if (behavior.trigger == "timeout" && on_timeout == nullptr) {
      on_timeout = &behavior;
    }
  }
  if (on_input != nullptr) {
    ports.push_back(v2::CreatePort(
        builder, builder.CreateString(on_input->port),
        v2::PortDirection_Input, 0));
  }
  if (on_timeout != nullptr) {
    for (const Effect& effect : on_timeout->effects) {
      if (effect.kind == Effect::Kind::kEmit) {
        ports.push_back(v2::CreatePort(
            builder, builder.CreateString(effect.name),
            v2::PortDirection_Output, 0));
      }
    }
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
      if (effect.kind == Effect::Kind::kAssign) {
        actions.push_back(v2::CreateAction(
            builder, 0, v2_var_from_value(builder, effect.name, effect.value),
            0));
      } else if (effect.kind == Effect::Kind::kEmit) {
        actions.push_back(
            v2::CreateAction(builder, 0, 0,
                             builder.CreateString(effect.name)));
      }
    }
    return actions;
  };
  if (on_input != nullptr) {
    transitions.push_back(v2::CreateTransition(
        builder, active, active, v2::TriggerKind_Message, 0.0, 0, 0.0,
        builder.CreateString(on_input->port), 0,
        builder.CreateVector(effects_to_actions(on_input->effects))));
  }
  if (on_timeout != nullptr) {
    std::vector<flatbuffers::Offset<v2::Action>> actions =
        effects_to_actions(on_timeout->effects);
    double timeout_value = 0.0;
    flatbuffers::Offset<v2::Distribution> timeout_distribution = 0;
    const Field* ta = field_of(atomic, "time_advance");
    if (ta != nullptr) {
      const Value& value = ta->value;
      if (value.kind == ValueKind::kCall &&
          value.call_name == "exponential" && value.call_args.size() == 1) {
        const std::vector<double> params{value.call_args[0]};
        timeout_distribution = v2::CreateDistribution(
            builder, 3, builder.CreateVector(params));
      } else if (value.kind == ValueKind::kInt) {
        timeout_value = static_cast<double>(value.int_value);
      } else if (value.kind == ValueKind::kFloat) {
        timeout_value = value.float_value;
      } else if (value.kind == ValueKind::kCall &&
                 value.call_name == "constant" &&
                 value.call_args.size() == 1) {
        timeout_value = value.call_args[0];
      }
      // identifier `infinite` keeps the default 0.0 (kernel: no timeout).
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
    flatbuffers::FlatBufferBuilder& builder, const Node& agent,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const VarDecl& var : agent.vars) {
    if (var.keyword == "state") {
      state.push_back(v2_var_from_value(builder, var.name, var.value));
    }
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  const Field* count = field_of(agent, "count");
  params.push_back(v2_var_int(
      builder, "count",
      count && count->value.kind == ValueKind::kInt ? count->value.int_value
                                                    : 1));
  std::vector<flatbuffers::Offset<v2::BehaviorBinding>> behaviors;
  for (const Behavior& behavior : agent.behaviors) {
    if (behavior.trigger != "tick") {
      continue;
    }
    for (const Effect& effect : behavior.effects) {
      if (effect.kind != Effect::Kind::kCall) {
        continue;
      }
      std::vector<flatbuffers::Offset<v2::Var>> behavior_params;
      if (!effect.arg.empty()) {
        behavior_params.push_back(v2_var_bool(builder, effect.arg.c_str(),
                                              true));
      }
      behaviors.push_back(v2::CreateBehaviorBinding(
          builder, builder.CreateString("on_tick"),
          builder.CreateString(effect.name),
          builder.CreateVector(behavior_params)));
    }
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
    flatbuffers::FlatBufferBuilder& builder, const Node& continuous,
    const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  const auto initial_value = [](const Value& value) {
    if (value.kind == ValueKind::kFloat) {
      return value.float_value;
    }
    if (value.kind == ValueKind::kInt) {
      return static_cast<double>(value.int_value);
    }
    return 0.0;
  };
  for (const VarDecl& var : continuous.vars) {
    if (var.keyword == "state") {
      state.push_back(
          v2_var_float(builder, var.name.c_str(), initial_value(var.value)));
    }
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  for (const VarDecl& var : continuous.vars) {
    if (var.keyword == "param") {
      params.push_back(
          v2_var_float(builder, var.name.c_str(), initial_value(var.value)));
    }
  }
  std::vector<flatbuffers::Offset<v2::Equation>> equations;
  const auto state_initial = [&](const std::string& name) {
    for (const VarDecl& var : continuous.vars) {
      if (var.keyword == "state" && var.name == name) {
        return initial_value(var.value);
      }
    }
    return 0.0;
  };
  for (const Equation& equation : continuous.equations) {
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

// One generic DSL Node -> IR v2 Node by kind (process blocks / containers).
flatbuffers::Offset<v2::Node> v2_node(
    flatbuffers::FlatBufferBuilder& builder, const Node& node,
    const std::unordered_map<std::string, const Node*>& resources,
    const std::string& source_file) {
  if (node.kind == "resource") {
    return v2_resource(builder, node, source_file);
  }
  if (node.kind == "process") {
    return v2_process(builder, node, resources, source_file);
  }
  if (node.kind == "atomic") {
    return v2_atomic(builder, node, source_file);
  }
  if (node.kind == "agent") {
    return v2_agent(builder, node, source_file);
  }
  if (node.kind == "continuous") {
    return v2_continuous(builder, node, source_file);
  }
  // Process blocks declared outside a process (e.g. top-level resource
  // instances) lower as standalone {process, <block>} nodes; experiment
  // members are handled via ModelFile.experiments, not the node tree.
  if (node.kind == "source" || node.kind == "queue" ||
      node.kind == "service" || node.kind == "sink") {
    return v2_process_block(builder, node, resources, source_file);
  }
  return 0;
}

}  // namespace

LoweredIr lower_to_ir_v2(const ModelAst& model,
                         const std::string& source_file) {
  flatbuffers::FlatBufferBuilder builder;

  std::unordered_map<std::string, const Node*> resources;
  for (const Node& member : model.members) {
    if (member.kind == "resource") {
      resources.emplace(member.name, &member);
    }
  }

  std::vector<flatbuffers::Offset<v2::Node>> children;
  for (const Node& member : model.members) {
    if (member.kind == "experiment") {
      continue;  // experiments live in ModelFile.experiments
    }
    children.push_back(v2_node(builder, member, resources, source_file));
  }

  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  for (const CoupleDecl& couple : model.couplings) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(couple.from_model),
        builder.CreateString(couple.from_port),
        builder.CreateString(couple.to_model),
        builder.CreateString(couple.to_port)));
  }

  std::vector<flatbuffers::Offset<v2::Var>> root_params;
  for (const VarDecl& param : model.params) {
    root_params.push_back(v2_var_from_value(builder, param.name,
                                            param.value));
  }

  const auto root_metadata =
      v2_metadata(builder, model.name, source_file);
  const auto root = v2::CreateNode(
      builder, root_metadata,
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(root_params), 0,
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

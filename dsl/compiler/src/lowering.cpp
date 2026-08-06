// IR lowering implementation (see lowering.h for the mapping contract).
//
// Generic kind dispatch: every DSL Node lowers 1:1 to an IR v2 Node with a
// SemanticsRef{library, block}; process library blocks become
// {process, <block>} nodes with typed params, method containers become
// {devs,atomic} / {agent,agent} / {sd,equation}. The legacy {process, flow}
// container was removed. Numeric fields are constant-folded (Phase D):
// expressions reduce to literals via parameter references and arithmetic
// before they reach the IR.
#include "logicpilot/dsl/lowering.h"

#include "logicpilot/dsl/registry.h"

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

// Forward declaration: generic kind dispatch used for nested members.
flatbuffers::Offset<v2::Node> v2_node(
    flatbuffers::FlatBufferBuilder& builder, const Node& node,
    const std::unordered_map<std::string, const Node*>& resources,
    const ParamScope& scope, const std::string& source_file,
    const LibraryRegistry& registry);

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

// Folded scalar -> Var (state initializers, effect assignments).
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
    default:
      break;  // non-constant expressions are rejected by the analyzer
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
// Constant folding helpers (Phase D)
// ---------------------------------------------------------------------------

// Fold an expression, falling back to the raw value when it is not constant
// (the analyzer rejects non-constant fields, so this is defensive).
Value fold_or_raw(const Value& value, const ParamScope& scope) {
  Value out;
  return fold_value(value, scope, out) ? out : value;
}

std::int64_t int_field(const Node& node, const char* name,
                       const ParamScope& scope, std::int64_t fallback) {
  const Field* field = field_of(node, name);
  if (field == nullptr) {
    return fallback;
  }
  const Value folded = fold_or_raw(field->value, scope);
  if (folded.kind == ValueKind::kInt) {
    return folded.int_value;
  }
  if (folded.kind == ValueKind::kFloat) {
    return static_cast<std::int64_t>(folded.float_value);
  }
  return fallback;
}

double float_field(const Node& node, const char* name,
                   const ParamScope& scope, double fallback) {
  const Field* field = field_of(node, name);
  if (field == nullptr) {
    return fallback;
  }
  const Value folded = fold_or_raw(field->value, scope);
  if (folded.kind == ValueKind::kInt) {
    return static_cast<double>(folded.int_value);
  }
  if (folded.kind == ValueKind::kFloat) {
    return folded.float_value;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Process library blocks
// ---------------------------------------------------------------------------

// resource -> process/resource block Node (typed capacity/failure_rate).
flatbuffers::Offset<v2::Node> v2_resource(
    flatbuffers::FlatBufferBuilder& builder, const Node& resource,
    const ParamScope& scope, const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  params.push_back(v2_var_int(
      builder, "capacity", int_field(resource, "capacity", scope, 0)));
  params.push_back(v2_var_float(
      builder, "failure_rate",
      float_field(resource, "failure_rate", scope, 0.0)));
  return v2::CreateNode(
      builder, v2_metadata(builder, resource.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), 0,
      v2_semantics(builder, "process", "resource"), 0, 0, 0, 0, 0);
}

// process stage -> process block Node: typed params from every written
// field (typed by its value kind) plus the block's registered ports.
flatbuffers::Offset<v2::Node> v2_process_block(
    flatbuffers::FlatBufferBuilder& builder, const Node& stage,
    const std::unordered_map<std::string, const Node*>& resources,
    const ParamScope& scope, const std::string& source_file,
    const LibraryRegistry& registry) {
  std::vector<flatbuffers::Offset<v2::Var>> params;
  for (const Field& field : stage.fields) {
    const Value folded = fold_or_raw(field.value, scope);
    Distribution dist;
    if (distribution_from_value(folded, dist)) {
      params.push_back(v2_var_distribution(builder, field.name.c_str(), dist));
      continue;
    }
    switch (folded.kind) {
      case ValueKind::kBool:
        params.push_back(
            v2_var_bool(builder, field.name.c_str(), folded.bool_value));
        break;
      case ValueKind::kInt:
        params.push_back(
            v2_var_int(builder, field.name.c_str(), folded.int_value));
        break;
      case ValueKind::kFloat:
        params.push_back(
            v2_var_float(builder, field.name.c_str(), folded.float_value));
        break;
      case ValueKind::kString:
      case ValueKind::kIdentifier:
        params.push_back(
            v2_var_string(builder, field.name.c_str(), folded.string_value));
        break;
      default:
        // Non-constant values are rejected by the analyzer; never lower.
        break;
    }
  }
  (void)resources;
  // Registered block ports (direction + event type), so the IR carries the
  // full connectable shape of every process stage.
  std::vector<flatbuffers::Offset<v2::Port>> ports;
  const BlockShape* shape = registry.resolve(stage.kind);
  const std::string effective_kind =
      shape != nullptr ? shape->kind : stage.kind;
  if (shape != nullptr) {
    for (const BlockPortSpec& spec : shape->ports) {
      const auto direction =
          spec.direction == "in"
              ? v2::PortDirection_Input
              : (spec.direction == "out" ? v2::PortDirection_Output
                                         : v2::PortDirection_InOut);
      ports.push_back(v2::CreatePort(
          builder, builder.CreateString(spec.name), direction,
          builder.CreateString(spec.type.empty() ? "entity" : spec.type)));
    }
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, stage.name, source_file),
      builder.CreateVector(std::vector<flatbuffers::Offset<v2::Var>>{}),
      builder.CreateVector(params), builder.CreateVector(ports),
      v2_semantics(builder, "process", effective_kind.c_str()),
      0, 0, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// Method containers
// ---------------------------------------------------------------------------

// atomic -> devs/atomic Node with a one-state Statechart.
flatbuffers::Offset<v2::Node> v2_atomic(
    flatbuffers::FlatBufferBuilder& builder, const Node& atomic,
    const ParamScope& scope, const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const VarDecl& var : atomic.vars) {
    if (var.keyword == "state") {
      state.push_back(v2_var_from_value(
          builder, var.name, fold_or_raw(var.value, scope)));
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
            builder, 0,
            v2_var_from_value(builder, effect.name,
                              fold_or_raw(effect.value, scope)),
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
      const Value folded = fold_or_raw(ta->value, scope);
      if (folded.kind == ValueKind::kCall &&
          folded.call_name == "exponential" && folded.call_args.size() == 1) {
        const Value& rate = folded.call_args[0];
        if (rate.kind == ValueKind::kInt || rate.kind == ValueKind::kFloat) {
          const std::vector<double> params{
              rate.kind == ValueKind::kInt
                  ? static_cast<double>(rate.int_value)
                  : rate.float_value};
          timeout_distribution = v2::CreateDistribution(
              builder, 3, builder.CreateVector(params));
        }
      } else if (folded.kind == ValueKind::kInt) {
        timeout_value = static_cast<double>(folded.int_value);
      } else if (folded.kind == ValueKind::kFloat) {
        timeout_value = folded.float_value;
      } else if (folded.kind == ValueKind::kCall &&
                 folded.call_name == "constant" &&
                 folded.call_args.size() == 1) {
        const Value& value = folded.call_args[0];
        timeout_value = value.kind == ValueKind::kInt
                            ? static_cast<double>(value.int_value)
                            : value.float_value;
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

// agent -> agent Node (typed state, count param, behavior bindings, and
// agent-centric members: process-library blocks + couplings).
flatbuffers::Offset<v2::Node> v2_agent(
    flatbuffers::FlatBufferBuilder& builder, const Node& agent,
    const std::unordered_map<std::string, const Node*>& resources,
    const ParamScope& scope, const std::string& source_file,
    const LibraryRegistry& registry) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  for (const VarDecl& var : agent.vars) {
    if (var.keyword == "state") {
      state.push_back(v2_var_from_value(
          builder, var.name, fold_or_raw(var.value, scope)));
    }
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  params.push_back(v2_var_int(builder, "count",
                              int_field(agent, "count", scope, 1)));
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
  std::vector<flatbuffers::Offset<v2::Node>> children;
  std::vector<flatbuffers::Offset<v2::Coupling>> couplings;
  for (const Node& child : agent.children) {
    if (registry.has_block(child.kind)) {
      children.push_back(
          v2_process_block(builder, child, resources, scope, source_file,
                           registry));
    } else {
      const auto nested = v2_node(builder, child, resources, scope,
                                  source_file, registry);
      if (nested.o != 0) {
        children.push_back(nested);
      }
    }
  }
  for (const CoupleDecl& couple : agent.couplings) {
    couplings.push_back(v2::CreateCoupling(
        builder, builder.CreateString(couple.from_model),
        builder.CreateString(couple.from_port),
        builder.CreateString(couple.to_model),
        builder.CreateString(couple.to_port)));
  }
  return v2::CreateNode(
      builder, v2_metadata(builder, agent.name, source_file),
      builder.CreateVector(state), builder.CreateVector(params), 0,
      v2_semantics(builder, "agent", "agent"),
      builder.CreateVector(children), builder.CreateVector(couplings), 0,
      builder.CreateVector(behaviors), 0);
}

// continuous -> {sd, equation} Node: typed state (initial), params, and
// structured continuous equations.
flatbuffers::Offset<v2::Node> v2_continuous(
    flatbuffers::FlatBufferBuilder& builder, const Node& continuous,
    const ParamScope& scope, const std::string& source_file) {
  std::vector<flatbuffers::Offset<v2::Var>> state;
  const auto initial_value = [&](const Value& raw) {
    const Value value = fold_or_raw(raw, scope);
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
      state.push_back(v2_var_float(builder, var.name.c_str(),
                                   initial_value(var.value)));
    }
  }
  std::vector<flatbuffers::Offset<v2::Var>> params;
  for (const VarDecl& var : continuous.vars) {
    if (var.keyword == "param") {
      params.push_back(v2_var_float(builder, var.name.c_str(),
                                    initial_value(var.value)));
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
    const ParamScope& scope, const std::string& source_file,
    const LibraryRegistry& registry) {
  if (node.kind == "resource") {
    return v2_resource(builder, node, scope, source_file);
  }
  if (node.kind == "atomic") {
    return v2_atomic(builder, node, scope, source_file);
  }
  if (node.kind == "agent") {
    return v2_agent(builder, node, resources, scope, source_file, registry);
  }
  if (node.kind == "continuous") {
    return v2_continuous(builder, node, scope, source_file);
  }
  // Process blocks declared outside a process (e.g. top-level resource
  // instances) lower as standalone {process, <block>} nodes; experiment
  // members are handled via ModelFile.experiments, not the node tree.
  if (registry.has_block(node.kind)) {
    return v2_process_block(builder, node, resources, scope, source_file,
                            registry);
  }
  return 0;
}

}  // namespace

LoweredIr lower_to_ir_v2(const ModelAst& model,
                         const std::string& source_file,
                         const LibraryRegistry* registry) {
  flatbuffers::FlatBufferBuilder builder;
  const LibraryRegistry& registry_ref =
      registry != nullptr ? *registry : builtin_process_registry();

  ParamScope model_scope;
  for (const VarDecl& param : model.params) {
    Value folded;
    if (param.keyword == "param" && fold_value(param.value, model_scope,
                                               folded) &&
        (folded.kind == ValueKind::kInt || folded.kind == ValueKind::kFloat ||
         folded.kind == ValueKind::kBool ||
         folded.kind == ValueKind::kString)) {
      FoldedValue constant;
      constant.kind = folded.kind;
      constant.bool_value = folded.bool_value;
      constant.int_value = folded.int_value;
      constant.float_value = folded.float_value;
      constant.string_value = folded.string_value;
      model_scope.declare(param.name, constant);
    }
  }

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
    children.push_back(
        v2_node(builder, member, resources, model_scope, source_file,
                registry_ref));
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
    root_params.push_back(
        v2_var_from_value(builder, param.name, fold_or_raw(param.value,
                                                           model_scope)));
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

// IR loader implementation (FlatBuffers read-only view + ProcessModel
// lowering to the queueing flow engine).
#include "logicpilot/devs/ir_loader.h"

#include <fstream>
#include <optional>
#include <sstream>
#include <unordered_map>
#include <utility>

#include <flatbuffers/flatbuffers.h>

#include "ir_generated.h"
#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/ir_v2_convert.h"
#include "logicpilot/devs/continuous.h"

namespace logicpilot {

const char* to_string(IrStatus status) {
  switch (status) {
    case IrStatus::kOk: return "ok";
    case IrStatus::kIoError: return "io error";
    case IrStatus::kCorruptBuffer: return "corrupt buffer";
    case IrStatus::kBadSchemaVersion: return "unsupported schema version";
    case IrStatus::kMissingRoot: return "missing root model";
    case IrStatus::kUnsupportedKind: return "unsupported model kind";
    case IrStatus::kInvalidStructure: return "invalid model structure";
  }
  return "unknown";
}

IrLoadResult load_model_buffer(const std::uint8_t* data, std::size_t size) {
  IrLoadResult result;
  if (data == nullptr || size == 0) {
    result.status = IrStatus::kCorruptBuffer;
    result.message = "empty buffer";
    return result;
  }
  // Contract auto-detection via the file identifier (v1 "LPIR" / v2 "LP2R").
  // A v2 ModelFile keeps its native views; the v1 compatibility views are
  // produced when the process/agent converter can (equation/devs-native v2
  // files run without them).
  std::vector<std::uint8_t> bytes;
  if (flatbuffers::BufferHasIdentifier(data, "LPIR")) {
    flatbuffers::Verifier verifier(data, size);
    if (!ir::VerifyModelFileBuffer(verifier)) {
      result.status = IrStatus::kCorruptBuffer;
      result.message = "FlatBuffers verifier rejected the buffer";
      return result;
    }
    bytes.assign(data, data + size);
  } else if (flatbuffers::BufferHasIdentifier(data, "LP2R")) {
    result.file.v2_bytes.assign(data, data + size);
    result.file.v2_root = ir::v2::GetModelFile(result.file.v2_bytes.data());
    flatbuffers::Verifier verifier(data, size);
    if (!ir::v2::VerifyModelFileBuffer(verifier)) {
      result.status = IrStatus::kCorruptBuffer;
      result.message = "v2 FlatBuffers verifier rejected the buffer";
      return result;
    }
    if (result.file.v2_root->schema_version() != 2) {
      result.status = IrStatus::kBadSchemaVersion;
      result.message = "unexpected v2 schema_version";
      return result;
    }
    std::string convert_error;
    bytes = convert_v2_to_v1(data, size, &convert_error);
    if (bytes.empty()) {
      // Not v1-convertible (equation/devs-native): v2-only execution.
      return result;
    }
  } else {
    result.status = IrStatus::kCorruptBuffer;
    result.message = "not a LogicPilot IR file (missing LPIR/LP2R identifier)";
    return result;
  }
  result.file.bytes = std::move(bytes);
  result.file.root = ir::GetModelFile(result.file.bytes.data());
  if (result.file.root->schema_version() != 1) {
    result.status = IrStatus::kBadSchemaVersion;
    result.message = "schema_version=" +
                     std::to_string(result.file.root->schema_version());
    return result;
  }
  if (result.file.root->root() == nullptr) {
    result.status = IrStatus::kMissingRoot;
    result.message = "ModelFile.root is absent";
    return result;
  }
  return result;
}

IrLoadResult load_model_file(const std::string& path) {
  IrLoadResult result;
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    result.status = IrStatus::kIoError;
    result.message = "cannot open " + path;
    return result;
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  const std::string bytes = buffer.str();
  return load_model_buffer(reinterpret_cast<const std::uint8_t*>(bytes.data()),
                           bytes.size());
}

namespace {

const char* model_kind_name(ir::ModelKind kind) {
  switch (kind) {
    case ir::ModelKind_AtomicModel: return "AtomicModel";
    case ir::ModelKind_CoupledModel: return "CoupledModel";
    case ir::ModelKind_AgentModel: return "AgentModel";
    case ir::ModelKind_ProcessModel: return "ProcessModel";
    case ir::ModelKind_EquationModel: return "EquationModel";
    default: return "Unknown";
  }
}

const char* metadata_name(const ir::Metadata* meta) {
  if (meta != nullptr && meta->name() != nullptr) {
    return meta->name()->c_str();
  }
  return "<unnamed>";
}

// Lower an IR Distribution to a sampler. Poisson(rate) is treated as a
// Poisson arrival process, i.e. exponential(rate) inter-arrival times
// (dsl-spec v0 R8 semantics).
TimeSampler make_sampler(const ir::Distribution* dist, std::string* error) {
  if (dist == nullptr) {
    if (error != nullptr) {
      *error = "missing distribution";
    }
    return nullptr;
  }
  const auto param = [&](std::size_t i, double fallback) {
    if (dist->params() != nullptr && i < dist->params()->size()) {
      return dist->params()->Get(static_cast<flatbuffers::uoffset_t>(i));
    }
    return fallback;
  };
  switch (dist->kind()) {
    case ir::DistributionKind_Constant: {
      const double value = param(0, 0.0);
      return [value](Xoshiro256PlusPlus&) { return value; };
    }
    case ir::DistributionKind_Uniform: {
      Uniform<Xoshiro256PlusPlus> uniform{param(0, 0.0), param(1, 1.0)};
      return [uniform](Xoshiro256PlusPlus& engine) mutable {
        return uniform(engine);
      };
    }
    case ir::DistributionKind_Normal: {
      Normal<Xoshiro256PlusPlus> normal{param(0, 0.0), param(1, 1.0)};
      return [normal](Xoshiro256PlusPlus& engine) mutable {
        return normal(engine);
      };
    }
    case ir::DistributionKind_Exponential: {
      Exponential<Xoshiro256PlusPlus> exponential{param(0, 1.0)};
      return [exponential](Xoshiro256PlusPlus& engine) mutable {
        return exponential(engine);
      };
    }
    case ir::DistributionKind_Poisson: {
      // Poisson arrival process with this rate == exponential inter-arrivals.
      Exponential<Xoshiro256PlusPlus> exponential{param(0, 1.0)};
      return [exponential](Xoshiro256PlusPlus& engine) mutable {
        return exponential(engine);
      };
    }
    default:
      if (error != nullptr) {
        *error = "unknown distribution kind";
      }
      return nullptr;
  }
}

// Reads a FloatValue param by name from an AtomicModel (resource) node,
// returning `fallback` when absent or of a different type.
double resource_param(const ir::AtomicModel* resource, const char* name,
                      double fallback) {
  if (resource == nullptr || resource->params() == nullptr) {
    return fallback;
  }
  for (const ir::Param* param : *resource->params()) {
    if (param->name() != nullptr && param->name()->str() == name &&
        param->value_type() == ir::ParamValue_FloatValue) {
      return param->value_as_FloatValue()->value();
    }
  }
  return fallback;
}

std::unique_ptr<ReplicationModel> build_process_model(
    const ir::ProcessModel& process,
    const std::unordered_map<std::string, const ir::AtomicModel*>& resources,
    std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return std::unique_ptr<ReplicationModel>{};
  };
  if (process.nodes() == nullptr || process.nodes()->empty()) {
    return fail("ProcessModel has no nodes");
  }

  // Index nodes by name.
  std::unordered_map<std::string, const ir::ProcessNode*> by_name;
  const ir::ProcessNode* source = nullptr;
  const ir::ProcessNode* queue = nullptr;
  const ir::ProcessNode* service = nullptr;
  for (const ir::ProcessNode* node : *process.nodes()) {
    if (node->name() == nullptr) {
      return fail("ProcessNode without a name");
    }
    by_name.emplace(node->name()->str(), node);
    switch (node->kind_type()) {
      case ir::ProcessNodeKind_SourceNode: source = node; break;
      case ir::ProcessNodeKind_QueueNode:
        if (queue == nullptr) {
          queue = node;
        }
        break;
      case ir::ProcessNodeKind_ServiceNode: service = node; break;
      default: break;  // sinks/delays: accepted, no behavioral effect in v1
    }
  }
  if (source == nullptr) {
    return fail("ProcessModel requires a source node");
  }
  if (service == nullptr) {
    return fail("ProcessModel requires a service node");
  }

  // Walk couplings to validate connectivity source -> ... -> service
  // (declaration order is the fallback when no couplings are present).
  if (process.couplings() != nullptr && !process.couplings()->empty()) {
    std::unordered_map<std::string, std::string> next;
    for (const ir::Coupling* c : *process.couplings()) {
      if (c->from_model() != nullptr && c->to_model() != nullptr) {
        next[c->from_model()->str()] = c->to_model()->str();
      }
    }
    std::string cursor = source->name()->str();
    bool reached_service = cursor == service->name()->str();
    for (std::size_t hops = 0; hops < by_name.size() && !reached_service;
         ++hops) {
      const auto it = next.find(cursor);
      if (it == next.end()) {
        break;
      }
      cursor = it->second;
      reached_service = cursor == service->name()->str();
    }
    if (!reached_service) {
      return fail("couplings do not connect source to service");
    }
  }

  QueueingFlowSpec spec;
  const ir::SourceNode* source_spec = source->kind_as_SourceNode();
  TimeSampler arrival = make_sampler(
      source_spec != nullptr ? source_spec->arrival() : nullptr, error);
  if (!arrival) {
    return fail(error != nullptr && !error->empty()
                    ? *error
                    : "source has no arrival distribution");
  }
  const ir::ServiceNode* service_spec = service->kind_as_ServiceNode();
  TimeSampler service_time = make_sampler(
      service_spec != nullptr ? service_spec->service_time() : nullptr, error);
  if (!service_time) {
    return fail(error != nullptr && !error->empty()
                    ? *error
                    : "service has no service-time distribution");
  }
  const std::int64_t servers =
      service_spec != nullptr ? service_spec->servers() : 1;
  if (servers < 1) {
    return fail("service servers must be >= 1");
  }
  spec.interarrival = std::move(arrival);
  spec.service = std::move(service_time);
  spec.servers = servers;
  if (queue != nullptr) {
    const ir::QueueNode* queue_spec = queue->kind_as_QueueNode();
    if (queue_spec != nullptr) {
      // <= 0 is treated as unbounded (M/M/1 requires an infinite buffer).
      spec.queue_capacity = queue_spec->capacity() > 0 ? queue_spec->capacity()
                                                       : -1;
    }
  }

  // Resource failure semantics (milestone 1): the service references a
  // resource by name; that resource's AtomicModel carries failure_rate /
  // repair_rate params. failure_rate == 0 (absent) disables failures and
  // keeps the RNG draw order identical to the failure-free path.
  const ir::AtomicModel* resource = nullptr;
  if (service_spec != nullptr && service_spec->resource() != nullptr) {
    const auto it = resources.find(service_spec->resource()->str());
    if (it != resources.end()) {
      resource = it->second;
    }
  }
  const double failure_rate = resource_param(resource, "failure_rate", 0.0);
  if (failure_rate < 0.0 || failure_rate > 1.0) {
    return fail("failure_rate must be in [0, 1]");
  }
  if (failure_rate > 0.0) {
    const double repair_rate = resource_param(resource, "repair_rate", 1.0);
    if (repair_rate <= 0.0) {
      return fail("repair_rate must be > 0 when failure_rate > 0");
    }
    spec.failure = [failure_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{failure_rate};
      return dist(engine);
    };
    spec.repair = [repair_rate](Xoshiro256PlusPlus& engine) {
      Exponential<Xoshiro256PlusPlus> dist{repair_rate};
      return dist(engine);
    };
  }
  return std::make_unique<QueueingFlowSim>(std::move(spec));
}

// CoupledModel lowering (Phase 2b, task #6): the DSL compiler lowers a
// `model` to a CoupledModel root whose executable payload is a single
// ProcessModel child (resources ride along as passive AtomicModel children).
// Descend into that child; deeper nesting / multiple processes have no
// executable lowering yet.
std::unique_ptr<ReplicationModel> build_coupled_model(
    const ir::CoupledModel& coupled, std::string* error) {
  const ir::ProcessModel* process = nullptr;
  int process_count = 0;
  std::unordered_map<std::string, const ir::AtomicModel*> resources;
  if (coupled.children() != nullptr) {
    for (const ir::Model* child : *coupled.children()) {
      if (child->kind_type() == ir::ModelKind_ProcessModel) {
        process = child->kind_as_ProcessModel();
        ++process_count;
      } else if (child->kind_type() == ir::ModelKind_AtomicModel) {
        const ir::AtomicModel* atomic = child->kind_as_AtomicModel();
        if (atomic->metadata() != nullptr &&
            atomic->metadata()->name() != nullptr) {
          resources.emplace(atomic->metadata()->name()->str(), atomic);
        }
      }
    }
  }
  if (process_count == 1) {
    return build_process_model(*process, resources, error);
  }
  if (error != nullptr) {
    *error = process_count == 0
                 ? "CoupledModel contains no ProcessModel child to execute"
                 : "CoupledModel contains multiple ProcessModel children; "
                   "single-process lowering only in v1";
  }
  return nullptr;
}

}  // namespace

std::string inspect_model(const IrModelFile& file) {
  if (file.root == nullptr) {
    // v2-only contract (equation / native devs): report from the v2 root.
    if (file.v2_root != nullptr && file.v2_root->root() != nullptr &&
        file.v2_root->root()->semantics() != nullptr &&
        file.v2_root->root()->semantics()->block() != nullptr) {
      return "v2 '" + std::string(
                          file.v2_root->root()->semantics()->block()->c_str()) +
             "'";
    }
    return "<empty>";
  }
  if (file.root == nullptr || file.root->root() == nullptr) {
    return "<empty>";
  }
  const ir::Model* root = file.root->root();
  std::ostringstream out;
  out << model_kind_name(root->kind_type());
  const char* name = "<unnamed>";
  switch (root->kind_type()) {
    case ir::ModelKind_AtomicModel:
      name = metadata_name(root->kind_as_AtomicModel()->metadata());
      break;
    case ir::ModelKind_CoupledModel:
      name = metadata_name(root->kind_as_CoupledModel()->metadata());
      break;
    case ir::ModelKind_AgentModel:
      name = metadata_name(root->kind_as_AgentModel()->metadata());
      break;
    case ir::ModelKind_ProcessModel: {
      const ir::ProcessModel* p = root->kind_as_ProcessModel();
      name = metadata_name(p->metadata());
      out << " '" << name << "' nodes="
          << (p->nodes() != nullptr ? p->nodes()->size() : 0);
      return out.str();
    }
    case ir::ModelKind_EquationModel:
      name = metadata_name(root->kind_as_EquationModel()->metadata());
      break;
    default:
      break;
  }
  out << " '" << name << "'";
  return out.str();
}

std::unique_ptr<ReplicationModel> build_replication_model(
    const IrModelFile& file, std::string* error) {
  if (file.root == nullptr && file.v2_root == nullptr) {
    if (error != nullptr) {
      *error = "no model to execute";
    }
    return nullptr;
  }
  // v2-native dispatch first (equation / devs / agent), so v2-only files
  // (no v1 compatibility views) execute without the conversion layer.
  if (file.v2_root != nullptr && file.v2_root->root() != nullptr) {
    const ir::v2::Node* v2_root = file.v2_root->root();
    if (v2_root->semantics() != nullptr &&
        v2_root->semantics()->block() != nullptr) {
      const std::string block = v2_root->semantics()->block()->str();
      bool atomic_only = block == "atomic";
      bool agent_only = block == "agent";
      bool equation_only = block == "equation";
      const auto children_only = [&](const char* expected) {
        if (v2_root->children() == nullptr ||
            v2_root->children()->size() == 0) {
          return false;
        }
        for (const ir::v2::Node* child : *v2_root->children()) {
          if (child->semantics() == nullptr ||
              child->semantics()->block() == nullptr ||
              child->semantics()->block()->str() != expected) {
            return false;
          }
        }
        return true;
      };
      if (block == "model") {
        atomic_only = children_only("atomic");
        agent_only = children_only("agent");
        equation_only = children_only("equation");
      }
      if (atomic_only) {
        return std::make_unique<DevsReplicationModel>(file.v2_bytes,
                                                      v2_root);
      }
      if (agent_only) {
        return std::make_unique<AgentReplicationModel>(file.v2_bytes,
                                                       v2_root);
      }
      if (equation_only) {
        // Resolve the actual equation node (bare root or the sole child of
        // the core/model container).
        const ir::v2::Node* equation_node = v2_root;
        if (block == "model" && v2_root->children() != nullptr &&
            v2_root->children()->size() > 0) {
          equation_node = v2_root->children()->Get(0);
        }
        return std::make_unique<ContinuousReplicationModel>(file.v2_bytes,
                                                            equation_node);
      }
    }
  }
  if (file.root == nullptr) {
    if (error != nullptr) {
      *error = "v2 contract has no v1 compatibility views for this kind";
    }
    return nullptr;
  }
  if (file.root == nullptr || file.root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return nullptr;
  }
  const ir::Model* root = file.root->root();
  if (root->kind_type() == ir::ModelKind_ProcessModel) {
    const std::unordered_map<std::string, const ir::AtomicModel*> no_resources;
    return build_process_model(*root->kind_as_ProcessModel(), no_resources,
                               error);
  }
  if (root->kind_type() == ir::ModelKind_CoupledModel) {
    const ir::CoupledModel* coupled = root->kind_as_CoupledModel();
    // v1 equation compatibility: a CoupledModel wrapping one EquationModel.
    if (coupled->children() != nullptr) {
      int equation_count = 0;
      const ir::EquationModel* equation = nullptr;
      for (const ir::Model* child : *coupled->children()) {
        if (child->kind_type() == ir::ModelKind_EquationModel) {
          ++equation_count;
          equation = child->kind_as_EquationModel();
        }
      }
      if (equation_count == 1) {
        return std::make_unique<ContinuousReplicationModel>(file.bytes,
                                                            equation);
      }
    }
    // Milestone 1b: a coupled tree whose children are AtomicModels executes
    // through the DEVS-lite executor (generic DEVS semantics). Mixed trees
    // with a ProcessModel child keep the process lowering (v1).
    if (coupled->children() != nullptr) {
      bool has_process = false;
      bool has_atomic = false;
      bool has_agent = false;
      for (const ir::Model* child : *coupled->children()) {
        has_process |= child->kind_type() == ir::ModelKind_ProcessModel;
        has_atomic |= child->kind_type() == ir::ModelKind_AtomicModel;
        has_agent |= child->kind_type() == ir::ModelKind_AgentModel;
      }
      // Milestone 1c: an agent-only coupled model runs the tick-loop agent
      // runtime (ABM, v0.1 built-in behaviors).
      if (has_agent && !has_process && !has_atomic) {
        return std::make_unique<AgentReplicationModel>(file.bytes, root);
      }
      if (has_atomic && !has_process) {
        return std::make_unique<DevsReplicationModel>(file.bytes, root);
      }
    }
    return build_coupled_model(*coupled, error);
  }
  if (root->kind_type() == ir::ModelKind_AtomicModel) {
    return std::make_unique<DevsReplicationModel>(file.bytes, root);
  }
  if (root->kind_type() == ir::ModelKind_AgentModel) {
    return std::make_unique<AgentReplicationModel>(file.bytes, root);
  }
  if (root->kind_type() == ir::ModelKind_EquationModel) {
    return std::make_unique<ContinuousReplicationModel>(
        file.bytes, root->kind_as_EquationModel());
  }
  if (error != nullptr) {
    *error = std::string("no executable lowering for ") +
             model_kind_name(root->kind_type()) +
             " in Phase 1b (declarative view only)";
  }
  return nullptr;
}

bool extract_flow_params(const IrModelFile& file, FlowRunParams& out,
                         std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return false;
  };
  if (file.root == nullptr || file.root->root() == nullptr) {
    return fail("no root model");
  }

  const ir::Model* root = file.root->root();
  const ir::ProcessModel* process = nullptr;
  std::unordered_map<std::string, const ir::AtomicModel*> resources;
  if (root->kind_type() == ir::ModelKind_ProcessModel) {
    process = root->kind_as_ProcessModel();
  } else if (root->kind_type() == ir::ModelKind_CoupledModel) {
    const ir::CoupledModel* coupled = root->kind_as_CoupledModel();
    if (coupled->children() != nullptr) {
      for (const ir::Model* child : *coupled->children()) {
        if (child->kind_type() == ir::ModelKind_ProcessModel) {
          if (process != nullptr) {
            return fail(
                "multiple ProcessModel children; streaming supports one");
          }
          process = child->kind_as_ProcessModel();
        } else if (child->kind_type() == ir::ModelKind_AtomicModel) {
          const ir::AtomicModel* atomic = child->kind_as_AtomicModel();
          if (atomic->metadata() != nullptr &&
              atomic->metadata()->name() != nullptr) {
            resources.emplace(atomic->metadata()->name()->str(), atomic);
          }
        }
      }
    }
  } else {
    return fail("no process model to stream");
  }
  if (process == nullptr) {
    return fail("no ProcessModel to stream");
  }

  const ir::ProcessNode* source = nullptr;
  const ir::ProcessNode* service = nullptr;
  for (const ir::ProcessNode* node : *process->nodes()) {
    switch (node->kind_type()) {
      case ir::ProcessNodeKind_SourceNode: source = node; break;
      case ir::ProcessNodeKind_ServiceNode: service = node; break;
      default: break;
    }
  }
  if (source == nullptr || service == nullptr) {
    return fail("ProcessModel requires a source and a service node");
  }
  const ir::SourceNode* source_spec = source->kind_as_SourceNode();
  const ir::ServiceNode* service_spec = service->kind_as_ServiceNode();
  if (source_spec == nullptr || source_spec->arrival() == nullptr ||
      service_spec == nullptr || service_spec->service_time() == nullptr) {
    return fail("source arrival or service time missing");
  }
  if (source_spec->arrival()->kind() != ir::DistributionKind_Poisson &&
      source_spec->arrival()->kind() != ir::DistributionKind_Exponential) {
    return fail(
        "streaming driver requires poisson/exponential arrivals, got " +
        std::to_string(source_spec->arrival()->kind()));
  }
  if (service_spec->service_time()->kind() !=
      ir::DistributionKind_Exponential) {
    return fail(
        "streaming driver requires exponential service times, got " +
        std::to_string(service_spec->service_time()->kind()));
  }
  const auto first_param = [](const ir::Distribution* dist,
                              std::optional<double>& out) {
    if (dist->params() != nullptr && dist->params()->size() > 0) {
      out = dist->params()->Get(0);
    }
  };
  std::optional<double> lambda;
  std::optional<double> mu;
  first_param(source_spec->arrival(), lambda);
  first_param(service_spec->service_time(), mu);
  if (!lambda.has_value() || *lambda <= 0.0 || !mu.has_value() ||
      *mu <= 0.0) {
    return fail("arrival/service rates must be positive");
  }
  out.lambda = *lambda;
  out.mu = *mu;
  out.servers = service_spec->servers() < 1 ? 1 : service_spec->servers();

  const ir::AtomicModel* resource = nullptr;
  if (service_spec->resource() != nullptr) {
    const auto it = resources.find(service_spec->resource()->str());
    if (it != resources.end()) {
      resource = it->second;
    }
  }
  out.failure_rate = resource_param(resource, "failure_rate", 0.0);
  out.repair_rate = resource_param(resource, "repair_rate", 1.0);
  return true;
}

}  // namespace logicpilot

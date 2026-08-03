// IR loader implementation (FlatBuffers read-only view + ProcessModel
// lowering to the queueing flow engine).
#include "logicpilot/devs/ir_loader.h"

#include <fstream>
#include <sstream>
#include <unordered_map>
#include <utility>

#include <flatbuffers/flatbuffers.h>

#include "ir_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/devs/mm1.h"

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
  flatbuffers::Verifier verifier(data, size);
  if (!ir::VerifyModelFileBuffer(verifier)) {
    result.status = IrStatus::kCorruptBuffer;
    result.message = "FlatBuffers verifier rejected the buffer";
    return result;
  }
  result.file.bytes.assign(data, data + size);
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

std::unique_ptr<ReplicationModel> build_process_model(
    const ir::ProcessModel& process, std::string* error) {
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
  spec.interarrival = std::move(arrival);
  spec.service = std::move(service_time);
  if (queue != nullptr) {
    const ir::QueueNode* queue_spec = queue->kind_as_QueueNode();
    if (queue_spec != nullptr) {
      // <= 0 is treated as unbounded (M/M/1 requires an infinite buffer).
      spec.queue_capacity = queue_spec->capacity() > 0 ? queue_spec->capacity()
                                                       : -1;
    }
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
  if (coupled.children() != nullptr) {
    for (const ir::Model* child : *coupled.children()) {
      if (child->kind_type() == ir::ModelKind_ProcessModel) {
        process = child->kind_as_ProcessModel();
        ++process_count;
      }
    }
  }
  if (process_count == 1) {
    return build_process_model(*process, error);
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
  if (file.root == nullptr || file.root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return nullptr;
  }
  const ir::Model* root = file.root->root();
  if (root->kind_type() == ir::ModelKind_ProcessModel) {
    return build_process_model(*root->kind_as_ProcessModel(), error);
  }
  if (root->kind_type() == ir::ModelKind_CoupledModel) {
    return build_coupled_model(*root->kind_as_CoupledModel(), error);
  }
  if (error != nullptr) {
    *error = std::string("no executable lowering for ") +
             model_kind_name(root->kind_type()) +
             " in Phase 1b (declarative view only)";
  }
  return nullptr;
}

}  // namespace logicpilot

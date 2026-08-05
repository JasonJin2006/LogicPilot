// IR loader implementation (FlatBuffers read-only view + v2-native lowering
// to the queueing flow engine).
//
// The loader accepts the v2 contract only ("LP2R", schemas/ir_v2.fbs): the
// v1 contract ("LPIR") was retired in the full IR v2 migration. Every
// executable model is a Node tree; process flows lower natively to
// QueueingFlowSim, while DEVS / agent / equation trees go to their dedicated
// replication engines (all v2-native).
#include "logicpilot/devs/ir_loader.h"

#include <cstring>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>

#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/devs/continuous.h"
#include "logicpilot/devs/ir_agent.h"
#include "logicpilot/devs/ir_atomic.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/process_flow.h"

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
  if (!flatbuffers::BufferHasIdentifier(data, "LP2R")) {
    result.status = IrStatus::kCorruptBuffer;
    result.message = "not a LogicPilot v2 IR file (missing LP2R identifier)";
    return result;
  }
  result.file.v2_bytes.assign(data, data + size);
  result.file.v2_root = ir::v2::GetModelFile(result.file.v2_bytes.data());
  flatbuffers::Verifier verifier(data, size);
  if (!ir::v2::VerifyModelFileBuffer(verifier)) {
    result.status = IrStatus::kCorruptBuffer;
    result.message = "FlatBuffers verifier rejected the buffer";
    return result;
  }
  if (result.file.v2_root->schema_version() != 2) {
    result.status = IrStatus::kBadSchemaVersion;
    result.message = "unexpected schema_version=" +
                     std::to_string(result.file.v2_root->schema_version());
    return result;
  }
  if (result.file.v2_root->root() == nullptr) {
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

using ir::v2::Distribution;
using ir::v2::Node;
using ir::v2::Var;
using ir::v2::VarType_Distribution;
using ir::v2::VarType_Float;
using ir::v2::VarType_Int;
using ir::v2::VarType_String;

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

const char* node_name(const Node* node) {
  if (node != nullptr && node->metadata() != nullptr &&
      node->metadata()->name() != nullptr) {
    return node->metadata()->name()->c_str();
  }
  return "<unnamed>";
}

// Reads a typed block parameter by name from a v2 Node's `params` vector.
const Var* node_var(const Node* node, const char* name) {
  if (node == nullptr || node->params() == nullptr) {
    return nullptr;
  }
  for (const Var* var : *node->params()) {
    if (var != nullptr && var->name() != nullptr &&
        var->name()->str() == name) {
      return var;
    }
  }
  return nullptr;
}

double node_float_param(const Node* node, const char* name, double fallback) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Float) {
    return var->float_value();
  }
  return fallback;
}

std::int64_t node_int_param(const Node* node, const char* name,
                            std::int64_t fallback) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Int) {
    return var->int_value();
  }
  return fallback;
}

const char* node_string_param(const Node* node, const char* name) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_String &&
      var->string_value() != nullptr) {
    return var->string_value()->c_str();
  }
  return nullptr;
}

const Distribution* node_dist_param(const Node* node, const char* name) {
  const Var* var = node_var(node, name);
  if (var != nullptr && var->type() == VarType_Distribution) {
    return var->distribution();
  }
  return nullptr;
}

// Lower a v2 IR Distribution to a sampler. Poisson(rate) is treated as a
// Poisson arrival process, i.e. exponential(rate) inter-arrival times
// (dsl-spec v0 R8 semantics). Kind bytes mirror the v1 DistributionKind
// values: Constant=0, Uniform=1, Normal=2, Exponential=3, Poisson=4.
TimeSampler make_sampler(const Distribution* dist, std::string* error) {
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
    case 0: {  // Constant
      const double value = param(0, 0.0);
      return [value](Xoshiro256PlusPlus&) { return value; };
    }
    case 1: {  // Uniform
      Uniform<Xoshiro256PlusPlus> uniform{param(0, 0.0), param(1, 1.0)};
      return [uniform](Xoshiro256PlusPlus& engine) mutable {
        return uniform(engine);
      };
    }
    case 2: {  // Normal
      Normal<Xoshiro256PlusPlus> normal{param(0, 0.0), param(1, 1.0)};
      return [normal](Xoshiro256PlusPlus& engine) mutable {
        return normal(engine);
      };
    }
    case 3: {  // Exponential
      Exponential<Xoshiro256PlusPlus> exponential{param(0, 1.0)};
      return [exponential](Xoshiro256PlusPlus& engine) mutable {
        return exponential(engine);
      };
    }
    case 4: {  // Poisson arrival process == exponential inter-arrivals
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

// v2-native process lowering (agent-centric).
//
// The flow's stages come from process-library blocks declared directly under
// the model root (agent-centric structure), connected by the root's own
// couplings; alternatively an agent body may hold the flow (its members +
// couplings). Resource pools come from the model root's
// {process, resource} children.
std::unique_ptr<ReplicationModel> build_process_model(const Node* model_root,
                                                      std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return std::unique_ptr<ReplicationModel>{};
  };
  if (model_root->children() == nullptr) {
    return fail("core/model root has no children to execute");
  }

  std::unordered_map<std::string, const Node*> resources;
  std::vector<const Node*> flow_stages;
  std::vector<const ir::v2::Coupling*> flow_couplings;
  bool agent_body_flow = false;
  for (const Node* child : *model_root->children()) {
    if (std::strcmp(node_library(child), "process") != 0) {
      continue;
    }
    const std::string block = node_block(child);
    if (block == "resource") {
      resources.emplace(node_name(child), child);
    } else {
      // Agent-centric: a process-library block directly under the root is a
      // flow stage connected by the root's couplings.
      flow_stages.push_back(child);
    }
  }
  // Agent-centric: an agent body may hold the process flow (agent Main {
  // source ...; couple ... }). Use that agent's members + couplings.
  if (flow_stages.empty()) {
    for (const Node* child : *model_root->children()) {
      if (std::strcmp(node_library(child), "agent") != 0 ||
          child->children() == nullptr) {
        continue;
      }
      for (const Node* member : *child->children()) {
        if (std::strcmp(node_library(member), "process") != 0) {
          continue;
        }
        const std::string block = node_block(member);
        if (block == "resource") {
          resources.emplace(node_name(member), member);
        } else {
          flow_stages.push_back(member);
        }
      }
      if (!flow_stages.empty()) {
        if (child->couplings() != nullptr) {
          for (const ir::v2::Coupling* coupling : *child->couplings()) {
            flow_couplings.push_back(coupling);
          }
        }
        agent_body_flow = true;
        break;
      }
    }
  }
  if (flow_couplings.empty() && !agent_body_flow) {
    if (model_root->couplings() != nullptr) {
      for (const ir::v2::Coupling* coupling : *model_root->couplings()) {
        flow_couplings.push_back(coupling);
      }
    }
  }
  if (flow_stages.empty()) {
    return fail("no process flow to execute");
  }

  // Generic topology check: the specialized M/M/1 path handles exactly
  // source/queue/service/sink chains; anything else (delay, split,
  // selectOutput, ...) goes to the generic ProcessFlowSim engine.
  bool generic_flow = false;
  int source_count = 0;
  for (const Node* stage : flow_stages) {
    const std::string block = node_block(stage);
    if (block == "source") {
      ++source_count;
    } else if (block != "queue" && block != "service" &&
               block != "sink") {
      generic_flow = true;
    }
  }
  if (generic_flow || source_count > 1) {
    auto generic =
        std::make_unique<ProcessFlowSim>(flow_stages, flow_couplings,
                                         model_root, error);
    if (generic == nullptr || (error != nullptr && !error->empty())) {
      return fail(error != nullptr && !error->empty()
                      ? *error
                      : "cannot build generic process flow");
    }
    return generic;
  }

  // Index the flow's stages by block; first of each kind wins (matches the
  // single-source/single-queue/single-service process model).
  const Node* source = nullptr;
  const Node* queue = nullptr;
  const Node* service = nullptr;
  for (const Node* stage : flow_stages) {
    const std::string block = node_block(stage);
    if (block == "source" && source == nullptr) {
      source = stage;
    } else if (block == "queue" && queue == nullptr) {
      queue = stage;
    } else if (block == "service" && service == nullptr) {
      service = stage;
    }
  }
  if (source == nullptr) {
    return fail("process flow requires a source stage");
  }
  if (service == nullptr) {
    return fail("process flow requires a service stage");
  }

  // Walk the flow couplings to validate connectivity source -> ... ->
  // service (declaration order is the fallback when no couplings exist).
  if (!flow_couplings.empty()) {
    std::unordered_map<std::string, std::string> next;
    for (const ir::v2::Coupling* c : flow_couplings) {
      if (c->from_model() != nullptr && c->to_model() != nullptr) {
        next[c->from_model()->str()] = c->to_model()->str();
      }
    }
    std::string cursor = node_name(source);
    const std::string service_name = node_name(service);
    bool reached_service = cursor == service_name;
    for (std::size_t hops = 0; hops < flow_stages.size() && !reached_service;
         ++hops) {
      const auto it = next.find(cursor);
      if (it == next.end()) {
        break;
      }
      cursor = it->second;
      reached_service = cursor == service_name;
    }
    if (!reached_service) {
      return fail("couplings do not connect source to service");
    }
  }

  QueueingFlowSpec spec;
  TimeSampler arrival = make_sampler(node_dist_param(source, "arrival"), error);
  if (!arrival) {
    return fail(error != nullptr && !error->empty()
                    ? *error
                    : "source has no arrival distribution");
  }
  TimeSampler service_time =
      make_sampler(node_dist_param(service, "time"), error);
  if (!service_time) {
    return fail(error != nullptr && !error->empty()
                    ? *error
                    : "service has no service-time distribution");
  }
  spec.interarrival = std::move(arrival);
  spec.service = std::move(service_time);
  if (queue != nullptr) {
    const std::int64_t capacity = node_int_param(queue, "capacity", 0);
    // <= 0 is treated as unbounded (M/M/1 requires an infinite buffer).
    spec.queue_capacity = capacity > 0 ? capacity : -1;
  }

  // Resource failure semantics (milestone 1): the service stage references a
  // resource node by name; that resource carries failure_rate / repair_rate
  // block params. failure_rate == 0 disables failures and keeps the RNG draw
  // order identical to the failure-free path.
  const Node* resource = nullptr;
  const char* resource_name = node_string_param(service, "resource");
  if (resource_name == nullptr) {
    // v0 same-name binding fallback: service without an explicit resource
    // references a resource block named like the service.
    resource_name = node_name(service);
  }
  if (resource_name != nullptr) {
    const auto it = resources.find(resource_name);
    if (it != resources.end()) {
      resource = it->second;
    }
  }
  spec.servers = node_int_param(resource, "capacity", 1);
  if (spec.servers < 1) {
    return fail("service resource capacity must be >= 1");
  }
  const double failure_rate = node_float_param(resource, "failure_rate", 0.0);
  if (failure_rate < 0.0 || failure_rate > 1.0) {
    return fail("failure_rate must be in [0, 1]");
  }
  if (failure_rate > 0.0) {
    const double repair_rate = node_float_param(resource, "repair_rate", 1.0);
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

}  // namespace

std::string inspect_model(const IrModelFile& file) {
  if (file.v2_root == nullptr || file.v2_root->root() == nullptr) {
    return "<empty>";
  }
  const Node* root = file.v2_root->root();
  std::ostringstream out;
  out << node_block(root);
  const char* name = node_name(root);
  if (std::strcmp(name, "<unnamed>") != 0) {
    out << " '" << name << "'";
  }
  if (root->children() != nullptr && root->children()->size() > 0) {
    out << " (" << root->children()->size() << " children)";
  }
  return out.str();
}

std::unique_ptr<ReplicationModel> build_replication_model(
    const IrModelFile& file, std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return std::unique_ptr<ReplicationModel>{};
  };
  if (file.v2_root == nullptr || file.v2_root->root() == nullptr) {
    return fail("no root model");
  }
  const Node* root = file.v2_root->root();
  const std::string root_block = node_block(root);
  if (root_block == "atomic") {
    return std::make_unique<DevsReplicationModel>(file.v2_bytes, root);
  }
  if (root_block == "agent") {
    return std::make_unique<AgentReplicationModel>(file.v2_bytes, root);
  }
  if (root_block == "equation") {
    return std::make_unique<ContinuousReplicationModel>(file.v2_bytes, root);
  }
  if (root_block != "model") {
    return fail("unsupported root block '" + root_block + "'");
  }

  bool has_process = false;
  bool has_atomic = false;
  bool has_agent = false;
  bool has_equation = false;
  if (root->children() != nullptr) {
    for (const Node* child : *root->children()) {
      const std::string library = node_library(child);
      const std::string block = node_block(child);
      if (library == "process" && block != "resource") {
        // Agent-centric process-library blocks declared directly under the
        // model root.
        has_process = true;
      } else if (library == "devs") {
        has_atomic = true;
      } else if (library == "agent") {
        has_agent = true;
        // An agent whose body holds process-library blocks is a flow scope
        // (agent-centric: agent Main { source ...; couple ... }).
        if (child->children() != nullptr) {
          for (const Node* member : *child->children()) {
            if (std::strcmp(node_library(member), "process") == 0 &&
                std::strcmp(node_block(member), "resource") != 0) {
              has_process = true;
            }
          }
        }
      } else if (library == "sd") {
        has_equation = true;
      }
    }
  }
  if (has_process) {
    return build_process_model(root, error);
  }
  if (has_agent && !has_atomic && !has_equation) {
    return std::make_unique<AgentReplicationModel>(file.v2_bytes, root);
  }
  if (has_atomic && !has_agent && !has_equation) {
    return std::make_unique<DevsReplicationModel>(file.v2_bytes, root);
  }
  if (has_equation && !has_atomic && !has_agent) {
    return std::make_unique<ContinuousReplicationModel>(file.v2_bytes, root);
  }
  return fail("no executable model under the core/model root");
}

bool extract_flow_params(const IrModelFile& file, FlowRunParams& out,
                         std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return false;
  };
  if (file.v2_root == nullptr || file.v2_root->root() == nullptr) {
    return fail("no root model");
  }
  const Node* root = file.v2_root->root();
  if (std::strcmp(node_block(root), "model") != 0 ||
      root->children() == nullptr) {
    return fail("no process model to stream");
  }

  std::vector<const Node*> flow_stages;
  std::unordered_map<std::string, const Node*> resources;
  for (const Node* child : *root->children()) {
    if (std::strcmp(node_library(child), "process") != 0) {
      continue;
    }
    const std::string block = node_block(child);
    if (block == "resource") {
      resources.emplace(node_name(child), child);
    } else {
      flow_stages.push_back(child);
    }
  }
  // Agent-centric flows: process-library blocks directly under the root, or
  // inside a root-level agent body (agent Main { source ...; couple ... }).
  if (flow_stages.empty()) {
    for (const Node* child : *root->children()) {
      if (std::strcmp(node_library(child), "agent") != 0 ||
          child->children() == nullptr) {
        continue;
      }
      for (const Node* member : *child->children()) {
        if (std::strcmp(node_library(member), "process") != 0) {
          continue;
        }
        const std::string block = node_block(member);
        if (block == "resource") {
          resources.emplace(node_name(member), member);
        } else {
          flow_stages.push_back(member);
        }
      }
      if (!flow_stages.empty()) {
        break;
      }
    }
    if (flow_stages.empty()) {
      return fail("no process flow to stream");
    }
  }
  const Node* source = nullptr;
  const Node* service = nullptr;
  for (const Node* stage : flow_stages) {
      const std::string block = node_block(stage);
      if (block == "source") {
        source = stage;
      } else if (block == "service") {
        service = stage;
      }
  }
  if (source == nullptr || service == nullptr) {
    return fail("process flow requires a source and a service stage");
  }
  const Distribution* arrival = node_dist_param(source, "arrival");
  const Distribution* service_time = node_dist_param(service, "time");
  if (arrival == nullptr || service_time == nullptr) {
    return fail("source arrival or service time missing");
  }
  if (arrival->kind() != 4 && arrival->kind() != 3) {
    return fail("streaming driver requires poisson/exponential arrivals, got " +
                std::to_string(arrival->kind()));
  }
  if (service_time->kind() != 3) {
    return fail("streaming driver requires exponential service times, got " +
                std::to_string(service_time->kind()));
  }
  const auto first_param = [](const Distribution* dist,
                              std::optional<double>& value) {
    if (dist->params() != nullptr && dist->params()->size() > 0) {
      value = dist->params()->Get(0);
    }
  };
  std::optional<double> lambda;
  std::optional<double> mu;
  first_param(arrival, lambda);
  first_param(service_time, mu);
  if (!lambda.has_value() || !mu.has_value()) {
    return fail("arrival/service distributions require a rate parameter");
  }
  out.lambda = *lambda;
  out.mu = *mu;

  const Node* resource = nullptr;
  const char* resource_name = node_string_param(service, "resource");
  if (resource_name == nullptr) {
    resource_name = node_name(service);  // v0 same-name binding fallback
  }
  if (resource_name != nullptr) {
    const auto it = resources.find(resource_name);
    if (it != resources.end()) {
      resource = it->second;
    }
  }
  out.servers = node_int_param(resource, "capacity", 1);
  out.failure_rate = node_float_param(resource, "failure_rate", 0.0);
  out.repair_rate = node_float_param(resource, "repair_rate", 1.0);
  return true;
}

}  // namespace logicpilot

// IR loader implementation (FlatBuffers read-only view + registry-driven
// lowering to executable models).
//
// The loader accepts the v2 contract only ("LP2R", schemas/ir_v2.fbs): the
// v1 contract ("LPIR") was retired in the full IR v2 migration. Every
// executable model is a Node tree; lowering is delegated to the Method
// Runtime Layer (kernel/runtime + methods/): build_replication_model()
// resolves the model's method from its IR semantics and asks the
// MethodRegistry for the runtime that knows how to execute it. The kernel
// no longer hard-codes process/agent/devs/sd lowering details.
//
//   Model IR  ->  resolve method  ->  MethodRegistry  ->  SimulationMethod
//
// The streaming driver's flow-parameter extraction stays here because it is
// a generic IR query (shared by lp-server), not method execution.
#include "logicpilot/devs/ir_loader.h"

#include <cstring>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include <flatbuffers/flatbuffers.h>

#include "ir_v2_generated.h"
#include "logicpilot/devs/ir_v2_util.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/simulation_method.h"

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
using logicpilot::ir_v2_util::node_block;
using logicpilot::ir_v2_util::node_dist_param;
using logicpilot::ir_v2_util::node_float_param;
using logicpilot::ir_v2_util::node_int_param;
using logicpilot::ir_v2_util::node_library;
using logicpilot::ir_v2_util::node_name;
using logicpilot::ir_v2_util::node_string_param;

// Resolve the model's method name from the root node's semantics, mirroring
// the legacy exclusive-kind lowering:
//   * root block "atomic"    -> "devs"
//   * root block "agent"     -> "agent"
//   * root block "equation"  -> "sd"
//   * root block "model"     -> scan children by library (process / devs /
//                               agent / sd); process wins when an agent body
//                               holds process-library blocks.
// Returns an empty string when no executable method is present (mixed
// multi-method models are a later-phase capability).
std::string resolve_method_name(const Node* root) {
  const std::string root_block = node_block(root);
  if (root_block == "atomic") {
    return "devs";
  }
  if (root_block == "agent") {
    return "agent";
  }
  if (root_block == "equation") {
    return "sd";
  }
  if (root_block != "model" || root->children() == nullptr) {
    return "";
  }

  bool has_process = false;
  bool has_atomic = false;
  bool has_agent = false;
  bool has_equation = false;
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
  if (has_process) {
    return "process";
  }
  if (has_agent && !has_atomic && !has_equation) {
    return "agent";
  }
  if (has_atomic && !has_agent && !has_equation) {
    return "devs";
  }
  if (has_equation && !has_atomic && !has_agent) {
    return "sd";
  }
  return "";
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

  // Kernel-native methods (devs/agent/sd) are always available; method
  // libraries such as methods/process register themselves at driver startup.
  register_builtin_methods();

  const std::string method =
      resolve_method_name(file.v2_root->root());
  if (method.empty()) {
    return fail("no executable model under the core/model root");
  }
  MethodRegistry& registry = MethodRegistry::instance();
  if (!registry.contains(method)) {
    return fail("no registered method runtime for '" + method +
                "' (link the method library and register it)");
  }
  auto runtime = registry.create(method);
  if (runtime == nullptr) {
    return fail("method registry returned a null runtime for '" + method +
                "'");
  }
  return runtime->to_replication_model(file, error);
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

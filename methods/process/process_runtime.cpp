// ProcessRuntime implementation (see process_runtime.h).
//
// The lowering logic was moved verbatim from kernel/src/devs/ir_loader.cpp
// (build_process_model) so the kernel no longer contains process-specific
// knowledge: it resolves the method from the IR and delegates here.
#include "process_runtime.h"

#include <cstring>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/ir_v2_util.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/runtime/method_registry.h"
#include "logicpilot/runtime/runtime_context.h"
#include "process_flow.h"

namespace logicpilot {
namespace {

using ir::v2::Distribution;
using ir::v2::Node;
using logicpilot::ir_v2_util::make_sampler;
using logicpilot::ir_v2_util::node_block;
using logicpilot::ir_v2_util::node_dist_param;
using logicpilot::ir_v2_util::node_float_param;
using logicpilot::ir_v2_util::node_int_param;
using logicpilot::ir_v2_util::node_library;
using logicpilot::ir_v2_util::node_name;
using logicpilot::ir_v2_util::node_string_param;

// v2-native process lowering (agent-centric).
//
// The flow's stages come from process-library blocks declared directly under
// the model root (agent-centric structure), connected by the root's own
// couplings; alternatively an agent body may hold the flow (its members +
// couplings). Resource pools come from the model root's
// {process, resource} children.
std::unique_ptr<ReplicationModel> lower_process_model(const Node* model_root,
                                                      std::string* error) {
  const auto fail = [&](const std::string& msg) {
    if (error != nullptr) {
      *error = msg;
    }
    return std::unique_ptr<ReplicationModel>{};
  };
  if (model_root == nullptr) {
    return fail("no process model root");
  }
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

bool ProcessRuntime::initialize(RuntimeContext& context,
                                const IrModelFile& model,
                                std::string* error) {
  context_ = &context;
  ran_ = false;
  last_metrics_ = ReplicationMetrics{};
  if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return false;
  }
  replication_ = lower(model.v2_root->root(), error);
  if (replication_ == nullptr) {
    return false;
  }
  // Prepare one replication with the lifecycle driver defaults; subsequent
  // advance(until) calls step the engine by simulation time (Phase 3).
  ReplicationConfig config;
  if (auto* flow = dynamic_cast<ProcessFlowSim*>(replication_.get())) {
    flow->reset(config);
  } else if (auto* queue =
                 dynamic_cast<QueueingFlowSim*>(replication_.get())) {
    queue->reset(config);
  }
  return true;
}

void ProcessRuntime::advance(SimTime until) {
  if (replication_ == nullptr) {
    return;
  }
  if (auto* flow = dynamic_cast<ProcessFlowSim*>(replication_.get())) {
    flow->advance(until, nullptr);
    last_metrics_ = flow->metrics();
  } else if (auto* queue =
                 dynamic_cast<QueueingFlowSim*>(replication_.get())) {
    queue->advance(until, nullptr);
    last_metrics_ = queue->metrics();
  } else if (!ran_) {
    // Unexpected engine type: fall back to the batch contract once.
    ReplicationConfig config;
    last_metrics_ = replication_->run(config, nullptr);
    ran_ = true;
  }
}

void ProcessRuntime::shutdown() {
  replication_.reset();
  context_ = nullptr;
  ran_ = false;
}

std::unique_ptr<ReplicationModel> ProcessRuntime::lower(
    const ir::v2::Node* model_root, std::string* error) {
  return lower_process_model(model_root, error);
}

std::unique_ptr<ReplicationModel> ProcessRuntime::to_replication_model(
    const IrModelFile& model, std::string* error) {
  if (model.v2_root == nullptr || model.v2_root->root() == nullptr) {
    if (error != nullptr) {
      *error = "no root model";
    }
    return nullptr;
  }
  return lower(model.v2_root->root(), error);
}

void register_process_method() {
  MethodRegistry::instance().register_method(
      "process", [] { return std::make_unique<ProcessRuntime>(); });
}

void register_all_methods() {
  register_builtin_methods();
  register_process_method();
}

}  // namespace logicpilot

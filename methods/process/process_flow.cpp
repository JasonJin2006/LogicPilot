// Generic process-flow executor implementation (see process_flow.h), including
// manual Source injection.
//
// Push-protocol model: tokens advance block-by-block. A token is accepted
// by a downstream block only when that block can start processing it now
// (a free server / delay slot / free input slot), otherwise it waits in the
// upstream block. Port-aware couplings route emissions (selectOutput outT/
// outF, split out/outCopy, ...) exactly like the compiled IR.
//
// Phase 3 (Method Runtime Layer): the engine is incremental (reset /
// advance / metrics) and delegates every block's behavior to modular
// ProcessBlock implementations (process_blocks.h).
#include "process_flow.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/devs/ir_v2_util.h"
#include "logicpilot/runtime/runtime_context.h"
#include "process_block.h"
#include "process_blocks.h"

namespace logicpilot {
namespace process {
namespace {

using ir::v2::Node;
using logicpilot::ir_v2_util::make_sampler;
using logicpilot::ir_v2_util::node_bool_param;
using logicpilot::ir_v2_util::node_dist_param;
using logicpilot::ir_v2_util::node_float_param;
using logicpilot::ir_v2_util::node_int_param;
using logicpilot::ir_v2_util::node_string_param;
using logicpilot::ir_v2_util::node_var;

constexpr EventType kArriveEvent = 20;
constexpr EventType kDepartEvent = 21;
constexpr EventType kFailureEvent = 22;
constexpr EventType kRepairEvent = 23;
constexpr EventType kTimeoutEvent = 24;
constexpr EventType kPoolFailureEvent = 25;
constexpr EventType kPoolRepairEvent = 26;

// ResourcePool spec: capacity plus the milestone-1 busy-time failure law.
struct PoolSpec {
  std::int64_t capacity{1};
  double failure_rate{0.0};
  double repair_rate{1.0};
};

// Spatial markup: nodes with coordinates plus the path network. `distances`
// holds all-pairs shortest paths over the nodes (inf when unreachable).
struct SpatialGraph {
  std::vector<std::string> node_names;
  std::unordered_map<std::string, NodePos> positions;
  std::vector<std::vector<double>> distances;
};

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

void fail(std::string* error, const std::string& message) {
  if (error != nullptr) {
    *error = message;
  }
}

// Numeric block params by name (condition-expression lookup context).
std::unordered_map<std::string, double> block_numeric_params(
    const Node* stage) {
  std::unordered_map<std::string, double> params;
  if (stage == nullptr || stage->params() == nullptr) {
    return params;
  }
  for (const ir::v2::Var* var : *stage->params()) {
    if (var == nullptr || var->name() == nullptr) {
      continue;
    }
    if (var->type() == ir::v2::VarType_Int) {
      params[var->name()->str()] = static_cast<double>(var->int_value());
    } else if (var->type() == ir::v2::VarType_Float) {
      params[var->name()->str()] = var->float_value();
    }
  }
  return params;
}

std::string block_string_param(const Node* stage, const char* name) {
  const char* value = node_string_param(stage, name);
  return value != nullptr ? std::string(value) : "";
}

// Read an expression-typed block field that may have been lowered as a raw
// text string (non-constant expression) or as a folded scalar (bool/int/
// float). Returns the fallback when the field is absent.
std::string block_expression_param(const Node* stage, const char* name,
                                   const char* fallback) {
  const char* text = node_string_param(stage, name);
  if (text != nullptr) {
    return text;
  }
  const ir::v2::Var* var = node_var(stage, name);
  if (var != nullptr) {
    switch (var->type()) {
      case ir::v2::VarType_Bool:
        return var->bool_value() ? "true" : "false";
      case ir::v2::VarType_Int:
        return std::to_string(var->int_value());
      case ir::v2::VarType_Float:
        return std::to_string(var->float_value());
      default:
        break;
    }
  }
  return fallback;
}

// Builds the modular block for one process-library stage, carrying over the
// pre-modular engine's parameter mapping verbatim.
std::unique_ptr<ProcessBlock> make_block(
    const Node* stage, const std::string& kind, const std::string& name,
    const std::unordered_map<std::string, PoolSpec>& pools,
    const SpatialGraph& spatial, std::string* error) {
  const auto pool_servers = [&](const char* resource_name) -> std::int64_t {
    const std::string pool = resource_name != nullptr ? resource_name : name;
    const auto it = pools.find(pool);
    return it != pools.end() ? it->second.capacity : 1;
  };
  if (kind == "source") {
    const std::string arrival_type = block_string_param(stage, "arrivalType");
    const bool manual = arrival_type == "manual";
    const bool interarrival = arrival_type == "interarrival_time";
    if (!arrival_type.empty() && arrival_type != "rate" && !interarrival &&
        !manual) {
      fail(error, "source '" + name + "' arrivalType '" + arrival_type +
                      "' is not executable yet; use rate, "
                      "interarrival_time, or manual");
      return nullptr;
    }
    const char* distribution_field =
        interarrival ? "interarrivalTime" : "arrival";
    TimeSampler sampler =
        make_sampler(node_dist_param(stage, distribution_field), error);
    if (!sampler) {
      return nullptr;
    }
    // Entity attribute defaults declared as `state <name> = <value>`.
    std::unordered_map<std::string, double> attributes;
    if (stage->state() != nullptr) {
      for (const ir::v2::Var* var : *stage->state()) {
        if (var == nullptr || var->name() == nullptr) {
          continue;
        }
        switch (var->type()) {
          case ir::v2::VarType_Int:
            attributes[var->name()->str()] =
                static_cast<double>(var->int_value());
            break;
          case ir::v2::VarType_Float:
            attributes[var->name()->str()] = var->float_value();
            break;
          case ir::v2::VarType_Bool:
            attributes[var->name()->str()] = var->bool_value() ? 1.0 : 0.0;
            break;
          default:
            break;
        }
      }
    }
    const bool multiple =
        node_bool_param(stage, "multipleEntitiesPerArrival", false);
    const std::int64_t agents_per_arrival =
        multiple ? std::max<std::int64_t>(
                       node_int_param(stage, "agentsPerArrival", 1), 1)
                 : 1;
    const std::int64_t max_arrival_events =
        node_bool_param(stage, "limitArrivals", false)
            ? std::max<std::int64_t>(node_int_param(stage, "maxArrivals", 0), 0)
            : -1;
    return std::make_unique<SourceBlock>(
        name, std::move(sampler), std::move(attributes),
        block_string_param(stage, "firstArrivalMode"),
        node_float_param(stage, "firstArrivalTime", 0.0), agents_per_arrival,
        max_arrival_events, manual);
  }
  if (kind == "delay") {
    TimeSampler sampler =
        make_sampler(node_dist_param(stage, "delayTime"), error);
    if (!sampler) {
      return nullptr;
    }
    std::int64_t capacity = node_int_param(stage, "capacity", 1);
    if (node_bool_param(stage, "maximumCapacity", false)) {
      capacity = -1;
    }
    return std::make_unique<DelayBlock>(name, std::move(sampler), capacity);
  }
  if (kind == "service") {
    TimeSampler sampler = make_sampler(node_dist_param(stage, "time"), error);
    if (!sampler) {
      return nullptr;
    }
    TimeSampler failure;
    TimeSampler repair;
    const char* resource = node_string_param(stage, "resource");
    const std::string pool = resource != nullptr ? resource : name;
    const auto it = pools.find(pool);
    if (it != pools.end() && it->second.failure_rate > 0.0) {
      const double f = it->second.failure_rate;
      const double r =
          it->second.repair_rate > 0.0 ? it->second.repair_rate : 1.0;
      failure = [f](Xoshiro256PlusPlus& engine) {
        Exponential<Xoshiro256PlusPlus> dist{f};
        return dist(engine);
      };
      repair = [r](Xoshiro256PlusPlus& engine) {
        Exponential<Xoshiro256PlusPlus> dist{r};
        return dist(engine);
      };
    }
    // Missing means legacy IR produced before Service exposed its internal
    // queue; preserve its zero-buffer behavior. The DSL registry lowers the
    // current catalog default explicitly as queueCapacity=100.
    std::int64_t queue_capacity = node_int_param(stage, "queueCapacity", 0);
    if (node_bool_param(stage, "maximumCapacity", false)) {
      queue_capacity = -1;
    }
    const std::int64_t units_per_task =
        std::max<std::int64_t>(node_int_param(stage, "numberOfUnits", 1), 1);
    const std::int64_t pool_capacity =
        pool_servers(node_string_param(stage, "resource"));
    // AnyLogic Service is Seize -> Delay -> Release: one task must acquire
    // all requested units before it can start. For the single-pool mode this
    // makes the number of concurrent tasks floor(pool capacity / units).
    const std::int64_t concurrent_tasks = pool_capacity / units_per_task;
    // Every declared ResourcePool is a single shared allocator. Failure
    // handling must not turn each Service reference into a private copy of
    // the pool, otherwise capacity and waiting semantics are violated.
    const bool shared_pool = it != pools.end();
    return std::make_unique<ServiceBlock>(
        name, concurrent_tasks,
        std::move(sampler), false, std::move(failure), std::move(repair),
        node_bool_param(stage, "enablePreemption", false),
        node_bool_param(stage, "taskMayPreempt", true),
        block_string_param(stage, "taskPreemptionPolicy"),
        node_float_param(stage, "taskPriority", 0.0), queue_capacity,
        to_ns(node_float_param(stage, "timeout", 100.0)),
        node_bool_param(stage, "enableTimeout", false), pool,
        units_per_task, pool_capacity, shared_pool);
  }
  if (kind == "seize") {
    const char* resource = node_string_param(stage, "resource");
    std::int64_t capacity = node_int_param(stage, "capacity", 100);
    if (node_bool_param(stage, "maximumCapacity", false)) {
      capacity = -1;
    }
    return std::make_unique<SeizeBlock>(
        name, resource != nullptr ? resource : name,
        node_int_param(stage, "numberOfUnits", 0), capacity,
        to_ns(node_float_param(stage, "timeout", 100.0)),
        node_bool_param(stage, "enableTimeout", false),
        node_bool_param(stage, "enablePreemption", false));
  }
  if (kind == "release") {
    return std::make_unique<ReleaseBlock>(name);
  }
  if (kind == "queue") {
    std::int64_t capacity = node_int_param(stage, "capacity", 100);
    if (node_bool_param(stage, "maximumCapacity", false)) {
      capacity = -1;
    }
    const std::string queuing = block_string_param(stage, "queuing");
    return std::make_unique<WaitBlock>(
        "queue", name, capacity,
        to_ns(node_float_param(stage, "timeout", 100.0)),
        node_bool_param(stage, "enableTimeout", false),
        queuing.empty() ? "queuing_fifo" : queuing,
        node_float_param(stage, "agentPriority", 0.0),
        node_bool_param(stage, "enablePreemption", false),
        block_string_param(stage, "agent1IsPreferredToAgent2"));
  }
  if (kind == "wait") {
    std::int64_t capacity = node_int_param(stage, "capacity", 100);
    if (node_bool_param(stage, "maximumCapacity", false)) {
      capacity = -1;
    }
    const std::string queuing = block_string_param(stage, "queuing");
    return std::make_unique<WaitBlock>(
        "wait", name, capacity,
        to_ns(node_float_param(stage, "timeout", 100.0)),
        node_bool_param(stage, "enableTimeout", false),
        queuing.empty() ? "queuing_fifo" : queuing,
        node_float_param(stage, "agentPriority", 0.0),
        node_bool_param(stage, "enablePreemption", false),
        block_string_param(stage, "agent1MayPreemptAgent2"));
  }
  if (kind == "sink") {
    return std::make_unique<SinkBlock>(name);
  }
  if (kind == "exit") {
    return std::make_unique<ExitBlock>(name);
  }
  if (kind == "enter") {
    return std::make_unique<EnterBlock>(name);
  }
  if (kind == "assembler") {
    const char* resource = node_string_param(stage, "resourcePool");
    return std::make_unique<AssemblerBlock>(
        name, to_ns(node_float_param(stage, "delayTime", 0.0)),
        node_int_param(stage, "quantity125", 1),
        resource != nullptr ? resource : "",
        node_int_param(stage, "numberOfUnits", 0));
  }
  if (kind == "moveTo") {
    const char* node_ref = node_string_param(stage, "node");
    double target_x = node_float_param(stage, "xYZ", 0.0);
    double target_y = 0.0;
    bool use_2d = false;
    std::vector<NodePos> node_coords;
    std::vector<double> dist_to_target;
    if (node_ref != nullptr) {
      const auto pos = spatial.positions.find(node_ref);
      if (pos != spatial.positions.end()) {
        target_x = pos->second.x;
        target_y = pos->second.y;
        use_2d = true;
        const auto target = std::find(spatial.node_names.begin(),
                                      spatial.node_names.end(), node_ref);
        if (target != spatial.node_names.end()) {
          const std::size_t target_index =
              static_cast<std::size_t>(target - spatial.node_names.begin());
          for (std::size_t i = 0; i < spatial.node_names.size(); ++i) {
            node_coords.push_back(spatial.positions.at(spatial.node_names[i]));
            const double d = spatial.distances[i][target_index];
            dist_to_target.push_back(d >= 1e18 ? -1.0 : d);
          }
        }
      }
    }
    return std::make_unique<MoveToBlock>(
        name, to_ns(node_float_param(stage, "tripTime", 0.0)),
        node_float_param(stage, "speed", 0.0), target_x, target_y, use_2d,
        std::move(node_coords), std::move(dist_to_target));
  }
  if (kind == "split") {
    return std::make_unique<GenericBlock>(
        kind, name, 0.5, node_int_param(stage, "copies", 2), false);
  }
  if (kind == "selectOutput") {
    return std::make_unique<GenericBlock>(
        kind, name, node_float_param(stage, "probability", 0.5), 2, false,
        block_string_param(stage, "condition"), "",
        block_numeric_params(stage));
  }
  if (kind == "selectOutput5") {
    std::vector<std::string> conditions;
    for (const char* field :
         {"condition1", "condition2", "condition3", "condition4"}) {
      conditions.push_back(block_expression_param(stage, field, ""));
    }
    std::vector<double> probabilities;
    for (const char* field : {"probability1", "probability2", "probability3",
                              "probability4", "probability5"}) {
      probabilities.push_back(node_float_param(stage, field, 0.2));
    }
    const char* type = node_string_param(stage, "type");
    return std::make_unique<SelectOutput5Block>(
        name, type != nullptr ? type : "probabilities", std::move(conditions),
        std::move(probabilities),
        block_expression_param(stage, "exitNumber", "1"),
        block_numeric_params(stage));
  }
  if (kind == "selectOutputIn") {
    // Routes each agent to one associated SelectOutputOut block (by
    // probability roll or the choice expression); the engine forwards it
    // through the chosen target's downstream.
    return std::make_unique<SelectOutputInBlock>(
        name, node_bool_param(stage, "conditionIsProbabilistic", true),
        block_expression_param(stage, "choice", "1"),
        block_numeric_params(stage));
  }
  if (kind == "selectOutputOut") {
    // Pure routing target of a SelectOutputIn; nothing enters it.
    return std::make_unique<SelectOutputOutBlock>(name);
  }
  if (kind == "hold") {
    const bool frozen = node_bool_param(stage, "initiallyBlocked", false) ||
                        node_bool_param(stage, "freeze", false);
    return std::make_unique<GenericBlock>(
        kind, name, 0.5, 2, frozen, "",
        block_string_param(stage, "blockingCondition"),
        block_numeric_params(stage));
  }
  if (kind == "batch") {
    return std::make_unique<BatchBlock>(
        name, node_int_param(stage, "batchSize", 10),
        node_bool_param(stage, "permanent", false));
  }
  if (kind == "unbatch") {
    return std::make_unique<UnbatchBlock>(name);
  }
  if (kind == "combine") {
    return std::make_unique<CombineBlock>(
        name, block_string_param(stage, "combineMode"));
  }
  if (kind == "match") {
    return std::make_unique<MatchBlock>(
        name, block_string_param(stage, "matchCondition"));
  }
  if (kind == "timeMeasureStart") {
    return std::make_unique<TimeMeasureStartBlock>(name);
  }
  if (kind == "timeMeasureEnd") {
    return std::make_unique<TimeMeasureEndBlock>(name);
  }
  // count / ... pass tokens through with counters maintained.
  return std::make_unique<GenericBlock>(kind, name, 0.5, 2, false);
}

// The generic engine: coordinates routing, scheduling and statistics while
// blocks (ProcessBlock implementations) express their own behavior.
class Engine final : public BlockContext {
 public:
  Engine(const std::vector<const Node*>& stages,
         const std::vector<const ir::v2::Coupling*>& couplings,
         const Node* root, std::string* error) {
    if (stages.empty()) {
      fail(error, "process flow has no blocks");
      return;
    }
    if (root != nullptr && root->children() != nullptr) {
      for (const Node* child : *root->children()) {
        if (child != nullptr && child->semantics() != nullptr &&
            child->semantics()->library() != nullptr &&
            child->semantics()->block() != nullptr &&
            std::strcmp(child->semantics()->library()->c_str(), "process") ==
                0 &&
            std::strcmp(child->semantics()->block()->c_str(), "resource") ==
                0) {
          const std::string name = child->metadata() != nullptr &&
                                           child->metadata()->name() != nullptr
                                       ? child->metadata()->name()->str()
                                       : "";
          resource_pools_[name] =
              PoolSpec{node_int_param(child, "capacity", 1),
                       node_float_param(child, "failure_rate", 0.0),
                       node_float_param(child, "repair_rate", 1.0)};
        }
        if (child != nullptr && child->semantics() != nullptr &&
            child->semantics()->library() != nullptr &&
            child->semantics()->block() != nullptr &&
            std::strcmp(child->semantics()->library()->c_str(), "core") == 0 &&
            std::strcmp(child->semantics()->block()->c_str(), "node") == 0) {
          const std::string node_name =
              child->metadata() != nullptr &&
                      child->metadata()->name() != nullptr
                  ? child->metadata()->name()->str()
                  : "";
          spatial_.positions[node_name] =
              NodePos{node_float_param(child, "x", 0.0),
                      node_float_param(child, "y", 0.0)};
        }
        if (child != nullptr && child->semantics() != nullptr &&
            child->semantics()->library() != nullptr &&
            child->semantics()->block() != nullptr &&
            std::strcmp(child->semantics()->library()->c_str(), "core") == 0 &&
            std::strcmp(child->semantics()->block()->c_str(), "path") == 0) {
          const char* node1 = node_string_param(child, "node1");
          const char* node2 = node_string_param(child, "node2");
          if (node1 != nullptr && node2 != nullptr) {
            path_edges_.push_back({node1, node2});
          }
        }
      }
    }
    build_spatial_graph();
    for (const Node* stage : stages) {
      if (stage == nullptr || stage->semantics() == nullptr ||
          stage->semantics()->block() == nullptr ||
          stage->metadata() == nullptr ||
          stage->metadata()->name() == nullptr) {
        continue;
      }
      const std::string name = stage->metadata()->name()->str();
      const std::string kind = stage->semantics()->block()->str();
      auto block =
          make_block(stage, kind, name, resource_pools_, spatial_, error);
      if (block == nullptr) {
        return;
      }
      const std::string pool_resource = block->pool_resource();
      index_[name] = blocks_.size();
      if (kind == "source") {
        sources_.push_back(blocks_.size());
      }
      if (!block->pool_resource().empty()) {
        resource_waiters_.push_back(blocks_.size());
      }
      blocks_.push_back(std::move(block));
    }
    if (blocks_.empty()) {
      fail(error, "process flow has no executable blocks");
      return;
    }
    if (sources_.empty()) {
      fail(error, "process flow has no source block");
      return;
    }
    // Pool failure support: Service consumers interrupt their in-service
    // tasks on pool down and restart them (preemptive-repeat) on repair;
    // Seize/Assembler consumers gate new grants while the pool is down but
    // never interrupt units already held (AnyLogic's "No preemption"
    // default for seize-held tasks - the failure waits for the unit).
    // Port-aware couplings.
    if (!couplings.empty()) {
      for (const ir::v2::Coupling* coupling : couplings) {
        if (coupling == nullptr || coupling->from_model() == nullptr ||
            coupling->to_model() == nullptr) {
          continue;
        }
        const std::string from = coupling->from_model()->str();
        const std::string to = coupling->to_model()->str();
        const auto from_it = index_.find(from);
        const auto to_it = index_.find(to);
        if (from_it == index_.end() || to_it == index_.end()) {
          fail(error, "coupling references an unknown stage");
          return;
        }
        const std::string from_port = coupling->from_port() != nullptr
                                          ? coupling->from_port()->str()
                                          : "out";
        const std::string to_port =
            coupling->to_port() != nullptr ? coupling->to_port()->str() : "in";
        // A process output port has exactly one downstream (fan-out requires
        // an explicit split block). The compiler rejects fan-out (LP5007);
        // hand-built IR is rejected here so the same entity id can never be
        // pushed into several branches (which would double-count departures
        // and drive in_system negative).
        for (const Edge& edge : out_edges_[from_it->second]) {
          if (edge.from_port == from_port) {
            fail(error, "process output port '" + from + "." + from_port +
                            "' connects to multiple downstream blocks; "
                            "fan-out is not implicit - use a split block");
            return;
          }
        }
        out_edges_[from_it->second].push_back(
            {to_it->second, from_port, to_port});
        in_edges_[to_it->second].push_back(from_it->second);
      }
    } else {
      for (std::size_t i = 0; i + 1 < blocks_.size(); ++i) {
        out_edges_[i].push_back({i + 1, "out", "in"});
        in_edges_[i + 1].push_back(i);
      }
    }
    // SelectOutputIn/Out logical association (AnyLogic): each
    // SelectOutputOut declares its owning SelectOutputIn by name; the
    // engine hands every SelectOutputIn the sorted list of its targets
    // ({name, probability}) for routing.
    std::unordered_map<std::string, std::vector<std::pair<std::string, double>>>
        in_targets;
    for (const Node* stage : stages) {
      if (stage == nullptr || stage->metadata() == nullptr ||
          stage->metadata()->name() == nullptr ||
          stage->semantics() == nullptr ||
          stage->semantics()->block() == nullptr ||
          stage->semantics()->block()->str() != "selectOutputOut") {
        continue;
      }
      const char* in_name = node_string_param(stage, "selectOutputIn");
      if (in_name == nullptr) {
        continue;
      }
      in_targets[in_name].push_back(
          {stage->metadata()->name()->str(),
           node_float_param(stage, "probability", 1.0)});
    }
    for (std::size_t i = 0; i < blocks_.size(); ++i) {
      if (blocks_[i]->kind() != "selectOutputIn") {
        continue;
      }
      const auto it = in_targets.find(std::string(blocks_[i]->name()));
      if (it != in_targets.end()) {
        blocks_[i]->set_routing_targets(it->second);
      }
    }
  }

  [[nodiscard]] bool valid() const { return valid_; }

  std::vector<BlockSnapshot> block_snapshots() const {
    std::vector<BlockSnapshot> out;
    out.reserve(blocks_.size());
    for (const auto& block : blocks_) {
      BlockSnapshot snapshot;
      snapshot.name = std::string(block->name());
      snapshot.kind = std::string(block->kind());
      snapshot.buffered = static_cast<std::int64_t>(block->buffered());
      snapshot.in_service = block->busy_units();
      snapshot.arrived = block->arrived();
      snapshot.departed = block->departed();
      out.push_back(std::move(snapshot));
    }
    return out;
  }

  bool has_pending_events() { return !scheduler().empty(); }

  bool inject_source(const std::string& source_name, std::uint64_t count) {
    const auto it = index_.find(source_name);
    if (it == index_.end() || !blocks_[it->second]->source_is_manual()) {
      return false;
    }
    const std::size_t source = it->second;
    const std::uint64_t requested = std::max<std::uint64_t>(count, 1);
    bool accepted = false;
    manual_injection_ = true;
    for (std::uint64_t i = 0; i < requested; ++i) {
      if (arrival_events_ >= config_.arrivals) break;
      on_arrive(Event{clock().now(), 0, arrive_handler_, source});
      accepted = true;
    }
    manual_injection_ = false;
    return accepted;
  }

  // Exact engine clock time: advanced only to real event times.
  [[nodiscard]] std::int64_t now_ns() const { return clock().now().as_ns(); }

  // Build the spatial graph: nodes in stable order, path edges weighted by
  // Euclidean distance, all-pairs shortest paths (Floyd-Warshall).
  void build_spatial_graph() {
    for (const auto& [name, pos] : spatial_.positions) {
      spatial_.node_names.push_back(name);
    }
    std::sort(spatial_.node_names.begin(), spatial_.node_names.end());
    std::unordered_map<std::string, std::size_t> index;
    for (std::size_t i = 0; i < spatial_.node_names.size(); ++i) {
      index[spatial_.node_names[i]] = i;
    }
    const std::size_t n = spatial_.node_names.size();
    const double inf = 1e18;
    spatial_.distances.assign(n, std::vector<double>(n, inf));
    for (std::size_t i = 0; i < n; ++i) {
      spatial_.distances[i][i] = 0.0;
    }
    for (const auto& [a, b] : path_edges_) {
      const auto ia = index.find(a);
      const auto ib = index.find(b);
      if (ia == index.end() || ib == index.end()) {
        continue;
      }
      const NodePos& pa = spatial_.positions[a];
      const NodePos& pb = spatial_.positions[b];
      const double dx = pa.x - pb.x;
      const double dy = pa.y - pb.y;
      const double weight = std::sqrt(dx * dx + dy * dy);
      spatial_.distances[ia->second][ib->second] =
          std::min(spatial_.distances[ia->second][ib->second], weight);
      spatial_.distances[ib->second][ia->second] =
          spatial_.distances[ia->second][ib->second];
    }
    for (std::size_t k = 0; k < n; ++k) {
      for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t j = 0; j < n; ++j) {
          const double via =
              spatial_.distances[i][k] + spatial_.distances[k][j];
          if (via < spatial_.distances[i][j]) {
            spatial_.distances[i][j] = via;
          }
        }
      }
    }
  }

  // Kernel-driven mode: schedule into the kernel's clock/scheduler/handler
  // registry instead of per-engine owned facilities (SimulationKernel).
  // Switching to a different context first cancels every event this engine
  // still owns on the OLD scheduler - EventTokens carry no scheduler
  // identity, so cancelling them on the new scheduler could hit unrelated
  // events of the new context.
  void attach(RuntimeContext& context) {
    if (external_ != &context) {
      // This also covers owned -> external migration after an owned run. A
      // never-reset owned engine has no scheduler or tokens to cancel.
      if (external_ != nullptr || owned_scheduler_ != nullptr) {
        cancel_all_pending_events();
      }
      // Source tokens are cleared by cancel_all_pending_events(). Clear the
      // remaining bookkeeping before switching schedulers so reset() cannot
      // replay old tokens against the new scheduler and cancel unrelated
      // events whose scheduler-local id/generation happens to collide.
      depart_tokens_.clear();
      block_event_tokens_.clear();
      pool_failure_tokens_.clear();
      pool_repair_tokens_.clear();
      external_ = &context;
      handlers_owner_ = nullptr;  // re-register against the new registry
    }
  }

  void reset(const ReplicationConfig& config) {
    config_ = config;
    warmup_ = config.warmup_arrivals;
    engine_ = Xoshiro256PlusPlus{config.seed};
    if (external_ == nullptr) {
      // Owned facilities are replaced wholesale: stale events die with the
      // old scheduler/registry, so their tokens must NOT be cancelled (the
      // tokens reference the old scheduler's memory). The handlers are
      // re-registered against the fresh registry.
      owned_scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
      owned_clock_ = SimulationClock{};
      owned_handlers_ = EventHandlerRegistry{};
      handlers_owner_ = nullptr;  // re-register against the fresh registry
    } else {
      // External (kernel-owned) scheduler/clock/registry are shared and
      // survive across resets: every event this engine still owns must be
      // cancelled HERE, otherwise run_until would pop the stale events and
      // advance the shared clock before their no-op handlers run.
      cancel_all_pending_events();
    }
    emitted_ = 0;
    arrival_events_ = 0;
    depart_tokens_.clear();
    block_event_tokens_.clear();
    source_arrival_events_.assign(blocks_.size(), 0);
    source_arrival_tokens_.assign(blocks_.size(), EventToken{});
    source_exhausted_.assign(blocks_.size(), false);
    departures_ = 0;
    in_system_ = 0;
    last_ns_ = 0;
    area_system_ns_ = 0;
    sojourn_sum_ = 0.0;
    sojourn_count_ = 0;
    wait_sum_ = 0.0;
    wait_count_ = 0;
    measure_sum_ = 0.0;
    measure_count_ = 0;
    servers_total_ = 0;
    available_.clear();
    pool_busy_.clear();
    pool_down_.clear();
    pool_down_units_.clear();
    // Generations are NOT reset to zero: bumping every declared pool keeps
    // any maintenance event that somehow survived the cancellation from
    // matching the new run's generation, so its handler stays inert. This
    // is a second line of defence only - it cannot undo the clock
    // advancement run_until performs before dispatching, which is why
    // reset() cancels the events themselves first.
    for (const auto& [resource, spec] : resource_pools_) {
      pool_gen_[resource] += 1;
    }
    pool_failure_tokens_.clear();
    pool_repair_tokens_.clear();
    pool_down_area_.clear();
    pool_busy_area_.clear();
    pool_order_.clear();
    pool_index_.clear();
    std::unordered_set<std::string> shared_pools;
    for (auto& block : blocks_) {
      block->clear_buffers();
      block->reset_stats();
      const std::string resource = block->pool_resource();
      if (resource.empty()) {
        servers_total_ += block->pool_capacity();
      } else {
        shared_pools.insert(resource);
      }
    }
    // A shared ResourcePool contributes once even when several Service,
    // Seize, or Assembler blocks reference it.
    for (const std::string& resource : shared_pools) {
      const auto it = resource_pools_.find(resource);
      if (it != resource_pools_.end()) {
        servers_total_ += it->second.capacity;
      }
    }
    for (const auto& [resource, spec] : resource_pools_) {
      available_[resource] = spec.capacity;
      pool_order_.push_back(resource);
      pool_index_[resource] = pool_order_.size() - 1;
    }
    ensure_handlers_registered();
    for (const std::size_t source : sources_) {
      if (blocks_[source]->source_is_manual() ||
          blocks_[source]->max_arrival_events() == 0 ||
          arrival_events_ >= config_.arrivals) {
        source_exhausted_[source] = true;
        continue;
      }
      const double gap = blocks_[source]->sample_first_gap(engine_);
      if (std::isfinite(gap) && gap >= 0.0) {
        schedule_source_arrival(
            source, clock().now() + SimTime::from_ns(to_ns(gap)));
      } else {
        // No valid first gap: this source will never produce an arrival.
        source_exhausted_[source] = true;
      }
    }
  }

  // Handlers are registered exactly once per (registry identity, epoch):
  // reset() replaces the owned registry, attach() switches to another
  // context's registry, and a registry clear() bumps its epoch - each of
  // these invalidates previously obtained HandlerIds, so the handlers are
  // re-registered against the current registry before use. Repeated resets
  // against the same registry do not accumulate duplicate handlers.
  void ensure_handlers_registered() {
    if (handlers_owner_ == &handlers() &&
        handlers_epoch_ == handlers().epoch()) {
      return;
    }
    depart_handler_ =
        handlers().add([this](const Event& event) { on_depart(event); });
    failure_handler_ =
        handlers().add([this](const Event& event) { on_failure(event); });
    repair_handler_ =
        handlers().add([this](const Event& event) { on_repair(event); });
    timeout_handler_ =
        handlers().add([this](const Event& event) { on_timeout(event); });
    pool_failure_handler_ =
        handlers().add([this](const Event& event) { on_pool_failure(event); });
    pool_repair_handler_ =
        handlers().add([this](const Event& event) { on_pool_repair(event); });
    arrive_handler_ =
        handlers().add([this](const Event& event) { on_arrive(event); });
    handlers_owner_ = &handlers();
    handlers_epoch_ = handlers().epoch();
  }

  std::size_t advance(SimTime until, TraceRecorder* trace) {
    return run_until(scheduler(), clock(), until, [&](const Event& event) {
      if (trace != nullptr) {
        trace->record(event.at, event.type, event.payload);
      }
      handlers().dispatch(event);
      // As soon as the run's business is over (every external arrival
      // produced, no entity left in the system), cancel any pending pool
      // maintenance events. run_until advances the clock to every popped
      // event's time before dispatching, so tail failure/repair events
      // must be removed from the scheduler HERE - a handler-level check
      // would come too late and still drag the horizon to the repair
      // time. A plain idle gap (business not finished) never triggers
      // this, so an in-flight repair always completes.
      cancel_tail_maintenance();
    });
  }

  // Cancel pending pool failure/repair and block-level failure/repair/
  // timeout events once the model's business has truly terminated. They
  // carry no business meaning afterwards and must not advance the clock or
  // the area integrals. With in_system == 0 no waiting entity can own a
  // valid timeout (timeouts belong to entities still in the waiting area),
  // so any residual block event here is a stale tail event - but the
  // cancellation is what prevents run_until from popping it, not the
  // in_system check.
  void cancel_tail_maintenance() {
    if (!business_finished()) {
      return;
    }
    for (const auto& [resource, token] : pool_failure_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    pool_failure_tokens_.clear();
    for (const auto& [resource, token] : pool_repair_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    pool_repair_tokens_.clear();
    for (const auto& [key, token] : block_event_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    block_event_tokens_.clear();
  }

  ReplicationMetrics metrics() const {
    ReplicationMetrics metrics;
    // All entity births, including split copies (each copy is a new entity
    // counted on creation and leaves exactly once, keeping arrivals ==
    // departures). The external Source arrival count is tracked separately
    // by arrival_events_ and drives warm-up via Entity.root_arrival_index.
    metrics.arrivals = emitted_;
    metrics.departures = departures_;
    const std::int64_t horizon_ns = clock().now().as_ns();
    metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
    metrics.throughput = horizon_ns > 0 ? static_cast<double>(departures_) /
                                              metrics.horizon_seconds
                                        : 0.0;
    metrics.mean_in_system = horizon_ns > 0
                                 ? static_cast<double>(area_system_ns_) /
                                       static_cast<double>(horizon_ns)
                                 : 0.0;
    double queue_area = 0.0;
    double busy_area = 0.0;
    for (const auto& block : blocks_) {
      queue_area += block->area_occupancy();
      if (block->pool_resource().empty()) {
        busy_area += block->area_busy();
      }
    }
    for (const auto& [resource, area] : pool_busy_area_) {
      (void)resource;
      busy_area += area;
    }
    metrics.mean_in_queue =
        horizon_ns > 0 ? queue_area / static_cast<double>(horizon_ns) : 0.0;
    metrics.mean_sojourn =
        sojourn_count_ == 0
            ? 0.0
            : sojourn_sum_ / static_cast<double>(sojourn_count_);
    metrics.mean_wait =
        wait_count_ == 0 ? 0.0 : wait_sum_ / static_cast<double>(wait_count_);
    metrics.mean_measure =
        measure_count_ == 0
            ? 0.0
            : measure_sum_ / static_cast<double>(measure_count_);
    metrics.measure_count = measure_count_;
    if (horizon_ns > 0 && servers_total_ > 0) {
      metrics.utilization = busy_area / static_cast<double>(horizon_ns) /
                            static_cast<double>(servers_total_);
      double down_area = 0.0;
      for (const auto& block : blocks_) {
        // Pool-wide busy-time failure: every declared pool contributes its
        // downtime through pool_down_area_ (scaled by the held units). Blocks
        // without a declared pool have no failure clock.
        if (block->pool_resource().empty()) {
          down_area += block->area_down();
        }
      }
      for (const auto& [resource, area] : pool_down_area_) {
        down_area += area;
      }
      metrics.availability = 1.0 - down_area / static_cast<double>(horizon_ns) /
                                       static_cast<double>(servers_total_);
    }
    metrics.blocks.reserve(blocks_.size());
    for (std::size_t block_index = 0; block_index < blocks_.size();
         ++block_index) {
      const auto& block = blocks_[block_index];
      BlockMetrics item;
      item.name = std::string(block->name());
      item.kind = std::string(block->kind());
      const std::uint64_t source_count =
          item.kind == "source"
              ? source_arrival_events_[block_index] *
                    static_cast<std::uint64_t>(block->agents_per_arrival())
              : 0;
      item.arrived = item.kind == "source" ? source_count : block->arrived();
      item.departed =
          item.kind == "source" ? source_count : block->departed();
      item.timed_out = block->timed_out();
      item.preempted = block->preempted();
      item.capacity = block->buffer_capacity();
      if (horizon_ns > 0) {
        const double horizon = static_cast<double>(horizon_ns);
        item.mean_occupancy =
            (item.kind == "delay" ? block->area_busy()
                                  : block->area_occupancy()) /
            horizon;
        std::int64_t utilization_capacity = block->pool_capacity();
        if (item.kind == "delay") {
          utilization_capacity = block->buffer_capacity();
        }
        if (utilization_capacity > 0) {
          item.utilization = block->area_busy() / horizon /
                             static_cast<double>(utilization_capacity);
          item.availability =
              1.0 - block->area_down() / horizon /
                        static_cast<double>(utilization_capacity);
        }
      }
      metrics.blocks.push_back(std::move(item));
    }
    return metrics;
  }

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) {
    reset(config);
    advance(SimTime::infinity(), trace);
    const ReplicationMetrics metrics = this->metrics();
    if (trace != nullptr) {
      trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_sojourn));
      trace->absorb(departures_);
    }
    return metrics;
  }

  // --- BlockContext ------------------------------------------------------

  [[nodiscard]] SimTime now() const override { return clock().now(); }

  [[nodiscard]] Xoshiro256PlusPlus& rng() override { return engine_; }

  double rng01() override {
    return static_cast<double>(engine_()) / static_cast<double>(UINT64_MAX);
  }

  bool emit(const Entity& entity, const char* port) override {
    return push_downstream(current_, entity, port);
  }

  bool emit_via(const Entity& entity, const char* target_block) override {
    const auto it = index_.find(target_block);
    if (it == index_.end() || it->second >= blocks_.size()) {
      return false;
    }
    return push_downstream(it->second, entity, "out");
  }

  Entity spawn(const Entity& templ) override {
    Entity clone = templ;
    clone.id = emitted_;
    clone.created_ns = clock().now().as_ns();
    clone.service_start_ns = clone.created_ns;
    clone.contents.clear();
    clone.resources.clear();
    clone.has_measure = false;
    ++emitted_;
    ++in_system_;
    return clone;
  }

  void schedule_depart(std::int64_t hold_ns, std::uint64_t entity_id) override {
    const EventToken token =
        scheduler().schedule(clock().now() + SimTime::from_ns(hold_ns),
                             kDepartEvent, depart_handler_,
                             self_payload(current_, entity_id));
    if (token.valid()) {
      depart_tokens_[self_payload(current_, entity_id)] = token;
    }
  }

  void cancel_depart(std::uint64_t entity_id) override {
    const auto it = depart_tokens_.find(self_payload(current_, entity_id));
    if (it == depart_tokens_.end()) {
      return;
    }
    scheduler().cancel(it->second);
    depart_tokens_.erase(it);
  }

  void schedule_failure(std::int64_t hold_ns,
                        std::uint64_t entity_id) override {
    schedule_block_event(kFailureEvent, hold_ns,
                         self_payload(current_, entity_id));
  }

  void schedule_repair(std::int64_t hold_ns, std::uint64_t entity_id) override {
    schedule_block_event(kRepairEvent, hold_ns,
                         self_payload(current_, entity_id));
  }

  void schedule_timeout(std::int64_t hold_ns,
                        std::uint64_t entity_id) override {
    schedule_block_event(kTimeoutEvent, hold_ns,
                         self_payload(current_, entity_id));
  }

  void cancel_timeout(std::uint64_t entity_id) override {
    cancel_block_event(kTimeoutEvent, self_payload(current_, entity_id));
  }

  // Block-level failure/repair/timeout events share one pending-token map
  // keyed by (event type, payload), so a timeout can never overwrite or
  // erase a failure/repair token of the same block/entity and vice versa.
  // Re-scheduling the same (type, payload) first cancels the old token so a
  // stale event cannot linger after a re-arm.
  void schedule_block_event(EventType type, std::int64_t hold_ns,
                            std::uint64_t payload) {
    const auto key = std::make_pair(type, payload);
    const auto existing = block_event_tokens_.find(key);
    if (existing != block_event_tokens_.end() && existing->second.valid()) {
      scheduler().cancel(existing->second);
    }
    block_event_tokens_[key] = scheduler().schedule(
        clock().now() + SimTime::from_ns(hold_ns), type,
        type == kFailureEvent ? failure_handler_
        : type == kRepairEvent  ? repair_handler_
                                : timeout_handler_,
        payload);
  }

  void cancel_block_event(EventType type, std::uint64_t payload) {
    const auto key = std::make_pair(type, payload);
    const auto it = block_event_tokens_.find(key);
    if (it != block_event_tokens_.end() && it->second.valid()) {
      scheduler().cancel(it->second);
    }
    block_event_tokens_.erase(key);
  }

  void leave_system(const Entity& entity) override {
    ++departures_;
    --in_system_;
    if (entity.root_arrival_index >= warmup_) {
      sojourn_sum_ +=
          static_cast<double>(clock().now().as_ns() - entity.created_ns) * 1e-9;
      ++sojourn_count_;
    }
  }

  void record_service_wait(const Entity& entity) override {
    if (entity.root_arrival_index >= warmup_) {
      wait_sum_ +=
          static_cast<double>(entity.service_start_ns - entity.created_ns) *
          1e-9;
      ++wait_count_;
    }
  }

  bool try_seize(const std::string& resource, std::int64_t quantity) override {
    if (pool_down_[resource]) {
      return false;  // the pool is down for repair
    }
    const auto it = available_.find(resource);
    if (it == available_.end()) {
      // No declared pool: default to a single unit (mirrors the service
      // fallback when `resource = R` is absent).
      available_[resource] = 1;
    }
    std::int64_t& units = available_[resource];
    if (units < quantity) {
      return false;
    }
    units -= quantity;
    const std::int64_t before = pool_busy_[resource];
    pool_busy_[resource] = before + quantity;
    if (before == 0 && pool_failure_rate(resource) > 0.0) {
      // A busy period starts (pool_busy_ 0 -> positive): any pending TTF
      // from an earlier period is stale, so cancel it and bump the
      // generation (double invalidation - a cancelled event that already
      // left the scheduler must still fail its generation check), then arm
      // the pool's failure clock.
      cancel_pool_failure(resource);
      pool_gen_[resource] += 1;
      schedule_pool_failure(resource);
    }
    return true;
  }

  void release_resources(const std::string& resource,
                         std::int64_t quantity) override {
    available_[resource] += quantity;
    const std::int64_t busy = pool_busy_[resource] - quantity;
    pool_busy_[resource] = busy > 0 ? busy : 0;
    if (busy <= 0 && pool_failure_rate(resource) > 0.0) {
      if (pool_down_[resource]) {
        // The pool is down and the repair is still pending: releasing the
        // last held unit must NOT cancel the repair, clear the down state,
        // or bump the generation (that would invalidate the pending repair
        // event, which carries the generation from failure time). Later
        // requests keep waiting until the repair actually fires. Only a
        // stray TTF (none should exist while down) is invalidated
        // defensively - without a generation bump it stays invalid because
        // no failure clock is armed while down.
        cancel_pool_failure(resource);
      } else {
        // Normal busy period end (pool up): stop the failure clock for the
        // idle gap - cancel the pending TTF and bump the generation so any
        // event that already left the scheduler fails its validity check
        // before touching the clock/areas.
        cancel_pool_failure(resource);
        pool_gen_[resource] += 1;
      }
    }
    // A freed unit may unblock any Service/Seize/Assembler sharing the pool.
    for (const std::size_t waiter : resource_waiters_) {
      work_.push_back(waiter);
    }
  }

  bool downstream_accepts(const Entity& entity, const char* port) override {
    const auto it = out_edges_.find(current_);
    if (it == out_edges_.end() || it->second.empty()) {
      return true;  // no downstream on this port: the entity leaves
    }
    for (const Edge& edge : it->second) {
      if (edge.from_port != port) {
        continue;
      }
      if (!blocks_[edge.to]->can_accept(entity)) {
        return false;
      }
    }
    return true;
  }

  void record_measure(const Entity& entity, double seconds) override {
    if (entity.root_arrival_index >= warmup_) {
      measure_sum_ += seconds;
      ++measure_count_;
    }
  }

 private:
  struct Edge {
    std::size_t to;
    std::string from_port;
    std::string to_port;
  };

  void accumulate_areas(std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns_;
    if (dt <= 0) {
      return;
    }
    area_system_ns_ += dt * static_cast<std::int64_t>(in_system_);
    for (auto& block : blocks_) {
      block->accumulate_areas(dt);
    }
    for (const auto& [resource, spec] : resource_pools_) {
      pool_busy_area_[resource] +=
          static_cast<double>(dt) * static_cast<double>(pool_busy_[resource]);
      if (spec.failure_rate > 0.0 && pool_down_[resource]) {
        // Unit-seconds down: the units that failed at the start of the down
        // period count until the repair, even if held tasks release early.
        pool_down_area_[resource] +=
            static_cast<double>(dt) *
            static_cast<double>(pool_down_units_[resource]);
      }
    }
    last_ns_ = now_ns;
  }

  void on_arrive(const Event& event) {
    const std::size_t source = static_cast<std::size_t>(event.payload);
    // Consume this source's pending arrival token (this event was just
    // popped; the token is cleared before a new one is scheduled below, so
    // a stale event from a previous generation can never clear a newer
    // token).
    source_arrival_tokens_[source] = EventToken{};
    accumulate_areas(clock().now().as_ns());
    const std::int64_t source_limit = blocks_[source]->max_arrival_events();
    if (arrival_events_ >= config_.arrivals) {
      // Global arrivals cap reached: this is a stale pre-scheduled arrival
      // from another source's perspective - it must not create entities.
      // All other pending arrivals are invalid too: cancel them so they
      // can never advance the clock (they would otherwise be popped by
      // run_until and push the horizon to their future times).
      cancel_all_pending_source_arrivals();
      return;
    }
    if (source_limit >= 0 &&
        source_arrival_events_[source] >=
            static_cast<std::uint64_t>(source_limit)) {
      // This source's own limit is reached (stale pre-scheduled event).
      source_exhausted_[source] = true;
      return;
    }
    ++arrival_events_;
    ++source_arrival_events_[source];
    // Warm-up is decided by the external arrival ordinal, so split
    // copies (which get fresh unique ids but inherit this index) can
    // never pull entities across the warm-up boundary.
    const std::uint64_t arrival_index = arrival_events_ - 1;
    const std::int64_t batch = blocks_[source]->agents_per_arrival();
    for (std::int64_t i = 0; i < batch; ++i) {
      Entity entity;
      entity.id = emitted_;
      entity.root_arrival_index = arrival_index;
      entity.created_ns = clock().now().as_ns();
      entity.service_start_ns = entity.created_ns;
      entity.attributes = blocks_[source]->attribute_defaults();
      ++emitted_;
      ++in_system_;
      current_ = source;
      if (!downstream_accepts(entity, "out") ||
          !push_downstream(source, entity, "out")) {
        blocks_[source]->receive(entity);
      }
      pump(source);
    }
    if (manual_injection_) {
      if (arrival_events_ >= config_.arrivals) {
        cancel_all_pending_source_arrivals();
        source_exhausted_[source] = true;
      }
      return;
    }
    const bool global_ok = arrival_events_ < config_.arrivals;
    const bool local_ok =
        source_limit < 0 ||
        source_arrival_events_[source] <
            static_cast<std::uint64_t>(source_limit);
    if (!global_ok) {
      // The cap was reached by this arrival: pending arrivals scheduled by
      // other sources are now invalid - cancel them so the scheduler
      // drains at the business end.
      cancel_all_pending_source_arrivals();
      source_exhausted_[source] = true;
      return;
    }
    if (!local_ok) {
      source_exhausted_[source] = true;  // own limit reached
      return;
    }
    const double gap = blocks_[source]->sample_gap(engine_);
    if (std::isfinite(gap) && gap > 0.0) {
      schedule_source_arrival(
          source, clock().now() + SimTime::from_ns(to_ns(gap)));
    } else {
      // The sampler stopped yielding a positive finite gap: this source
      // will never produce another arrival.
      source_exhausted_[source] = true;
    }
  }

  void on_depart(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload >> 32);
    const std::uint64_t entity_id = event.payload & 0xFFFFFFFFu;
    depart_tokens_.erase(event.payload);
    accumulate_areas(clock().now().as_ns());
    current_ = block;
    blocks_[block]->complete(*this, entity_id);
    pump(block);
  }

  void on_failure(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload >> 32);
    const std::uint64_t entity_id = event.payload & 0xFFFFFFFFu;
    block_event_tokens_.erase(std::make_pair(kFailureEvent, event.payload));
    accumulate_areas(clock().now().as_ns());
    current_ = block;
    blocks_[block]->on_failure(*this, entity_id);
    pump(block);
  }

  void on_repair(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload >> 32);
    const std::uint64_t entity_id = event.payload & 0xFFFFFFFFu;
    block_event_tokens_.erase(std::make_pair(kRepairEvent, event.payload));
    accumulate_areas(clock().now().as_ns());
    current_ = block;
    blocks_[block]->on_repair(*this, entity_id);
    pump(block);
  }

  void on_timeout(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload >> 32);
    const std::uint64_t entity_id = event.payload & 0xFFFFFFFFu;
    block_event_tokens_.erase(std::make_pair(kTimeoutEvent, event.payload));
    accumulate_areas(clock().now().as_ns());
    current_ = block;
    blocks_[block]->on_timeout(*this, entity_id);
    pump(block);
  }

  // Pool-wide busy-time failure (AnyLogic ResourcePool, MVP boundary): one
  // clock per declared pool, running while any unit is held (by Seize,
  // Service, or Assembler). While down, no new grants are issued; Service
  // consumers interrupt their in-service tasks (preemptive-repeat on
  // repair), while Seize/Assembler consumers keep holding their units
  // (AnyLogic's "No preemption" default - the failure task waits for the
  // unit). Per-unit failure clocks are not modeled yet.
  double pool_failure_rate(const std::string& resource) const {
    const auto it = resource_pools_.find(resource);
    return it != resource_pools_.end() ? it->second.failure_rate : 0.0;
  }

  // True when this source will never produce another external arrival:
  // manual sources, sources with maxArrivals == 0, sources whose own
  // arrival limit is reached, the global arrivals cap reached, or the
  // inter-arrival sampler stopped yielding a positive finite gap.
  bool source_done(std::size_t source) const {
    if (source_exhausted_[source]) {
      return true;
    }
    const ProcessBlock& block = *blocks_[source];
    if (block.source_is_manual() || block.max_arrival_events() == 0) {
      return true;
    }
    if (block.max_arrival_events() > 0 &&
        source_arrival_events_[source] >=
            static_cast<std::uint64_t>(block.max_arrival_events())) {
      return true;
    }
    if (arrival_events_ >= config_.arrivals) {
      return true;
    }
    return false;
  }

  // True when the finite run's business is over: no Source can produce
  // another external arrival (all are exhausted), no valid pending Source
  // arrival exists, and no entity remains in the system (so no depart /
  // timeout / measure business event can be pending). Pool maintenance
  // events firing after this point are tail events with no business
  // meaning - they are dropped/cancelled without touching the clock, the
  // area integrals, or the pool state, so the reported horizon is the
  // exact business end. This is deliberately NOT pool_busy_ == 0: an
  // ordinary idle gap between arrivals (a pending arrival token, or a
  // source that can still fire) must still let an in-flight repair
  // complete (see the lifecycle tests).
  bool business_finished() const {
    if (in_system_ != 0) {
      return false;
    }
    for (const std::size_t source : sources_) {
      if (source_arrival_tokens_[source].valid()) {
        return false;  // a future arrival is still pending
      }
      if (!source_done(source)) {
        return false;  // this source can still produce an arrival
      }
    }
    return true;
  }

  void schedule_source_arrival(std::size_t source, SimTime at) {
    source_arrival_tokens_[source] =
        scheduler().schedule(at, kArriveEvent, arrive_handler_, source);
  }

  void cancel_source_arrival(std::size_t source) {
    const EventToken token = source_arrival_tokens_[source];
    if (token.valid()) {
      scheduler().cancel(token);
    }
    source_arrival_tokens_[source] = EventToken{};
  }

  // Cancel every pending source arrival (used when the global arrivals cap
  // is reached: events already scheduled by other sources would otherwise
  // still be popped by run_until, advancing the shared clock before their
  // no-op handlers run).
  void cancel_all_pending_source_arrivals() {
    for (std::size_t i = 0; i < source_arrival_tokens_.size(); ++i) {
      cancel_source_arrival(i);
    }
  }

  // Cancel every event this engine owns in the (possibly shared, external)
  // scheduler: source arrivals, departures, block-level
  // failure/repair/timeout, and pool failure/repair. Called by reset() in
  // external scheduler mode so stale events from a previous replication
  // can never advance the shared clock (run_until advances the clock
  // before dispatching, so a handler-level stale check comes too late).
  void cancel_all_pending_events() {
    for (std::size_t i = 0; i < source_arrival_tokens_.size(); ++i) {
      cancel_source_arrival(i);
    }
    for (const auto& [payload, token] : depart_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    for (const auto& [key, token] : block_event_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    for (const auto& [resource, token] : pool_failure_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
    for (const auto& [resource, token] : pool_repair_tokens_) {
      if (token.valid()) {
        scheduler().cancel(token);
      }
    }
  }

  void cancel_pool_failure(const std::string& resource) {
    const auto token = pool_failure_tokens_.find(resource);
    if (token != pool_failure_tokens_.end() && token->second.valid()) {
      scheduler().cancel(token->second);
    }
    pool_failure_tokens_.erase(resource);
  }

  void cancel_pool_repair(const std::string& resource) {
    const auto token = pool_repair_tokens_.find(resource);
    if (token != pool_repair_tokens_.end() && token->second.valid()) {
      scheduler().cancel(token->second);
    }
    pool_repair_tokens_.erase(resource);
  }

  void schedule_pool_failure(const std::string& resource) {
    const auto index = pool_index_.find(resource);
    if (index == pool_index_.end()) {
      return;
    }
    const PoolSpec& spec = resource_pools_[resource];
    Exponential<Xoshiro256PlusPlus> ttf{spec.failure_rate};
    const std::uint64_t payload =
        (static_cast<std::uint64_t>(index->second) << 32) |
        (static_cast<std::uint64_t>(pool_gen_[resource]) & 0xFFFFFFFFu);
    pool_failure_tokens_[resource] = scheduler().schedule(
        clock().now() + SimTime::from_ns(to_ns(ttf(engine_))),
        kPoolFailureEvent, pool_failure_handler_, payload);
  }

  void on_pool_failure(const Event& event) {
    const std::size_t index = static_cast<std::size_t>(event.payload >> 32);
    if (index >= pool_order_.size()) {
      return;
    }
    const std::string& resource = pool_order_[index];
    // Validate BEFORE touching the clock/areas: a stale TTF (ended busy
    // period, or a tail event after the run's business finished) must not
    // advance horizon or the area integrals. The generation bumps when a
    // busy period ends and when a new one starts, so both the pool-idle
    // and the restarted cases fail here.
    if (business_finished()) {
      return;  // tail maintenance event after the business ended
    }
    const std::uint64_t generation = event.payload & 0xFFFFFFFFu;
    if (generation !=
        (static_cast<std::uint64_t>(pool_gen_[resource]) & 0xFFFFFFFFu)) {
      return;  // stale TTF from an ended busy period
    }
    accumulate_areas(clock().now().as_ns());
    if (pool_busy_[resource] > 0 && !pool_down_[resource]) {
      pool_down_[resource] = true;
      pool_down_units_[resource] =
          std::max<std::int64_t>(pool_busy_[resource], 1);
      const PoolSpec& spec = resource_pools_[resource];
      Exponential<Xoshiro256PlusPlus> repair{spec.repair_rate};
      // Interrupt the in-service tasks of the pool's Service consumers
      // (they restart when the pool comes back up); Seize/Assembler
      // consumers keep holding their units (no-preemption default).
      for (std::size_t i = 0; i < blocks_.size(); ++i) {
        if (blocks_[i]->pool_resource() == resource) {
          current_ = i;
          blocks_[i]->on_pool_down(*this, resource);
        }
      }
      // The repair event carries the generation at failure time. It is
      // cancelled/outlived only when the model truly terminates (tail
      // events are dropped by business_finished()); releasing the last
      // held unit while down does NOT cancel it - the repair must finish.
      const std::uint64_t repair_payload =
          (static_cast<std::uint64_t>(index) << 32) |
          (static_cast<std::uint64_t>(pool_gen_[resource]) & 0xFFFFFFFFu);
      pool_repair_tokens_[resource] = scheduler().schedule(
          clock().now() + SimTime::from_ns(to_ns(repair(engine_))),
          kPoolRepairEvent, pool_repair_handler_, repair_payload);
    }
    // The event was consumed: drop the token so a later cancel does not
    // chase an already-fired event. Stale events above return WITHOUT
    // touching the token map, so a handler from an old generation can
    // never erase the current generation's pending token.
    pool_failure_tokens_.erase(resource);
  }

  void on_pool_repair(const Event& event) {
    const std::size_t index = static_cast<std::size_t>(event.payload >> 32);
    if (index >= pool_order_.size()) {
      return;
    }
    const std::string& resource = pool_order_[index];
    // Validate before touching the clock/areas or pool state. The repair
    // carries the generation at failure time; it only becomes stale when
    // the model truly terminates (tail event) - releasing the last held
    // unit while down must NOT invalidate it.
    if (business_finished()) {
      return;  // tail maintenance event after the business ended
    }
    const std::uint64_t generation = event.payload & 0xFFFFFFFFu;
    if (generation !=
        (static_cast<std::uint64_t>(pool_gen_[resource]) & 0xFFFFFFFFu)) {
      return;  // stale repair (generation moved on)
    }
    accumulate_areas(clock().now().as_ns());
    pool_down_[resource] = false;
    pool_down_units_.erase(resource);
    if (pool_busy_[resource] > 0 && pool_failure_rate(resource) > 0.0) {
      // The repair finished while units are held again: restart the
      // failure clock for this (continuing) busy period.
      schedule_pool_failure(resource);
    }
    // Let preempted consumers restart their tasks (preemptive-repeat).
    for (std::size_t i = 0; i < blocks_.size(); ++i) {
      if (blocks_[i]->pool_resource() == resource) {
        current_ = i;
        blocks_[i]->on_pool_up(*this, resource);
      }
    }
    for (const std::size_t waiter : resource_waiters_) {
      pump(waiter);  // handler wake-up: the worklist needs a pump run
    }
    pool_repair_tokens_.erase(resource);
  }

  static std::uint64_t self_payload(std::size_t block,
                                    std::uint64_t entity_id) {
    return (static_cast<std::uint64_t>(block) << 32) | entity_id;
  }

  // Deliver `entity` from `from` through the edges of `port`. Accepted
  // downstream blocks are queued for processing on the worklist; an entity
  // with no downstream on this port leaves the system.
  bool push_downstream(std::size_t from, const Entity& entity,
                       const std::string& port) {
    const auto it = out_edges_.find(from);
    if (it == out_edges_.end() || it->second.empty()) {
      // No downstream on this port: the entity leaves the system.
      leave_system(entity);
      return true;
    }
    bool all = true;
    for (const Edge& edge : it->second) {
      if (edge.from_port != port) {
        continue;
      }
      if (!push(edge.to, entity, edge.to_port)) {
        all = false;
      } else {
        work_.push_back(edge.to);
      }
    }
    return all;
  }

  // Accept an entity into block `to`, respecting its buffering rules.
  // Returns false when the block cannot take it right now (the caller keeps
  // it, so upstream capacity propagates backwards).
  bool push(std::size_t to, const Entity& entity, const std::string& port) {
    ProcessBlock& block = *blocks_[to];
    if (!block.can_accept(entity)) {
      return false;
    }
    block.receive(entity, port);
    return true;
  }

  // Process a block and everything its progress unlocks, using an explicit
  // worklist (an entity can only move forward, so this terminates).
  void pump(std::size_t id) {
    work_.push_back(id);
    while (!work_.empty()) {
      const std::size_t current = work_.back();
      work_.pop_back();
      process_block(current);
    }
  }

  void process_block(std::size_t id) {
    current_ = id;
    ProcessBlock& block = *blocks_[id];
    // 1. Retry entities this block emitted but a downstream rejected.
    while (block.retry_outgoing(*this)) {
    }
    // 2. Process buffered input entities.
    while (block.update(*this)) {
    }
    // 3. A freed slot lets upstream blocks push their waiting entities.
    const auto incoming = in_edges_.find(id);
    if (incoming != in_edges_.end()) {
      for (const std::size_t upstream : incoming->second) {
        if (blocks_[upstream]->buffered() > 0 ||
            blocks_[upstream]->has_outgoing()) {
          work_.push_back(upstream);
        }
      }
    }
  }

  // Facilities: the kernel's clock/scheduler/handler registry when attached
  // (SimulationKernel driver), otherwise per-engine owned ones (batch path).
  [[nodiscard]] IEventScheduler& scheduler() {
    return external_ != nullptr ? external_->scheduler() : *owned_scheduler_;
  }
  [[nodiscard]] SimulationClock& clock() {
    return external_ != nullptr ? external_->clock() : owned_clock_;
  }
  [[nodiscard]] const SimulationClock& clock() const {
    return external_ != nullptr ? external_->clock() : owned_clock_;
  }
  [[nodiscard]] EventHandlerRegistry& handlers() {
    return external_ != nullptr ? external_->handlers() : owned_handlers_;
  }

  RuntimeContext* external_{nullptr};
  std::unique_ptr<BinaryHeapScheduler> owned_scheduler_;
  SimulationClock owned_clock_;
  EventHandlerRegistry owned_handlers_;

  std::vector<std::unique_ptr<ProcessBlock>> blocks_;
  std::vector<std::size_t> sources_;
  std::unordered_map<std::string, std::size_t> index_;
  std::unordered_map<std::size_t, std::vector<Edge>> out_edges_;
  std::unordered_map<std::size_t, std::vector<std::size_t>> in_edges_;
  std::unordered_map<std::string, PoolSpec> resource_pools_;
  std::vector<std::pair<std::string, std::string>> path_edges_;
  SpatialGraph spatial_;
  std::unordered_map<std::string, std::int64_t> available_;
  std::unordered_map<std::string, std::int64_t> pool_busy_;
  std::unordered_map<std::string, bool> pool_down_;
  std::unordered_map<std::string, std::int64_t> pool_down_units_;
  std::unordered_map<std::string, std::int64_t> pool_gen_;
  // Pending pool failure/repair event tokens per resource. They are
  // cancelled when the pool's busy period ends (and on reset) so no stale
  // clock event can fire after the pool went idle; the generation counter
  // is the second line of defence for events that already left the
  // scheduler before the cancellation.
  std::unordered_map<std::string, EventToken> pool_failure_tokens_;
  std::unordered_map<std::string, EventToken> pool_repair_tokens_;
  std::unordered_map<std::string, double> pool_down_area_;
  std::unordered_map<std::string, double> pool_busy_area_;
  std::unordered_map<std::uint64_t, EventToken> depart_tokens_;
  std::vector<std::string> pool_order_;
  std::unordered_map<std::string, std::size_t> pool_index_;
  std::vector<std::size_t> resource_waiters_;
  Xoshiro256PlusPlus engine_{0};
  HandlerId arrive_handler_{0};
  HandlerId depart_handler_{0};
  HandlerId failure_handler_{0};
  HandlerId repair_handler_{0};
  HandlerId timeout_handler_{0};
  HandlerId pool_failure_handler_{0};
  HandlerId pool_repair_handler_{0};
  std::vector<std::size_t> work_;
  std::uint64_t emitted_{0};
  std::uint64_t arrival_events_{0};
  std::vector<std::uint64_t> source_arrival_events_;
  // Per-source pending arrival event tokens (indexed like sources_). An
  // arrival event is either pending (token valid), consumed (cleared by
  // on_arrive), or cancelled (reset / global-cap reached). source_exhausted_
  // marks sources that can never produce another external arrival (manual,
  // maxArrivals == 0, its own limit reached, the global arrivals cap
  // reached, or the inter-arrival sampler stopped yielding a positive
  // finite gap). business_finished() uses both: no pending arrival and no
  // source that could still fire one, together with in_system == 0.
  std::vector<EventToken> source_arrival_tokens_;
  std::vector<bool> source_exhausted_;
  bool manual_injection_{false};
  // Pending block-level failure/repair/timeout events, keyed by
  // (EventType, payload) so different event kinds of the same block/entity
  // never overwrite or erase each other's tokens. They may outlive a reset
  // in external scheduler mode, so reset() cancels them like every other
  // engine-owned event.
  std::map<std::pair<EventType, std::uint64_t>, EventToken>
      block_event_tokens_;
  std::uint64_t departures_{0};
  std::int64_t in_system_{0};
  std::int64_t last_ns_{0};
  std::int64_t area_system_ns_{0};
  double sojourn_sum_{0.0};
  std::uint64_t sojourn_count_{0};
  double wait_sum_{0.0};
  std::uint64_t wait_count_{0};
  double measure_sum_{0.0};
  std::uint64_t measure_count_{0};
  std::uint64_t warmup_{0};
  std::uint64_t servers_total_{0};
  std::size_t current_{0};
  ReplicationConfig config_;
  bool valid_{true};
  // Handler registration identity: the registry the HandlerIds were
  // obtained from and its epoch at registration time. A different registry
  // (attach to another context, or the owned registry replaced by reset())
  // or a registry clear() (epoch bump) invalidates the HandlerIds, and
  // ensure_handlers_registered() re-registers.
  const EventHandlerRegistry* handlers_owner_{nullptr};
  std::uint64_t handlers_epoch_{0};
};

}  // namespace

}  // namespace process

struct ProcessFlowSim::Impl {
  Impl(const std::vector<const ir::v2::Node*>& stages,
       const std::vector<const ir::v2::Coupling*>& couplings,
       const ir::v2::Node* root, std::string* error)
      : engine(stages, couplings, root, error) {}
  process::Engine engine;
};

ProcessFlowSim::ProcessFlowSim(
    const std::vector<const ir::v2::Node*>& stages,
    const std::vector<const ir::v2::Coupling*>& couplings,
    const ir::v2::Node* root, std::string* error)
    : impl_(std::make_unique<Impl>(stages, couplings, root, error)) {
  if (error != nullptr && !error->empty()) {
    impl_.reset();
  }
}

ProcessFlowSim::~ProcessFlowSim() = default;

ReplicationMetrics ProcessFlowSim::run(const ReplicationConfig& config,
                                       TraceRecorder* trace) {
  if (impl_ == nullptr) {
    return ReplicationMetrics{};
  }
  return impl_->engine.run(config, trace);
}

void ProcessFlowSim::reset(const ReplicationConfig& config) {
  if (impl_ != nullptr) {
    impl_->engine.reset(config);
  }
}

void ProcessFlowSim::attach(RuntimeContext& context) {
  if (impl_ != nullptr) {
    impl_->engine.attach(context);
  }
}

std::size_t ProcessFlowSim::advance(SimTime until, TraceRecorder* trace) {
  if (impl_ == nullptr) {
    return 0;
  }
  return impl_->engine.advance(until, trace);
}

std::vector<BlockSnapshot> ProcessFlowSim::block_snapshots() const {
  if (impl_ == nullptr) {
    return {};
  }
  return impl_->engine.block_snapshots();
}

bool ProcessFlowSim::has_pending_events() {
  if (impl_ == nullptr) {
    return false;
  }
  return impl_->engine.has_pending_events();
}

bool ProcessFlowSim::inject(const std::string& source, std::uint64_t count) {
  return impl_ != nullptr && impl_->engine.inject_source(source, count);
}

std::int64_t ProcessFlowSim::now_ns() const {
  if (impl_ == nullptr) {
    return 0;
  }
  return impl_->engine.now_ns();
}

ReplicationMetrics ProcessFlowSim::metrics() const {
  if (impl_ == nullptr) {
    return ReplicationMetrics{};
  }
  return impl_->engine.metrics();
}

}  // namespace logicpilot

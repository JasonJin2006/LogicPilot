// Generic process-flow executor implementation (see process_flow.h).
//
// Push-protocol model: tokens advance block-by-block. A token is accepted
// by a downstream block only when that block can start processing it now
// (a free server / delay slot / free input slot), otherwise it waits in the
// upstream block. Port-aware couplings route emissions (selectOutput outT/
// outF, split out/outCopy, ...) exactly like the compiled IR.
#include "logicpilot/devs/process_flow.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

#include "ir_v2_generated.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/scheduler/binary_heap_scheduler.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"

namespace logicpilot {
namespace {

using ir::v2::Distribution;
using ir::v2::Node;
using ir::v2::Var;
using ir::v2::VarType_Distribution;
using ir::v2::VarType_Float;
using ir::v2::VarType_Int;
using ir::v2::VarType_String;

constexpr EventType kArriveEvent = 20;
constexpr EventType kDepartEvent = 21;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

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

std::int64_t node_int_param(const Node* node, const char* name,
                            std::int64_t fallback) {
  const Var* var = node_var(node, name);
  return var != nullptr && var->type() == VarType_Int ? var->int_value()
                                                      : fallback;
}

double node_float_param(const Node* node, const char* name,
                        double fallback) {
  const Var* var = node_var(node, name);
  return var != nullptr && var->type() == VarType_Float ? var->float_value()
                                                        : fallback;
}

const char* node_string_param(const Node* node, const char* name) {
  const Var* var = node_var(node, name);
  return var != nullptr && var->type() == VarType_String &&
                 var->string_value() != nullptr
             ? var->string_value()->c_str()
             : nullptr;
}

const Distribution* node_dist_param(const Node* node, const char* name) {
  const Var* var = node_var(node, name);
  return var != nullptr && var->type() == VarType_Distribution
             ? var->distribution()
             : nullptr;
}

// Distribution -> duration sampler (kind bytes mirror v1: Constant=0,
// Uniform=1, Normal=2, Exponential=3, Poisson=4). Poisson/rate yields
// exponential inter-arrival/service times with the given rate.
using Sampler = std::function<double(Xoshiro256PlusPlus&)>;

Sampler make_sampler(const Distribution* dist, std::string* error) {
  const auto fail = [&](const std::string& message) -> Sampler {
    if (error != nullptr) {
      *error = message;
    }
    return {};
  };
  if (dist == nullptr || dist->params() == nullptr ||
      dist->params()->size() == 0) {
    return fail("distribution requires at least one parameter");
  }
  const double p0 = dist->params()->Get(0);
  switch (dist->kind()) {
    case 0:  // Constant
      return [p0](Xoshiro256PlusPlus&) { return p0; };
    case 2: {  // Normal(mean, stddev)
      const double stddev = dist->params()->size() > 1
                                ? dist->params()->Get(1)
                                : 1.0;
      return [p0, stddev](Xoshiro256PlusPlus& engine) {
        Normal<Xoshiro256PlusPlus> normal{p0, stddev};
        return normal(engine);
      };
    }
    case 3:  // Exponential(rate)
    case 4:  // Poisson(rate) == exponential(rate)
      return [p0](Xoshiro256PlusPlus& engine) {
        Exponential<Xoshiro256PlusPlus> exp{p0};
        return exp(engine);
      };
    default:
      return fail("unsupported distribution kind");
  }
}

enum class BlockKind {
  kSource,
  kQueue,
  kDelay,
  kService,
  kSink,
  kSplit,
  kSelectOutput,
  kCount,
  kHold,
  kSeize,
  kRelease,
  kWait,
  kPassThrough,  // enter/exit/batch/unbatch/combine/match/moveTo/...
};

struct Token {
  std::uint64_t id{0};
  std::int64_t created_ns{0};        // when the source emitted it
  std::int64_t service_start_ns{0};  // last service/delay start
  double service_sum{0.0};           // accumulated service/delay seconds
};

struct Edge {
  std::size_t to;
  std::string from_port;
};

struct Block {
  std::string name;
  BlockKind kind{BlockKind::kPassThrough};
  std::int64_t capacity{-1};       // input capacity (< 0 = unbounded)
  std::int64_t servers{1};         // service/seize: pool capacity
  Sampler interarrival;            // source
  Sampler service_time;            // delay/service
  double probability{0.5};         // selectOutput true branch
  std::int64_t copies{2};          // split: copies to emit
  bool frozen{false};              // hold

  std::deque<Token> input;         // buffered (capacity-limited)
  std::deque<Token> in_service;    // delayed / in service (ordered)
  std::deque<Token> outgoing;      // emitted but rejected downstream
  std::int64_t units_in_use{0};    // service/seize: seized units

  std::uint64_t arrived{0};
  std::uint64_t departed{0};
  std::int64_t occupancy{0};       // tokens buffered in input
  std::int64_t busy{0};            // service: busy server count
  std::int64_t last_ns{0};
  double area_occupancy{0.0};
  double area_busy{0.0};
};

class Engine {
 public:
  Engine(const std::vector<const Node*>& stages,
         const std::vector<const ir::v2::Coupling*>& couplings,
         const Node* root, std::string* error) {
    if (stages.empty()) {
      fail(error, "process flow has no blocks");
      return;
    }
    std::unordered_map<std::string, std::int64_t> resource_capacity;
    if (root != nullptr && root->children() != nullptr) {
      for (const Node* child : *root->children()) {
        if (child != nullptr && child->semantics() != nullptr &&
            child->semantics()->library() != nullptr &&
            child->semantics()->block() != nullptr &&
            std::strcmp(child->semantics()->library()->c_str(), "process") ==
                0 &&
            std::strcmp(child->semantics()->block()->c_str(), "resource") ==
                0) {
          const std::string name =
              child->metadata() != nullptr &&
                      child->metadata()->name() != nullptr
                  ? child->metadata()->name()->str()
                  : "";
          resource_capacity[name] = node_int_param(child, "capacity", 1);
        }
      }
    }
    for (const Node* stage : stages) {
      if (stage == nullptr || stage->semantics() == nullptr ||
          stage->semantics()->block() == nullptr ||
          stage->metadata() == nullptr ||
          stage->metadata()->name() == nullptr) {
        continue;
      }
      Block block;
      block.name = stage->metadata()->name()->str();
      const std::string kind = stage->semantics()->block()->str();
      block.kind = classify(kind);
      if (block.kind == BlockKind::kSource) {
        block.interarrival =
            make_sampler(node_dist_param(stage, "arrival"), error);
        if (block.interarrival == nullptr) {
          return;
        }
      } else if (block.kind == BlockKind::kDelay) {
        block.service_time =
            make_sampler(node_dist_param(stage, "delayTime"), error);
        block.capacity = node_int_param(stage, "capacity", 1);
        if (node_int_param(stage, "maximumCapacity", 0) != 0) {
          block.capacity = -1;
        }
      } else if (block.kind == BlockKind::kService) {
        block.service_time =
            make_sampler(node_dist_param(stage, "time"), error);
        const char* resource = node_string_param(stage, "resource");
        const std::string pool = resource != nullptr ? resource : block.name;
        const auto it = resource_capacity.find(pool);
        block.servers = it != resource_capacity.end() ? it->second : 1;
      } else if (block.kind == BlockKind::kQueue ||
                 block.kind == BlockKind::kWait) {
        block.capacity = node_int_param(stage, "capacity", -1);
        if (block.capacity == 0) {
          block.capacity = -1;  // 0 = unbounded in the kernel paths
        }
      } else if (block.kind == BlockKind::kSplit) {
        block.copies = node_int_param(stage, "copies", 2);
      } else if (block.kind == BlockKind::kSelectOutput) {
        block.probability = node_float_param(stage, "probability", 0.5);
      } else if (block.kind == BlockKind::kHold) {
        block.frozen = node_int_param(stage, "initiallyBlocked", 0) != 0 ||
                       node_int_param(stage, "freeze", 0) != 0;
      } else if (block.kind == BlockKind::kSeize) {
        block.capacity = node_int_param(stage, "queueCapacity", -1);
        const char* resource = node_string_param(stage, "resource");
        const std::string pool = resource != nullptr ? resource : block.name;
        const auto it = resource_capacity.find(pool);
        block.servers = it != resource_capacity.end() ? it->second : 1;
      }
      index_[block.name] = blocks_.size();
      blocks_.push_back(std::move(block));
    }
    if (blocks_.empty()) {
      fail(error, "process flow has no executable blocks");
      return;
    }
    bool has_source = false;
    for (const Block& block : blocks_) {
      if (block.kind == BlockKind::kSource) {
        has_source = true;
        break;
      }
    }
    if (!has_source) {
      fail(error, "process flow has no source block");
      return;
    }
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
        const std::string from_port =
            coupling->from_port() != nullptr
                ? coupling->from_port()->str()
                : "out";
        out_edges_[from_it->second].push_back({to_it->second, from_port});
        in_edges_[to_it->second].push_back(from_it->second);
      }
    } else {
      for (std::size_t i = 0; i + 1 < blocks_.size(); ++i) {
        out_edges_[i].push_back({i + 1, "out"});
        in_edges_[i + 1].push_back(i);
      }
    }
  }

  [[nodiscard]] bool valid() const { return valid_; }

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) {
    config_ = config;
    warmup_ = config.warmup_arrivals;
    engine_ = Xoshiro256PlusPlus{config.seed};
    scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
    clock_ = SimulationClock{};
    handlers_.clear();
    emitted_ = 0;
    departures_ = 0;
    in_system_ = 0;
    last_ns_ = 0;
    area_system_ns_ = 0;
    sojourn_sum_ = 0.0;
    sojourn_count_ = 0;
    wait_sum_ = 0.0;
    wait_count_ = 0;
    servers_total_ = 0;
    for (Block& block : blocks_) {
      block.input.clear();
      block.in_service.clear();
      block.units_in_use = 0;
      block.arrived = 0;
      block.departed = 0;
      block.occupancy = 0;
      block.busy = 0;
      block.last_ns = 0;
      block.area_occupancy = 0.0;
      block.area_busy = 0.0;
      if (block.kind == BlockKind::kService ||
          block.kind == BlockKind::kSeize) {
        servers_total_ += block.servers;
      }
    }
    depart_handler_ =
        handlers_.add([this](const Event& event) { on_depart(event); });
    arrive_handler_ =
        handlers_.add([this](const Event& event) { on_arrive(event); });
    for (std::size_t i = 0; i < blocks_.size(); ++i) {
      if (blocks_[i].kind == BlockKind::kSource) {
        scheduler_->schedule(
            clock_.now() +
                SimTime::from_ns(
                    to_ns(blocks_[i].interarrival(engine_))),
            kArriveEvent, arrive_handler_, i);
      }
    }
    const std::size_t dispatched =
        run_until(*scheduler_, clock_, SimTime::infinity(), [&](const Event& event) {
      if (trace != nullptr) {
        trace->record(event.at, event.type, event.payload);
      }
      handlers_.dispatch(event);
    });
    ReplicationMetrics metrics;
    metrics.arrivals = config.arrivals;
    metrics.departures = departures_;
    const std::int64_t horizon_ns = clock_.now().as_ns();
    metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
    metrics.throughput =
        horizon_ns > 0
            ? static_cast<double>(departures_) / metrics.horizon_seconds
            : 0.0;
    metrics.mean_in_system =
        horizon_ns > 0
            ? static_cast<double>(area_system_ns_) /
                  static_cast<double>(horizon_ns)
            : 0.0;
    double queue_area = 0.0;
    double busy_area = 0.0;
    for (const Block& block : blocks_) {
      queue_area += block.area_occupancy;
      busy_area += block.area_busy;
    }
    metrics.mean_in_queue =
        horizon_ns > 0 ? queue_area / static_cast<double>(horizon_ns) : 0.0;
    metrics.mean_sojourn =
        sojourn_count_ == 0
            ? 0.0
            : sojourn_sum_ / static_cast<double>(sojourn_count_);
    metrics.mean_wait = wait_count_ == 0
                            ? 0.0
                            : wait_sum_ / static_cast<double>(wait_count_);
    if (horizon_ns > 0 && servers_total_ > 0) {
      metrics.utilization =
          busy_area / static_cast<double>(horizon_ns) /
          static_cast<double>(servers_total_);
      metrics.availability = 1.0;
    }
    if (trace != nullptr) {
      trace->absorb(std::bit_cast<std::uint64_t>(metrics.mean_sojourn));
      trace->absorb(departures_);
    }
    return metrics;    return metrics;
  }

 private:
  static BlockKind classify(const std::string& kind) {
    if (kind == "source") return BlockKind::kSource;
    if (kind == "queue") return BlockKind::kQueue;
    if (kind == "delay") return BlockKind::kDelay;
    if (kind == "service") return BlockKind::kService;
    if (kind == "sink") return BlockKind::kSink;
    if (kind == "split") return BlockKind::kSplit;
    if (kind == "selectOutput") return BlockKind::kSelectOutput;
    if (kind == "count") return BlockKind::kCount;
    if (kind == "hold") return BlockKind::kHold;
    if (kind == "seize") return BlockKind::kSeize;
    if (kind == "release") return BlockKind::kRelease;
    if (kind == "wait") return BlockKind::kWait;
    return BlockKind::kPassThrough;  // enter/exit/batch/unbatch/...
  }

  static void fail(std::string* error, const std::string& message) {
    if (error != nullptr) {
      *error = message;
    }
  }

  void accumulate_areas(std::int64_t now_ns) {
    const std::int64_t dt = now_ns - last_ns_;
    if (dt <= 0) {
      return;
    }
    area_system_ns_ += dt * static_cast<std::int64_t>(in_system_);
    for (Block& block : blocks_) {
      block.area_occupancy +=
          dt * static_cast<double>(block.input.size());
      block.area_busy += dt * static_cast<double>(block.busy);
    }
    last_ns_ = now_ns;
  }

  void on_arrive(const Event& event) {
    const std::size_t source = static_cast<std::size_t>(event.payload);
    accumulate_areas(clock_.now().as_ns());
    if (emitted_ < config_.arrivals) {
      Token token;
      token.id = emitted_;
      token.created_ns = clock_.now().as_ns();
      token.service_start_ns = token.created_ns;
      ++emitted_;
      ++in_system_;
      if (!push_downstream(source, token, "out")) {
        blocks_[source].input.push_back(token);
      }
      pump(source);
      scheduler_->schedule(
          clock_.now() +
              SimTime::from_ns(
                  to_ns(blocks_[source].interarrival(engine_))),
          kArriveEvent, arrive_handler_, source);
    }
  }

  void on_depart(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload);
    accumulate_areas(clock_.now().as_ns());
    Block& current = blocks_[block];
    if (current.in_service.empty()) {
      return;
    }
    Token token = current.in_service.front();
    current.in_service.pop_front();
    ++current.departed;
    if (current.kind == BlockKind::kService ||
        current.kind == BlockKind::kSeize) {
      --current.busy;
      --current.units_in_use;
    }
    if (current.kind == BlockKind::kService && token.id >= warmup_) {
      wait_sum_ += static_cast<double>(token.service_start_ns -
                                       token.created_ns) *
                   1e-9;
      ++wait_count_;
    }
    if (!push_downstream(block, token, "out")) {
      current.outgoing.push_back(token);
    }
    pump(block);
  }

  // Deliver `token` from `from` through the edges of `port`. Accepted
  // downstream blocks are queued for processing on the worklist; a token
  // with no downstream on this port leaves the system.
  bool push_downstream(std::size_t from, const Token& token,
                       const std::string& port) {
    const auto it = out_edges_.find(from);
    if (it == out_edges_.end() || it->second.empty()) {
      // No downstream on this port: the token leaves the system.
      ++departures_;
      --in_system_;
      if (token.id >= warmup_) {
        sojourn_sum_ +=
            static_cast<double>(clock_.now().as_ns() - token.created_ns) *
            1e-9;
        ++sojourn_count_;
      }
      return true;
    }
    bool all = true;
    for (const Edge& edge : it->second) {
      if (edge.from_port != port) {
        continue;
      }
      if (!push(edge.to, token)) {
        all = false;
      } else {
        work_.push_back(edge.to);
      }
    }
    return all;
  }

  // Accept a token into block `to`, respecting its buffering rules. Returns
  // false when the block cannot take the token right now (the caller keeps
  // it, so upstream capacity propagates backwards).
  bool push(std::size_t to, const Token& token) {
    Block& block = blocks_[to];
    const bool can_start =
        block.kind == BlockKind::kService || block.kind == BlockKind::kSeize
            ? block.units_in_use < block.servers
            : (block.kind == BlockKind::kDelay
                   ? (block.capacity < 0 ||
                      static_cast<std::int64_t>(block.in_service.size()) <
                          block.capacity)
                   : (block.capacity < 0 ||
                      static_cast<std::int64_t>(block.input.size()) <
                          block.capacity));
    if (!can_start) {
      return false;
    }
    ++block.arrived;
    block.input.push_back(token);
    return true;
  }

  // Process a block and everything its progress unlocks, using an explicit
  // worklist (a token can only move forward, so this terminates).
  void pump(std::size_t id) {
    work_.push_back(id);
    while (!work_.empty()) {
      const std::size_t current = work_.back();
      work_.pop_back();
      process_block(current);
    }
  }

  void process_block(std::size_t id) {
    Block& block = blocks_[id];
    // 1. Retry tokens this block emitted but a downstream rejected.
    while (!block.outgoing.empty()) {
      Token token = block.outgoing.front();
      if (push_downstream(id, token, "out")) {
        block.outgoing.pop_front();
      } else {
        break;
      }
    }
    // 2. Process buffered input tokens.
    bool progress = true;
    while (progress && !block.input.empty()) {
      progress = false;
      Token token = block.input.front();
      --block.occupancy;
      switch (block.kind) {
        case BlockKind::kQueue:
        case BlockKind::kWait:
        case BlockKind::kCount:
        case BlockKind::kPassThrough:
        case BlockKind::kRelease:
        case BlockKind::kHold:
          if ((block.kind == BlockKind::kHold && block.frozen) ||
              !push_downstream(id, token, "out")) {
            break;
          }
          block.input.pop_front();
          ++block.departed;
          progress = true;
          break;
        case BlockKind::kSelectOutput: {
          const double roll =
              static_cast<double>(engine_()) /
              static_cast<double>(UINT64_MAX);
          const bool take_true = roll < block.probability;
          if (push_downstream(id, token, take_true ? "outT" : "outF")) {
            block.input.pop_front();
            ++block.departed;
            progress = true;
          }
          break;
        }
        case BlockKind::kSplit: {
          if (push_downstream(id, token, "out")) {
            block.input.pop_front();
            ++block.departed;
            for (std::int64_t copy = 1; copy < block.copies; ++copy) {
              Token clone = token;
              clone.id = token.id * 1000 + static_cast<std::uint64_t>(copy);
              if (!push_downstream(id, clone, "outCopy")) {
                block.outgoing.push_back(clone);
              }
            }
            progress = true;
          }
          break;
        }
        case BlockKind::kSink: {
          block.input.pop_front();
          ++block.departed;
          ++departures_;
          --in_system_;
          if (token.id >= warmup_) {
            sojourn_sum_ +=
                static_cast<double>(clock_.now().as_ns() - token.created_ns) *
                1e-9;
            ++sojourn_count_;
          }
          progress = true;
          break;
        }
        case BlockKind::kDelay:
        case BlockKind::kService:
        case BlockKind::kSeize: {
          const bool slot_free =
              block.kind == BlockKind::kService ||
                      block.kind == BlockKind::kSeize
                  ? block.units_in_use < block.servers
                  : (block.capacity < 0 ||
                     static_cast<std::int64_t>(block.in_service.size()) <
                         block.capacity);
          if (!slot_free) {
            break;  // no slot yet; the token waits in the input buffer
          }
          block.input.pop_front();
          token.service_start_ns = clock_.now().as_ns();
          block.in_service.push_back(token);
          if (block.kind == BlockKind::kService ||
              block.kind == BlockKind::kSeize) {
            ++block.units_in_use;
            ++block.busy;
          }
          const double hold =
              block.kind == BlockKind::kDelay ||
                      block.kind == BlockKind::kService
                  ? block.service_time(engine_)
                  : 0.0;
          if (block.kind == BlockKind::kService) {
          }
          scheduler_->schedule(clock_.now() + SimTime::from_ns(to_ns(hold)),
                              kDepartEvent, depart_handler_, id);
          progress = true;
          break;
        }
        case BlockKind::kSource:
          // A rejected source token (downstream was full) waits in the
          // source's input; retry it now that downstream freed a slot.
          if (push_downstream(id, token, "out")) {
            block.input.pop_front();
            progress = true;
          }
          break;
      }
    }
    // 3. A freed slot lets upstream blocks push their waiting tokens.
    const auto incoming = in_edges_.find(id);
    if (incoming != in_edges_.end()) {
      for (const std::size_t upstream : incoming->second) {
        if (!blocks_[upstream].input.empty() ||
            !blocks_[upstream].outgoing.empty()) {
          work_.push_back(upstream);
        }
      }
    }
  }

  std::vector<Block> blocks_;
  std::unordered_map<std::string, std::size_t> index_;
  std::unordered_map<std::size_t, std::vector<Edge>> out_edges_;
  std::unordered_map<std::size_t, std::vector<std::size_t>> in_edges_;
  Xoshiro256PlusPlus engine_{0};
  std::unique_ptr<BinaryHeapScheduler> scheduler_;
  SimulationClock clock_;
  EventHandlerRegistry handlers_;
  HandlerId arrive_handler_{0};
  HandlerId depart_handler_{0};
  std::vector<std::size_t> work_;
  std::uint64_t emitted_{0};
  std::uint64_t departures_{0};
  std::int64_t in_system_{0};
  std::int64_t last_ns_{0};
  std::int64_t area_system_ns_{0};
  double sojourn_sum_{0.0};
  std::uint64_t sojourn_count_{0};
  double wait_sum_{0.0};
  std::uint64_t wait_count_{0};
  std::uint64_t warmup_{0};
    std::uint64_t servers_total_{1};
  ReplicationConfig config_;
  bool valid_{true};
};

}  // namespace

namespace {

std::vector<const Node*> collect_stages(const Node* flow) {
  std::vector<const Node*> stages;
  if (flow != nullptr && flow->children() != nullptr) {
    for (const Node* stage : *flow->children()) {
      stages.push_back(stage);
    }
  }
  return stages;
}

std::vector<const ir::v2::Coupling*> collect_couplings(const Node* flow) {
  std::vector<const ir::v2::Coupling*> couplings;
  if (flow != nullptr && flow->couplings() != nullptr) {
    for (const ir::v2::Coupling* coupling : *flow->couplings()) {
      couplings.push_back(coupling);
    }
  }
  return couplings;
}

}  // namespace

struct ProcessFlowSim::Impl {
  Impl(const std::vector<const Node*>& stages,
       const std::vector<const ir::v2::Coupling*>& couplings,
       const Node* root, std::string* error)
      : engine(stages, couplings, root, error) {}
  Engine engine;
};

ProcessFlowSim::ProcessFlowSim(
    const std::vector<const Node*>& stages,
    const std::vector<const ir::v2::Coupling*>& couplings, const Node* root,
    std::string* error)
    : impl_(std::make_unique<Impl>(stages, couplings, root, error)) {
  if (error != nullptr && !error->empty()) {
    impl_.reset();
  }
}

// Legacy constructor: keep a flow-node entry point for callers that have a
// process/flow container.
ProcessFlowSim::ProcessFlowSim(const Node* flow, const Node* root,
                               std::string* error)
    : ProcessFlowSim(collect_stages(flow), collect_couplings(flow), root,
                     error) {
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

}  // namespace logicpilot

// Generic process-flow executor implementation (see process_flow.h).
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
using logicpilot::ir_v2_util::node_dist_param;
using logicpilot::ir_v2_util::node_float_param;
using logicpilot::ir_v2_util::node_int_param;
using logicpilot::ir_v2_util::node_string_param;

constexpr EventType kArriveEvent = 20;
constexpr EventType kDepartEvent = 21;

std::int64_t to_ns(double seconds) {
  return static_cast<std::int64_t>(std::llround(seconds * 1e9));
}

void fail(std::string* error, const std::string& message) {
  if (error != nullptr) {
    *error = message;
  }
}

// Builds the modular block for one process-library stage, carrying over the
// pre-modular engine's parameter mapping verbatim.
std::unique_ptr<ProcessBlock> make_block(
    const Node* stage, const std::string& kind, const std::string& name,
    const std::unordered_map<std::string, std::int64_t>& resource_capacity,
    std::string* error) {
  const auto pool_servers = [&](const char* resource_name) -> std::int64_t {
    const std::string pool =
        resource_name != nullptr ? resource_name : name;
    const auto it = resource_capacity.find(pool);
    return it != resource_capacity.end() ? it->second : 1;
  };
  if (kind == "source") {
    TimeSampler sampler = make_sampler(node_dist_param(stage, "arrival"), error);
    if (!sampler) {
      return nullptr;
    }
    return std::make_unique<SourceBlock>(name, std::move(sampler));
  }
  if (kind == "delay") {
    TimeSampler sampler =
        make_sampler(node_dist_param(stage, "delayTime"), error);
    if (!sampler) {
      return nullptr;
    }
    std::int64_t capacity = node_int_param(stage, "capacity", 1);
    if (node_int_param(stage, "maximumCapacity", 0) != 0) {
      capacity = -1;
    }
    return std::make_unique<DelayBlock>(name, std::move(sampler), capacity);
  }
  if (kind == "service") {
    TimeSampler sampler = make_sampler(node_dist_param(stage, "time"), error);
    if (!sampler) {
      return nullptr;
    }
    return std::make_unique<ServiceBlock>(
        name, pool_servers(node_string_param(stage, "resource")),
        std::move(sampler), false);
  }
  if (kind == "seize") {
    return std::make_unique<ServiceBlock>(
        name, pool_servers(node_string_param(stage, "resource")),
        TimeSampler{}, true);
  }
  if (kind == "queue" || kind == "wait") {
    std::int64_t capacity = node_int_param(stage, "capacity", -1);
    if (capacity == 0) {
      capacity = -1;  // 0 = unbounded in the kernel paths
    }
    return std::make_unique<QueueBlock>(name, capacity, kind);
  }
  if (kind == "sink") {
    return std::make_unique<SinkBlock>(name);
  }
  if (kind == "split") {
    return std::make_unique<GenericBlock>(
        kind, name, 0.5, node_int_param(stage, "copies", 2), false);
  }
  if (kind == "selectOutput") {
    return std::make_unique<GenericBlock>(
        kind, name, node_float_param(stage, "probability", 0.5), 2, false);
  }
  if (kind == "hold") {
    const bool frozen = node_int_param(stage, "initiallyBlocked", 0) != 0 ||
                        node_int_param(stage, "freeze", 0) != 0;
    return std::make_unique<GenericBlock>(kind, name, 0.5, 2, frozen);
  }
  // count / release / enter / exit / batch / unbatch / combine / match /
  // moveTo / ... pass tokens through with counters maintained.
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
      const std::string name = stage->metadata()->name()->str();
      const std::string kind = stage->semantics()->block()->str();
      auto block = make_block(stage, kind, name, resource_capacity, error);
      if (block == nullptr) {
        return;
      }
      index_[name] = blocks_.size();
      if (kind == "source") {
        sources_.push_back(blocks_.size());
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

  // Kernel-driven mode: schedule into the kernel's clock/scheduler/handler
  // registry instead of per-engine owned facilities (SimulationKernel).
  void attach(RuntimeContext& context) { external_ = &context; }

  void reset(const ReplicationConfig& config) {
    config_ = config;
    warmup_ = config.warmup_arrivals;
    engine_ = Xoshiro256PlusPlus{config.seed};
    if (external_ == nullptr) {
      owned_scheduler_ = std::make_unique<BinaryHeapScheduler>(64);
      owned_clock_ = SimulationClock{};
      owned_handlers_ = EventHandlerRegistry{};
    }
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
    for (auto& block : blocks_) {
      block->clear_buffers();
      block->reset_stats();
      servers_total_ += block->pool_capacity();
    }
    depart_handler_ =
        handlers().add([this](const Event& event) { on_depart(event); });
    arrive_handler_ =
        handlers().add([this](const Event& event) { on_arrive(event); });
    for (const std::size_t source : sources_) {
      scheduler().schedule(
          clock().now() +
              SimTime::from_ns(
                  to_ns(blocks_[source]->sample_gap(engine_))),
          kArriveEvent, arrive_handler_, source);
    }
  }

  std::size_t advance(SimTime until, TraceRecorder* trace) {
    return run_until(scheduler(), clock(), until, [&](const Event& event) {
      if (trace != nullptr) {
        trace->record(event.at, event.type, event.payload);
      }
      handlers().dispatch(event);
    });
  }

  ReplicationMetrics metrics() const {
    ReplicationMetrics metrics;
    metrics.arrivals = config_.arrivals;
    metrics.departures = departures_;
    const std::int64_t horizon_ns = clock().now().as_ns();
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
    for (const auto& block : blocks_) {
      queue_area += block->area_occupancy();
      busy_area += block->area_busy();
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

  void schedule_depart(std::int64_t hold_ns) override {
    scheduler().schedule(clock().now() + SimTime::from_ns(hold_ns),
                         kDepartEvent, depart_handler_, current_);
  }

  void leave_system(const Entity& entity) override {
    ++departures_;
    --in_system_;
    if (entity.id >= warmup_) {
      sojourn_sum_ +=
          static_cast<double>(clock().now().as_ns() - entity.created_ns) *
          1e-9;
      ++sojourn_count_;
    }
  }

  void record_service_wait(const Entity& entity) override {
    if (entity.id >= warmup_) {
      wait_sum_ += static_cast<double>(entity.service_start_ns -
                                       entity.created_ns) *
                   1e-9;
      ++wait_count_;
    }
  }

 private:
  struct Edge {
    std::size_t to;
    std::string from_port;
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
    last_ns_ = now_ns;
  }

  void on_arrive(const Event& event) {
    const std::size_t source = static_cast<std::size_t>(event.payload);
    accumulate_areas(clock().now().as_ns());
    if (emitted_ < config_.arrivals) {
      Entity entity;
      entity.id = emitted_;
      entity.created_ns = clock().now().as_ns();
      entity.service_start_ns = entity.created_ns;
      ++emitted_;
      ++in_system_;
      if (!push_downstream(source, entity, "out")) {
        blocks_[source]->receive(entity);
      }
      pump(source);
      scheduler().schedule(
          clock().now() +
              SimTime::from_ns(
                  to_ns(blocks_[source]->sample_gap(engine_))),
          kArriveEvent, arrive_handler_, source);
    }
  }

  void on_depart(const Event& event) {
    const std::size_t block = static_cast<std::size_t>(event.payload);
    accumulate_areas(clock().now().as_ns());
    current_ = block;
    blocks_[block]->complete(*this);
    pump(block);
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
      if (!push(edge.to, entity)) {
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
  bool push(std::size_t to, const Entity& entity) {
    ProcessBlock& block = *blocks_[to];
    if (!block.can_accept()) {
      return false;
    }
    block.receive(entity);
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
  Xoshiro256PlusPlus engine_{0};
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
  std::uint64_t servers_total_{0};
  std::size_t current_{0};
  ReplicationConfig config_;
  bool valid_{true};
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
    const ir::v2::Node* root,
    std::string* error)
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

ReplicationMetrics ProcessFlowSim::metrics() const {
  if (impl_ == nullptr) {
    return ReplicationMetrics{};
  }
  return impl_->engine.metrics();
}

}  // namespace logicpilot

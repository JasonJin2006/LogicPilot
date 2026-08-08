// ProcessBlock framework (Method Runtime Layer, Phase 3).
//
// The generic process engine is decomposed into modular blocks that express
// their own behavior through a small contract:
//
//   receive(entity)  - buffer an entity that passed can_accept()
//   update(ctx)      - one progress step at the current simulation time
//   complete(ctx)    - the block's depart event fired (service/delay done)
//   retry_outgoing   - re-push entities a downstream rejected
//
// The engine stays the coordinator: it owns routing, the scheduler, the
// replication RNG and the statistics accumulators, and hands blocks a
// BlockContext so they never reach into engine internals.
#pragma once

#include <cstdint>
#include <deque>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/time/sim_time.h"

namespace logicpilot::process {

// One entity (agent/token) flowing through the process blocks.
struct Entity {
  std::uint64_t id{0};
  std::int64_t created_ns{0};        // source emission time
  std::int64_t service_start_ns{0};  // last service/delay start
  // Temporary batch contents (Batch with permanent=false; restored by
  // Unbatch) and resource units held by Seize until Release.
  std::vector<Entity> contents;
  std::unordered_map<std::string, std::int64_t> resources;
  // Numeric entity attributes declared on the emitting source block
  // (`state <name> = <value>`); runtime conditions may reference them.
  std::unordered_map<std::string, double> attributes;
  // Spatial position (moveTo travel time = distance / speed).
  double x{0.0};
  double y{0.0};
  // TimeMeasureStart/End pair: timestamp set by the start block and
  // measured when the entity reaches the paired end block.
  std::int64_t measure_start_ns{0};
  bool has_measure{false};
};

// Engine-side facilities handed to blocks during update/complete/retry.
class BlockContext {
 public:
  virtual ~BlockContext() = default;

  [[nodiscard]] virtual SimTime now() const = 0;
  [[nodiscard]] virtual Xoshiro256PlusPlus& rng() = 0;

  // Push `entity` to every downstream edge on `port` (from the current
  // block). Returns true when all branches accepted it; an entity with no
  // downstream on the port leaves the system.
  virtual bool emit(const Entity& entity, const char* port) = 0;

  // SelectOutputIn routing: push `entity` through the `out` edges of the
  // named SelectOutputOut block (the agent is forwarded to that block's
  // downstream without physically entering it). Returns false when the
  // target is unknown or a downstream rejected the entity.
  virtual bool emit_via(const Entity& entity, const char* target_block) = 0;

  // Schedule this block's depart event for `entity_id` at now + hold_ns.
  virtual void schedule_depart(std::int64_t hold_ns,
                               std::uint64_t entity_id) = 0;

  // Schedule a resource failure / repair event for `entity_id` (the entity
  // occupying the failing unit) at now + hold_ns.
  virtual void schedule_failure(std::int64_t hold_ns,
                                std::uint64_t entity_id) = 0;
  virtual void schedule_repair(std::int64_t hold_ns,
                               std::uint64_t entity_id) = 0;

  // Schedule a queue-timeout event for `entity_id` (Wait/Seize) at now +
  // hold_ns; the block decides whether the entity is still waiting when it
  // fires (exits through outTimeout) or already left (no-op).
  virtual void schedule_timeout(std::int64_t hold_ns,
                                std::uint64_t entity_id) = 0;

  // Uniform [0,1) draw from the replication RNG (deterministic order).
  virtual double rng01() = 0;

  // A token left the system (sink or dangling edge): record sojourn.
  virtual void leave_system(const Entity& entity) = 0;

  // A service completion happened: record wait statistics.
  virtual void record_service_wait(const Entity& entity) = 0;

  // Resource-pool operations (Seize / Release). `resource` is the ResourcePool
  // block name; units are held on the entity until Release returns them.
  virtual bool try_seize(const std::string& resource,
                         std::int64_t quantity) = 0;
  virtual void release_resources(const std::string& resource,
                                 std::int64_t quantity) = 0;

  // Whether every downstream edge on `port` can currently accept `entity`
  // (no side effects; used for atomic multi-port emissions like Match).
  virtual bool downstream_accepts(const Entity& entity, const char* port) = 0;

  // TimeMeasureEnd measurement (seconds between paired start/end blocks).
  virtual void record_measure(const Entity& entity, double seconds) = 0;
};

// One process-library block (source / queue / delay / service / sink / ...).
class ProcessBlock {
 public:
  virtual ~ProcessBlock() = default;

  [[nodiscard]] virtual std::string_view kind() const = 0;
  [[nodiscard]] virtual std::string_view name() const = 0;

  // Whether the block can currently buffer `entity` (per-entity admission
  // lets full priority queues preempt their lowest-priority waiter).
  [[nodiscard]] virtual bool can_accept(const Entity& entity) = 0;
  // Buffer an entity (caller checked can_accept; capacity rules per kind).
  virtual void receive(const Entity& entity) = 0;
  // Port-aware receive (multi-input blocks: combine in1/in2, match in1/in2).
  // Defaults to the plain receive.
  virtual void receive(const Entity& entity, std::string_view port) {
    (void)port;
    receive(entity);
  }
  // One progress step at the current simulation time. Returns true when the
  // block consumed/forwarded an entity (the engine keeps stepping).
  virtual bool update(BlockContext& ctx) = 0;
  // The block's depart event fired: finish the in-service entity with this
  // id (multi-unit blocks route by id, not FIFO).
  virtual void complete(BlockContext& ctx, std::uint64_t entity_id) = 0;
  // The unit occupied by `entity_id` failed / was repaired.
  virtual void on_failure(BlockContext& ctx, std::uint64_t entity_id) = 0;
  virtual void on_repair(BlockContext& ctx, std::uint64_t entity_id) = 0;
  // The queue-timeout event for `entity_id` fired.
  virtual void on_timeout(BlockContext& ctx, std::uint64_t entity_id) = 0;
  // Re-push entities this block emitted but a downstream rejected. Returns
  // true when at least one was accepted.
  virtual bool retry_outgoing(BlockContext& ctx) = 0;

  [[nodiscard]] virtual bool has_in_service() const = 0;
  [[nodiscard]] virtual std::size_t buffered() const = 0;
  [[nodiscard]] virtual bool has_outgoing() const = 0;

  // Statistics / inspection.
  [[nodiscard]] virtual std::uint64_t arrived() const = 0;
  [[nodiscard]] virtual std::uint64_t departed() const = 0;
  [[nodiscard]] virtual std::int64_t busy_units() const = 0;
  // Service/seize pool capacity (0 for non-pool blocks).
  [[nodiscard]] virtual std::int64_t pool_capacity() const = 0;
  [[nodiscard]] virtual double area_occupancy() const = 0;
  [[nodiscard]] virtual double area_busy() const = 0;
  [[nodiscard]] virtual double area_down() const { return 0.0; }
  [[nodiscard]] virtual std::int64_t buffer_capacity() const = 0;
  [[nodiscard]] virtual std::uint64_t timed_out() const { return 0; }
  [[nodiscard]] virtual std::uint64_t preempted() const { return 0; }
  virtual void accumulate_areas(std::int64_t dt_ns) = 0;

  virtual void reset_stats() = 0;
  virtual void clear_buffers() = 0;

  // Source blocks sample their inter-arrival gap here (default 0 for
  // non-source blocks; the engine only calls it for sources).
  virtual double sample_gap(Xoshiro256PlusPlus& rng) = 0;

  // Source generation contract. One arrival event may create several
  // entities; max_arrival_events() limits arrival events (not entities),
  // matching AnyLogic Source semantics. A negative maximum is unlimited.
  [[nodiscard]] virtual std::int64_t agents_per_arrival() const { return 1; }
  [[nodiscard]] virtual std::int64_t max_arrival_events() const { return -1; }
  [[nodiscard]] virtual bool source_is_manual() const { return false; }
  virtual double sample_first_gap(Xoshiro256PlusPlus& rng) {
    return sample_gap(rng);
  }

  // Attribute defaults the emitting source stamps on each created entity.
  virtual const std::unordered_map<std::string, double>& attribute_defaults()
      const {
    static const std::unordered_map<std::string, double> kEmpty;
    return kEmpty;
  }

  // The ResourcePool this block draws units from ("" for non-pool blocks).
  [[nodiscard]] virtual std::string pool_resource() const { return ""; }

  // SelectOutputIn: the engine resolves the associated SelectOutputOut
  // blocks (declared via `selectOutputIn` refs) after all blocks are built
  // and hands them to the block as {name, probability} targets.
  virtual void set_routing_targets(
      const std::vector<std::pair<std::string, double>>& targets) {
    (void)targets;
  }
};

// Shared buffering/counter state for the common input -> forward model.
class BufferedBlock : public ProcessBlock {
 public:
  BufferedBlock(std::string kind, std::string name, std::int64_t capacity)
      : kind_(std::move(kind)), name_(std::move(name)), capacity_(capacity) {}

  [[nodiscard]] std::string_view kind() const final { return kind_; }
  [[nodiscard]] std::string_view name() const final { return name_; }

  [[nodiscard]] bool can_accept(const Entity&) override {
    return capacity_ < 0 ||
           static_cast<std::int64_t>(input_.size()) < capacity_;
  }

  void receive(const Entity& entity) override {
    ++arrived_;
    input_.push_back(entity);
  }

  [[nodiscard]] bool has_in_service() const override { return false; }
  [[nodiscard]] std::size_t buffered() const final { return input_.size(); }
  [[nodiscard]] bool has_outgoing() const final { return !outgoing_.empty(); }
  [[nodiscard]] std::uint64_t arrived() const final { return arrived_; }
  [[nodiscard]] std::uint64_t departed() const final { return departed_; }
  [[nodiscard]] std::int64_t busy_units() const override { return 0; }
  [[nodiscard]] std::int64_t pool_capacity() const override { return 0; }
  [[nodiscard]] double area_occupancy() const final { return area_occupancy_; }
  [[nodiscard]] double area_busy() const final { return area_busy_; }
  [[nodiscard]] double area_down() const override { return area_down_; }
  [[nodiscard]] std::int64_t buffer_capacity() const final {
    return capacity_;
  }

  void accumulate_areas(std::int64_t dt_ns) override {
    area_occupancy_ +=
        static_cast<double>(dt_ns) * static_cast<double>(input_.size());
    area_busy_ += static_cast<double>(dt_ns) * 0.0;
  }

  void reset_stats() override {
    arrived_ = 0;
    departed_ = 0;
    area_occupancy_ = 0.0;
    area_busy_ = 0.0;
  }

  void clear_buffers() override {
    input_.clear();
    outgoing_.clear();
  }

  bool retry_outgoing(BlockContext& ctx) override {
    if (outgoing_.empty()) {
      return false;
    }
    Entity entity = outgoing_.front();
    if (ctx.emit(entity, "out")) {
      outgoing_.pop_front();
      return true;
    }
    return false;
  }

  void complete(BlockContext&, std::uint64_t) override {}
  void on_failure(BlockContext&, std::uint64_t) override {}
  void on_repair(BlockContext&, std::uint64_t) override {}
  void on_timeout(BlockContext&, std::uint64_t) override {}

  double sample_gap(Xoshiro256PlusPlus&) override { return 0.0; }

 protected:
  std::deque<Entity> input_;
  std::deque<Entity> outgoing_;
  std::string kind_;
  std::string name_;
  std::int64_t capacity_{-1};
  std::uint64_t arrived_{0};
  std::uint64_t departed_{0};
  double area_occupancy_{0.0};
  double area_busy_{0.0};
  double area_down_{0.0};
};

}  // namespace logicpilot::process

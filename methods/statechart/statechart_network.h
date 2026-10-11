// Composite Statechart runtime for a model root containing multiple
// statechart nodes. Couplings route transition `emit` actions to message
// transitions in sibling statecharts without changing the frozen IR schema.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include <span>

#include "logicpilot/runtime/replication.h"
#include "statechart_replication.h"

namespace logicpilot {
namespace ir::v2 {
struct Node;
}
class RuntimeContext;

struct StatechartSnapshot {
  std::string name;
  std::string state;
  std::uint64_t steps{0};
};

class StatechartNetworkReplicationModel final : public ReplicationModel {
 public:
  explicit StatechartNetworkReplicationModel(const ir::v2::Node* root,
                                             std::string* error);
  ~StatechartNetworkReplicationModel() override;

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  bool reset(const ReplicationConfig& config);
  void cancel_pending_events();
  void attach(RuntimeContext& context);
  std::size_t advance(SimTime until);
  bool dispatch_message(const std::string& port);
  // See StatechartReplicationModel::inject: the port is the whole message.
  bool inject(const std::string& port, std::uint64_t payload) override;
  [[nodiscard]] bool done() const;
  [[nodiscard]] bool has_pending_events();
  [[nodiscard]] bool failed() const;
  [[nodiscard]] const std::string& failure_reason() const;
  [[nodiscard]] ReplicationMetrics metrics() const;
  [[nodiscard]] std::vector<StatechartSnapshot> snapshots() const;
  [[nodiscard]] bool checkpoint_save(std::vector<std::uint8_t>& state) const;
  bool checkpoint_restore(std::span<const std::uint8_t> state);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

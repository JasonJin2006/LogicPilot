// Composite Statechart runtime for a model root containing multiple
// statechart nodes. Couplings route transition `emit` actions to message
// transitions in sibling statecharts without changing the frozen IR schema.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/replication.h"
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
  [[nodiscard]] bool done() const;
  [[nodiscard]] bool has_pending_events();
  [[nodiscard]] ReplicationMetrics metrics() const;
  [[nodiscard]] std::vector<StatechartSnapshot> snapshots() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace logicpilot

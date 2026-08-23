// Versioned method/runtime state bundle for a persistent simulation session.
#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <queue>
#include <string>
#include <unordered_set>
#include <vector>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/state/message_store.h"
#include "logicpilot/state/variable_store.h"

namespace logicpilot {

struct MethodCheckpoint {
  std::string method;
  std::uint32_t schema_version{1};
  SimTime now{SimTime::zero()};
  std::vector<std::uint8_t> state;
};

class MethodCheckpointMigrationRegistry {
 public:
  using Migration = std::function<bool(const MethodCheckpoint& source,
                                       MethodCheckpoint& target,
                                       std::string* error)>;

  bool register_migration(std::string method, std::uint32_t from_schema,
                          std::uint32_t to_schema, Migration migration) {
    if (method.empty() || !migration || from_schema == to_schema) return false;
    migrations_[Key{std::move(method), from_schema, to_schema}] =
        std::move(migration);
    return true;
  }

  [[nodiscard]] bool migrate(const MethodCheckpoint& source,
                             std::uint32_t target_schema,
                             MethodCheckpoint& target,
                             std::string* error = nullptr) const {
    if (source.schema_version == target_schema) {
      target = source;
      return true;
    }
    struct Candidate {
      MethodCheckpoint checkpoint;
    };
    std::queue<Candidate> pending;
    std::unordered_set<std::uint32_t> visited;
    pending.push(Candidate{source});
    visited.insert(source.schema_version);
    std::string last_error;
    while (!pending.empty()) {
      Candidate current = std::move(pending.front());
      pending.pop();
      for (const auto& [key, migration] : migrations_) {
        if (key.method != source.method ||
            key.from_schema != current.checkpoint.schema_version ||
            visited.count(key.to_schema) != 0) {
          continue;
        }
        MethodCheckpoint next;
        std::string migration_error;
        if (!migration(current.checkpoint, next, &migration_error) ||
            next.method != source.method ||
            next.schema_version != key.to_schema) {
          last_error = migration_error.empty()
                           ? "checkpoint migration rejected its target"
                           : migration_error;
          continue;
        }
        if (key.to_schema == target_schema) {
          target = std::move(next);
          return true;
        }
        visited.insert(key.to_schema);
        pending.push(Candidate{std::move(next)});
      }
    }
    if (error != nullptr) {
      *error = last_error.empty() ? "no checkpoint migration path registered"
                                  : last_error;
    }
    return false;
  }

 private:
  struct Key {
    std::string method;
    std::uint32_t from_schema{0};
    std::uint32_t to_schema{0};
    bool operator<(const Key& other) const {
      if (method != other.method) return method < other.method;
      if (from_schema != other.from_schema) return from_schema < other.from_schema;
      return to_schema < other.to_schema;
    }
  };
  std::map<Key, Migration> migrations_;
};

struct SimulationSessionCheckpoint {
  SimTime now{SimTime::zero()};
  // Cumulative shared-scheduler dispatch count for the replication. Keeping
  // it outside method-private bundles prevents sliced advance() calls from
  // resetting the global event budget after restore.
  std::uint64_t dispatched_events{0};
  // Stable FNV fingerprint of the verified model bytes. Zero is a legacy
  // checkpoint marker that predates model identity validation.
  std::uint64_t model_fingerprint{0};
  std::vector<VariableSnapshot> variables;
  std::vector<MessageEnvelope> messages;
  std::vector<MethodCheckpoint> methods;
};

struct SessionMigrationAuditEntry {
  std::uint64_t source_fingerprint{0};
  std::uint64_t target_fingerprint{0};
  bool success{false};
  std::string error;
};

class SessionCheckpointMigrationRegistry {
 public:
  using Migration = std::function<bool(
      const SimulationSessionCheckpoint& source,
      std::uint64_t target_fingerprint,
      SimulationSessionCheckpoint& target, std::string* error)>;

  bool register_migration(std::uint64_t source_fingerprint,
                          std::uint64_t target_fingerprint,
                          Migration migration) {
    if (source_fingerprint == 0 || target_fingerprint == 0 || !migration ||
        source_fingerprint == target_fingerprint) return false;
    migrations_[Key{source_fingerprint, target_fingerprint}] =
        std::move(migration);
    return true;
  }

  [[nodiscard]] bool migrate(const SimulationSessionCheckpoint& source,
                             std::uint64_t target_fingerprint,
                             SimulationSessionCheckpoint& target,
                             std::string* error = nullptr) const {
    const auto it = migrations_.find(
        Key{source.model_fingerprint, target_fingerprint});
    if (it == migrations_.end()) {
      const std::string message = "no session checkpoint migration registered";
      if (error != nullptr) *error = message;
      audit_.push_back(SessionMigrationAuditEntry{source.model_fingerprint,
                                                  target_fingerprint, false,
                                                  message});
      return false;
    }
    std::string local_error;
    const bool success = it->second(source, target_fingerprint, target,
                                    &local_error);
    if (error != nullptr) *error = local_error;
    audit_.push_back(SessionMigrationAuditEntry{source.model_fingerprint,
                                                target_fingerprint, success,
                                                local_error});
    return success;
  }

  void clear_audit_log() const { audit_.clear(); }
  [[nodiscard]] const std::vector<SessionMigrationAuditEntry>& audit_log()
      const {
    return audit_;
  }

 private:
  struct Key {
    std::uint64_t source{0};
    std::uint64_t target{0};
    bool operator<(const Key& other) const {
      return source != other.source ? source < other.source
                                    : target < other.target;
    }
  };
  std::map<Key, Migration> migrations_;
  mutable std::vector<SessionMigrationAuditEntry> audit_;
};

}  // namespace logicpilot

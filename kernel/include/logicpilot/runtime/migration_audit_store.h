// Durable adapter for migration audit archives.
#pragma once

#include <filesystem>
#include <exception>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/runtime/migration_audit_codec.h"
#include "logicpilot/devs/checkpoint_store.h"

namespace logicpilot {

class FileMigrationAuditStore {
 public:
  explicit FileMigrationAuditStore(std::filesystem::path path)
      : store_(std::move(path)) {}

  bool save(std::span<const SessionMigrationAuditEntry> entries,
            std::string* error = nullptr) {
    try {
      const auto archive = MigrationAuditCodec::encode(entries);
      return store_.write(archive, error);
    } catch (const std::exception& exception) {
      if (error != nullptr) *error = exception.what();
      return false;
    }
  }

  bool load(std::vector<SessionMigrationAuditEntry>& entries,
            std::string* error = nullptr) const {
    std::vector<std::uint8_t> archive;
    if (!store_.read(archive, error)) return false;
    return MigrationAuditCodec::decode(archive, entries, error);
  }

  [[nodiscard]] const std::filesystem::path& path() const {
    return store_.path();
  }

 private:
  FileCheckpointBlobStore store_;
};

}  // namespace logicpilot

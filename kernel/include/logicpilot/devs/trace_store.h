// Durable boundary for portable LPLT logical-step trace archives.
#pragma once

#include <filesystem>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/devs/replication.h"

namespace logicpilot {

class FileLogicalTraceArchiveStore final {
 public:
  explicit FileLogicalTraceArchiveStore(std::filesystem::path path)
      : path_(std::move(path)) {}

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }
  bool save(std::span<const LogicalStepRecord> records,
            std::string* error = nullptr) const;
  bool save(const TraceRecorder& trace, std::string* error = nullptr) const {
    return save(trace.logical_steps(), error);
  }
  bool load(std::vector<LogicalStepRecord>& records,
            std::string* error = nullptr) const;

 private:
  std::filesystem::path path_;
};

}  // namespace logicpilot

// Append-only durable journal for versioned DEVS checkpoint archives.
#pragma once

#include <filesystem>
#include <string>
#include <utility>

#include "logicpilot/devs/checkpoint.h"

namespace logicpilot {

class DevsCheckpointJournal {
 public:
  explicit DevsCheckpointJournal(std::filesystem::path path)
      : path_(std::move(path)) {}

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }

  // Appends one self-validating archive record. The implementation flushes
  // the stream before returning; an OS-specific fsync can be layered above.
  bool append(const DevsCheckpoint& checkpoint, std::string* error = nullptr);

  // Returns the last complete, checksum-valid checkpoint. A truncated or
  // corrupt tail is ignored when an earlier valid record exists. The optional
  // flag reports whether any tail bytes were discarded during the scan.
  bool load_latest(DevsCheckpoint& checkpoint, std::string* error = nullptr,
                   bool* truncated_tail = nullptr) const;

  // Rewrites the journal to one valid latest record. This is an offline
  // maintenance operation; callers should coordinate writers around it.
  bool compact_latest(std::string* error = nullptr);

 private:
  std::filesystem::path path_;
};

}  // namespace logicpilot

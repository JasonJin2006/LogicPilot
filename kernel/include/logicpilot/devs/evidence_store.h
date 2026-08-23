// Durable boundary for portable LPEV evidence archives.
#pragma once

#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/devs/evidence.h"

namespace logicpilot {

class FileEvidenceArchiveStore final {
 public:
  explicit FileEvidenceArchiveStore(std::filesystem::path path)
      : path_(std::move(path)) {}

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }
  bool save(const DevsEvidenceRecorder& recorder, std::string* error = nullptr) const;
  bool load(DevsEvidenceRecorder& recorder, std::string* error = nullptr) const;

 private:
  std::filesystem::path path_;
};

}  // namespace logicpilot

// External blob-store seam for transformed checkpoint archives.
#pragma once

#include <filesystem>
#include <cstdint>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace logicpilot {

class IDevsCheckpointBlobStore {
 public:
  virtual ~IDevsCheckpointBlobStore() = default;
  virtual bool write(std::span<const std::uint8_t> bytes,
                     std::string* error = nullptr) = 0;
  virtual bool read(std::vector<std::uint8_t>& bytes,
                    std::string* error = nullptr) const = 0;
};

class FileCheckpointBlobStore final : public IDevsCheckpointBlobStore {
 public:
  explicit FileCheckpointBlobStore(std::filesystem::path path)
      : path_(std::move(path)) {}

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }
  bool write(std::span<const std::uint8_t> bytes,
             std::string* error = nullptr) override;
  bool read(std::vector<std::uint8_t>& bytes,
            std::string* error = nullptr) const override;

 private:
  std::filesystem::path path_;
};

}  // namespace logicpilot

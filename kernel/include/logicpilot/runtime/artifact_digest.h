// Small dependency-free SHA-256 boundary for plugin artifact pinning.
#pragma once

#include <cstdint>
#include <filesystem>
#include <span>
#include <string>
#include <string_view>

namespace logicpilot {

class ArtifactDigest {
 public:
  [[nodiscard]] static std::string sha256(std::span<const std::uint8_t> bytes);
  [[nodiscard]] static bool sha256_file(const std::filesystem::path& path,
                                        std::string& digest,
                                        std::string* error = nullptr);
  [[nodiscard]] static bool is_sha256_hex(std::string_view value);
};

}  // namespace logicpilot

// Pluggable transform/envelope boundary for checkpoint archives.
#pragma once

#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "logicpilot/devs/checkpoint_codec.h"

namespace logicpilot {

class IDevsCheckpointTransform {
 public:
  virtual ~IDevsCheckpointTransform() = default;
  [[nodiscard]] virtual std::string_view name() const = 0;
  virtual bool encode(std::span<const std::uint8_t> plain,
                      std::vector<std::uint8_t>& transformed,
                      std::string* error = nullptr) const = 0;
  virtual bool decode(std::span<const std::uint8_t> transformed,
                      std::vector<std::uint8_t>& plain,
                      std::string* error = nullptr) const = 0;
};

class IdentityCheckpointTransform final : public IDevsCheckpointTransform {
 public:
  [[nodiscard]] std::string_view name() const override { return "identity"; }
  bool encode(std::span<const std::uint8_t> plain,
              std::vector<std::uint8_t>& transformed,
              std::string* error = nullptr) const override {
    if (error != nullptr) error->clear();
    transformed.assign(plain.begin(), plain.end());
    return true;
  }
  bool decode(std::span<const std::uint8_t> transformed,
              std::vector<std::uint8_t>& plain,
              std::string* error = nullptr) const override {
    if (error != nullptr) error->clear();
    plain.assign(transformed.begin(), transformed.end());
    return true;
  }
};

namespace checkpoint_transform_detail {
constexpr std::uint32_t kMagic = 0x4C504145U;  // LPAE
constexpr std::uint8_t kVersion = 1;
constexpr std::uint32_t kMaxName = 256;
constexpr std::uint32_t kMaxPayload = 512U * 1024U * 1024U;

inline void append_u32(std::vector<std::uint8_t>& bytes,
                       std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}
inline void append_u64(std::vector<std::uint8_t>& bytes,
                       std::uint64_t value) {
  for (int shift = 0; shift < 64; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}
inline bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << shift;
  }
  return true;
}
inline bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int shift = 0; shift < 64; shift += 8) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << shift;
  }
  return true;
}
inline std::uint64_t checksum(std::span<const std::uint8_t> bytes) {
  std::uint64_t hash = 1469598103934665603ULL;
  for (std::uint8_t byte : bytes) {
    hash ^= byte;
    hash *= 1099511628211ULL;
  }
  return hash;
}
}  // namespace checkpoint_transform_detail

class RleCheckpointTransform final : public IDevsCheckpointTransform {
 public:
  [[nodiscard]] std::string_view name() const override { return "rle-v1"; }

  bool encode(std::span<const std::uint8_t> plain,
              std::vector<std::uint8_t>& transformed,
              std::string* error = nullptr) const override {
    using namespace checkpoint_transform_detail;
    if (error != nullptr) error->clear();
    if (plain.size() > kMaxPayload ||
        plain.size() > std::numeric_limits<std::uint32_t>::max()) {
      if (error != nullptr) *error = "RLE input too large";
      return false;
    }
    std::vector<std::uint8_t> raw;
    raw.reserve(1 + 4 + plain.size());
    raw.push_back(0);
    append_u32(raw, static_cast<std::uint32_t>(plain.size()));
    raw.insert(raw.end(), plain.begin(), plain.end());

    std::vector<std::uint8_t> compressed;
    compressed.reserve(raw.size());
    compressed.push_back(1);
    append_u32(compressed, static_cast<std::uint32_t>(plain.size()));
    std::size_t offset = 0;
    while (offset < plain.size()) {
      const std::size_t run_start = offset;
      while (offset < plain.size() && offset - run_start < 128 &&
             plain[offset] == plain[run_start]) {
        ++offset;
      }
      const std::size_t run_length = offset - run_start;
      if (run_length >= 4) {
        compressed.push_back(static_cast<std::uint8_t>(0x80U |
                                                       (run_length - 1)));
        compressed.push_back(plain[run_start]);
        continue;
      }
      offset = run_start;
      const std::size_t literal_start = offset;
      while (offset < plain.size() && offset - literal_start < 128) {
        const std::size_t candidate = offset;
        while (offset < plain.size() && offset - candidate < 128 &&
               plain[offset] == plain[candidate]) {
          ++offset;
        }
        if (offset - candidate >= 4) {
          offset = candidate;
          break;
        }
      }
      const std::size_t literal_length = offset - literal_start;
      if (literal_length == 0) {
        if (error != nullptr) *error = "RLE encoder made no progress";
        return false;
      }
      compressed.push_back(static_cast<std::uint8_t>(literal_length - 1));
      compressed.insert(compressed.end(), plain.begin() +
                                              static_cast<std::ptrdiff_t>(literal_start),
                        plain.begin() +
                            static_cast<std::ptrdiff_t>(offset));
    }
    transformed = compressed.size() < raw.size() ? std::move(compressed)
                                                  : std::move(raw);
    return true;
  }

  bool decode(std::span<const std::uint8_t> transformed,
              std::vector<std::uint8_t>& plain,
              std::string* error = nullptr) const override {
    using namespace checkpoint_transform_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (transformed.size() < 5) return fail("RLE payload too small");
    const std::uint8_t mode = transformed[0];
    std::size_t offset = 1;
    std::uint32_t expected = 0;
    if (!read_u32(transformed, offset, expected) || expected > kMaxPayload) {
      return fail("invalid RLE length");
    }
    if (mode == 0) {
      if (transformed.size() - offset != expected) {
        return fail("invalid RLE raw payload");
      }
      plain.assign(transformed.begin() + static_cast<std::ptrdiff_t>(offset),
                   transformed.end());
      return true;
    }
    if (mode != 1) return fail("unsupported RLE mode");
    plain.clear();
    plain.reserve(expected);
    while (offset < transformed.size()) {
      const std::uint8_t token = transformed[offset++];
      const std::size_t length = static_cast<std::size_t>(token & 0x7FU) + 1;
      if (plain.size() + length > expected) return fail("RLE output overflow");
      if ((token & 0x80U) != 0) {
        if (offset >= transformed.size()) return fail("truncated RLE run");
        plain.insert(plain.end(), length, transformed[offset++]);
      } else {
        if (length > transformed.size() - offset) {
          return fail("truncated RLE literal");
        }
        plain.insert(plain.end(), transformed.begin() +
                                      static_cast<std::ptrdiff_t>(offset),
                     transformed.begin() +
                         static_cast<std::ptrdiff_t>(offset + length));
        offset += length;
      }
    }
    if (plain.size() != expected) return fail("RLE output length mismatch");
    return true;
  }
};

class DevsCheckpointArchivePipeline {
 public:
  static bool encode(const DevsCheckpoint& checkpoint,
                     const IDevsCheckpointTransform& transform,
                     std::vector<std::uint8_t>& archive,
                     std::string* error = nullptr) {
    using namespace checkpoint_transform_detail;
    if (error != nullptr) error->clear();
    const std::vector<std::uint8_t> plain =
        DevsCheckpointCodec::encode(checkpoint);
    std::vector<std::uint8_t> payload;
    if (!transform.encode(plain, payload, error) ||
        payload.size() > kMaxPayload ||
        transform.name().size() > kMaxName) {
      if (error != nullptr && error->empty()) *error = "checkpoint transform failed";
      return false;
    }
    archive.clear();
    append_u32(archive, kMagic);
    archive.push_back(kVersion);
    append_u32(archive, static_cast<std::uint32_t>(transform.name().size()));
    archive.insert(archive.end(), transform.name().begin(), transform.name().end());
    append_u64(archive, static_cast<std::uint64_t>(payload.size()));
    archive.insert(archive.end(), payload.begin(), payload.end());
    append_u64(archive, checksum(archive));
    return true;
  }

  static bool decode(std::span<const std::uint8_t> archive,
                     const IDevsCheckpointTransform& transform,
                     DevsCheckpoint& checkpoint, std::string* error = nullptr) {
    using namespace checkpoint_transform_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (archive.size() < 4 + 1 + 4 + 8 + 8) {
      return fail("checkpoint envelope too small");
    }
    std::size_t checksum_offset = archive.size() - 8;
    std::uint64_t expected = 0;
    if (!read_u64(archive, checksum_offset, expected) ||
        checksum(archive.first(archive.size() - 8)) != expected) {
      return fail("checkpoint envelope checksum mismatch");
    }
    std::size_t offset = 0;
    std::uint32_t magic = 0, name_size = 0;
    if (!read_u32(archive, offset, magic) || magic != kMagic ||
        offset >= archive.size() || archive[offset++] != kVersion ||
        !read_u32(archive, offset, name_size) || name_size > kMaxName ||
        name_size > archive.size() - offset) {
      return fail("unsupported checkpoint envelope");
    }
    const std::string_view name(
        reinterpret_cast<const char*>(archive.data() + offset), name_size);
    offset += name_size;
    if (name != transform.name()) return fail("checkpoint transform mismatch");
    std::uint64_t payload_size = 0;
    if (!read_u64(archive, offset, payload_size) ||
        offset > archive.size() - 8 || payload_size > kMaxPayload ||
        payload_size > archive.size() - offset - 8) {
      return fail("invalid checkpoint envelope payload");
    }
    std::vector<std::uint8_t> plain;
    if (!transform.decode(archive.subspan(offset, payload_size), plain, error)) {
      return false;
    }
    if (!DevsCheckpointCodec::decode(plain, checkpoint, error)) return false;
    offset += static_cast<std::size_t>(payload_size);
    return offset == archive.size() - 8 ? true : fail("trailing checkpoint envelope bytes");
  }
};

}  // namespace logicpilot

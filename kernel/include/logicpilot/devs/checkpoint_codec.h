// Portable binary archive for DevsCheckpoint.
#pragma once

#include <cstdint>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

#include "logicpilot/devs/checkpoint.h"

namespace logicpilot {

namespace devs_checkpoint_detail {

constexpr std::uint32_t kMagic = 0x4C504344U;  // LPCD
constexpr std::uint8_t kVersion = 1;
constexpr std::uint32_t kMaxCount = 1'000'000;
constexpr std::uint32_t kMaxBlob = 256U * 1024U * 1024U;

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
  for (const std::uint8_t byte : bytes) {
    hash ^= byte;
    hash *= 1099511628211ULL;
  }
  return hash;
}

inline void append_blob(std::vector<std::uint8_t>& bytes,
                        std::span<const std::uint8_t> blob) {
  if (blob.size() > kMaxBlob || blob.size() > std::numeric_limits<std::uint32_t>::max()) {
    throw std::length_error("DevsCheckpointCodec: blob too large");
  }
  append_u32(bytes, static_cast<std::uint32_t>(blob.size()));
  bytes.insert(bytes.end(), blob.begin(), blob.end());
}

inline bool read_blob(std::span<const std::uint8_t> bytes, std::size_t& offset,
                      std::vector<std::uint8_t>& blob) {
  std::uint32_t size = 0;
  if (!read_u32(bytes, offset, size) || size > kMaxBlob ||
      size > bytes.size() - offset) return false;
  blob.assign(bytes.begin() + static_cast<std::ptrdiff_t>(offset),
              bytes.begin() + static_cast<std::ptrdiff_t>(offset + size));
  offset += size;
  return true;
}

inline void append_string(std::vector<std::uint8_t>& bytes,
                          const std::string& value) {
  append_blob(bytes, std::span<const std::uint8_t>(
                           reinterpret_cast<const std::uint8_t*>(value.data()),
                           value.size()));
}

inline bool read_string(std::span<const std::uint8_t> bytes,
                        std::size_t& offset, std::string& value) {
  std::vector<std::uint8_t> blob;
  if (!read_blob(bytes, offset, blob)) return false;
  if (blob.empty()) {
    value.clear();
    return true;
  }
  value.assign(reinterpret_cast<const char*>(blob.data()), blob.size());
  return true;
}

}  // namespace devs_checkpoint_detail

class DevsCheckpointCodec {
 public:
  [[nodiscard]] static std::vector<std::uint8_t> encode(
      const DevsCheckpoint& checkpoint) {
    using namespace devs_checkpoint_detail;
    if (checkpoint.atoms.size() > kMaxCount ||
        checkpoint.replay_watermarks.size() > kMaxCount) {
      throw std::length_error("DevsCheckpointCodec: checkpoint count too large");
    }
    std::vector<std::uint8_t> bytes;
    append_u32(bytes, kMagic);
    bytes.push_back(kVersion);
    append_u64(bytes, checkpoint.recovery_epoch);
    append_u64(bytes, static_cast<std::uint64_t>(checkpoint.now.as_ns()));
    append_u64(bytes, checkpoint.dispatched);
    append_u64(bytes, checkpoint.internal_transitions);
    append_u64(bytes, checkpoint.internal_budget);
    append_u32(bytes, static_cast<std::uint32_t>(
                              checkpoint.replay_watermarks.size()));
    for (const std::uint64_t watermark : checkpoint.replay_watermarks) {
      append_u64(bytes, watermark);
    }
    append_u32(bytes, static_cast<std::uint32_t>(checkpoint.atoms.size()));
    for (const DevsAtomCheckpoint& atom : checkpoint.atoms) {
      append_string(bytes, atom.atom_path);
      append_u64(bytes, static_cast<std::uint64_t>(atom.last_transition.as_ns()));
      append_blob(bytes, atom.state);
    }
    append_u64(bytes, checksum(bytes));
    return bytes;
  }

  [[nodiscard]] static bool decode(std::span<const std::uint8_t> bytes,
                                   DevsCheckpoint& checkpoint,
                                   std::string* error = nullptr) {
    using namespace devs_checkpoint_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (bytes.size() < 4 + 1 + 8) return fail("checkpoint archive too small");
    std::size_t checksum_offset = bytes.size() - 8;
    std::uint64_t expected_checksum = 0;
    if (!read_u64(bytes, checksum_offset, expected_checksum) ||
        checksum(bytes.first(bytes.size() - 8)) != expected_checksum) {
      return fail("checkpoint archive checksum mismatch");
    }
    std::size_t offset = 0;
    std::uint32_t magic = 0;
    if (!read_u32(bytes, offset, magic) || magic != kMagic ||
        offset >= bytes.size() || bytes[offset++] != kVersion) {
      return fail("unsupported checkpoint archive");
    }
    DevsCheckpoint decoded;
    std::uint64_t raw = 0;
    if (!read_u64(bytes, offset, decoded.recovery_epoch) ||
        !read_u64(bytes, offset, raw)) return fail("invalid checkpoint header");
    decoded.now = SimTime::from_ns(static_cast<std::int64_t>(raw));
    if (!read_u64(bytes, offset, decoded.dispatched) ||
        !read_u64(bytes, offset, decoded.internal_transitions) ||
        !read_u64(bytes, offset, decoded.internal_budget)) {
      return fail("invalid checkpoint counters");
    }
    std::uint32_t count = 0;
    if (!read_u32(bytes, offset, count) || count > kMaxCount) {
      return fail("invalid replay watermark count");
    }
    decoded.replay_watermarks.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      std::uint64_t watermark = 0;
      if (!read_u64(bytes, offset, watermark)) {
        return fail("truncated replay watermark");
      }
      decoded.replay_watermarks.push_back(watermark);
    }
    if (!read_u32(bytes, offset, count) || count > kMaxCount) {
      return fail("invalid atom count");
    }
    decoded.atom_paths.reserve(count);
    decoded.atoms.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      DevsAtomCheckpoint atom;
      if (!read_string(bytes, offset, atom.atom_path) ||
          !read_u64(bytes, offset, raw) ||
          !read_blob(bytes, offset, atom.state)) {
        return fail("truncated atom checkpoint");
      }
      atom.last_transition = SimTime::from_ns(static_cast<std::int64_t>(raw));
      decoded.atom_paths.push_back(atom.atom_path);
      decoded.atoms.push_back(std::move(atom));
    }
    if (offset != bytes.size() - 8) return fail("trailing checkpoint bytes");
    checkpoint = std::move(decoded);
    return true;
  }
};

}  // namespace logicpilot

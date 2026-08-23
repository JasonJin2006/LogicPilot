// Portable archive for SessionMigrationAuditEntry records.
#pragma once

#include <cstdint>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/runtime/method_checkpoint.h"

namespace logicpilot {
namespace migration_audit_detail {
constexpr std::uint32_t kMagic = 0x4C504D54U;  // LPMT
constexpr std::uint8_t kVersion = 1;
constexpr std::uint32_t kMaxCount = 100'000;
constexpr std::uint32_t kMaxError = 1'000'000;
inline void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8)
    out.push_back(static_cast<std::uint8_t>(value >> shift));
}
inline void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  for (int shift = 0; shift < 64; shift += 8)
    out.push_back(static_cast<std::uint8_t>(value >> shift));
}
inline bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int shift = 0; shift < 32; shift += 8)
    value |= static_cast<std::uint32_t>(bytes[offset++]) << shift;
  return true;
}
inline bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int shift = 0; shift < 64; shift += 8)
    value |= static_cast<std::uint64_t>(bytes[offset++]) << shift;
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
}  // namespace migration_audit_detail

class MigrationAuditCodec {
 public:
  [[nodiscard]] static std::vector<std::uint8_t> encode(
      std::span<const SessionMigrationAuditEntry> entries) {
    using namespace migration_audit_detail;
    if (entries.size() > kMaxCount)
      throw std::length_error("migration audit count too large");
    std::vector<std::uint8_t> out;
    append_u32(out, kMagic);
    out.push_back(kVersion);
    append_u32(out, static_cast<std::uint32_t>(entries.size()));
    for (const auto& entry : entries) {
      if (entry.error.size() > kMaxError)
        throw std::length_error("migration audit error too large");
      append_u64(out, entry.source_fingerprint);
      append_u64(out, entry.target_fingerprint);
      out.push_back(entry.success ? 1 : 0);
      append_u32(out, static_cast<std::uint32_t>(entry.error.size()));
      out.insert(out.end(), entry.error.begin(), entry.error.end());
    }
    append_u64(out, checksum(out));
    return out;
  }

  static bool decode(std::span<const std::uint8_t> bytes,
                     std::vector<SessionMigrationAuditEntry>& entries,
                     std::string* error = nullptr) {
    using namespace migration_audit_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (bytes.size() < 4 + 1 + 4 + 8)
      return fail("migration audit archive too small");
    std::size_t checksum_offset = bytes.size() - 8;
    std::uint64_t expected = 0;
    if (!read_u64(bytes, checksum_offset, expected) ||
        checksum(bytes.first(bytes.size() - 8)) != expected)
      return fail("migration audit archive checksum mismatch");
    std::size_t offset = 0;
    std::uint32_t magic = 0, count = 0;
    if (!read_u32(bytes, offset, magic) || magic != kMagic ||
        offset >= bytes.size() || bytes[offset++] != kVersion ||
        !read_u32(bytes, offset, count) || count > kMaxCount)
      return fail("unsupported migration audit archive");
    std::vector<SessionMigrationAuditEntry> decoded;
    decoded.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      SessionMigrationAuditEntry entry;
      std::uint32_t error_size = 0;
      if (!read_u64(bytes, offset, entry.source_fingerprint) ||
          !read_u64(bytes, offset, entry.target_fingerprint) ||
          offset >= bytes.size() || bytes[offset] > 1)
        return fail("truncated migration audit entry");
      entry.success = bytes[offset++] != 0;
      if (!read_u32(bytes, offset, error_size) || error_size > kMaxError ||
          error_size > bytes.size() - offset)
        return fail("truncated migration audit entry");
      entry.error.assign(reinterpret_cast<const char*>(bytes.data() + offset),
                         error_size);
      offset += error_size;
      decoded.push_back(std::move(entry));
    }
    if (offset != bytes.size() - 8)
      return fail("trailing migration audit bytes");
    entries = std::move(decoded);
    return true;
  }
};

}  // namespace logicpilot

// Portable archive for bounded logical-step traces (LPLT).
//
// The format is deliberately independent of FlatBuffers: little-endian,
// length-delimited, versioned, bounded, and protected by an FNV-1a footer.
#pragma once

#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/runtime/replication.h"

namespace logicpilot {

class LogicalTraceCodec {
 public:
  static constexpr std::uint32_t kMagic = 0x544C504CU;  // LPLT
  static constexpr std::uint32_t kVersion = 1;
  static constexpr std::size_t kMaxArchiveBytes = 64U * 1024U * 1024U;
  static constexpr std::uint64_t kMaxRecords = 10'000'000;

  static bool encode(std::span<const LogicalStepRecord> records,
                     std::vector<std::uint8_t>& output,
                     std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    output.clear();
    if (records.size() > kMaxRecords) {
      return fail(error, "logical trace record count exceeds archive limit");
    }
    append_u32(output, kMagic);
    append_u32(output, kVersion);
    append_u64(output, records.size());
    for (const LogicalStepRecord& record : records) {
      if (record.at.as_ns() < 0) {
        output.clear();
        return fail(error, "logical trace timestamp is negative");
      }
      append_u64(output, static_cast<std::uint64_t>(record.at.as_ns()));
      append_u32(output, record.type);
      append_u64(output, record.payload);
      if (output.size() > kMaxArchiveBytes - sizeof(std::uint64_t)) {
        output.clear();
        return fail(error, "logical trace archive exceeds byte limit");
      }
    }
    append_u64(output, checksum(output));
    return true;
  }

  static bool decode(std::span<const std::uint8_t> bytes,
                     std::vector<LogicalStepRecord>& records,
                     std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    records.clear();
    if (bytes.size() < 4 + 4 + 8 + 8 || bytes.size() > kMaxArchiveBytes) {
      return fail(error, "invalid logical trace archive size");
    }
    const std::uint64_t stored = read_u64_at(bytes, bytes.size() - 8);
    if (checksum(bytes.first(bytes.size() - 8)) != stored) {
      return fail(error, "logical trace archive checksum mismatch");
    }
    std::size_t offset = 0;
    std::uint32_t magic = 0, version = 0;
    std::uint64_t count = 0;
    if (!read_u32(bytes, offset, magic) || !read_u32(bytes, offset, version) ||
        !read_u64(bytes, offset, count) || magic != kMagic ||
        version != kVersion || count > kMaxRecords) {
      return fail(error, "unsupported logical trace archive header");
    }
    records.reserve(static_cast<std::size_t>(count));
    for (std::uint64_t index = 0; index < count; ++index) {
      std::uint64_t at = 0, payload = 0;
      std::uint32_t type = 0;
      if (!read_u64(bytes, offset, at) || !read_u32(bytes, offset, type) ||
          !read_u64(bytes, offset, payload) ||
          at > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        records.clear();
        return fail(error, "truncated logical trace record");
      }
      records.push_back(LogicalStepRecord{SimTime::from_ns(static_cast<std::int64_t>(at)),
                                          type, payload});
    }
    if (offset != bytes.size() - sizeof(std::uint64_t)) {
      records.clear();
      return fail(error, "trailing logical trace bytes");
    }
    return true;
  }

 private:
  static bool fail(std::string* error, const char* message) {
    if (error != nullptr) *error = message;
    return false;
  }
  static void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
    for (int byte = 0; byte < 4; ++byte)
      out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
  static void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
    for (int byte = 0; byte < 8; ++byte)
      out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
  static bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
                       std::uint32_t& value) {
    if (offset > bytes.size() || bytes.size() - offset < 4) return false;
    value = 0;
    for (int byte = 0; byte < 4; ++byte)
      value |= static_cast<std::uint32_t>(bytes[offset++]) << (byte * 8);
    return true;
  }
  static bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
                       std::uint64_t& value) {
    if (offset > bytes.size() || bytes.size() - offset < 8) return false;
    value = 0;
    for (int byte = 0; byte < 8; ++byte)
      value |= static_cast<std::uint64_t>(bytes[offset++]) << (byte * 8);
    return true;
  }
  static std::uint64_t read_u64_at(std::span<const std::uint8_t> bytes,
                                   std::size_t offset) {
    std::uint64_t value = 0;
    for (int byte = 0; byte < 8; ++byte)
      value |= static_cast<std::uint64_t>(bytes[offset + byte]) << (byte * 8);
    return value;
  }
  static std::uint64_t checksum(std::span<const std::uint8_t> bytes) {
    std::uint64_t hash = 0xCBF29CE484222325ULL;
    for (const std::uint8_t byte : bytes) {
      hash ^= byte;
      hash *= 0x100000001B3ULL;
    }
    return hash;
  }
};

}  // namespace logicpilot

// Portable archive for inspectable DEVS causal evidence.
//
// LPEV is intentionally independent of FlatBuffers so a post-run tool can
// decode a trace without loading the model or the C++ runtime. The archive is
// little-endian, length-delimited, versioned, and protected by an FNV-1a
// checksum over every byte except the checksum footer.
#pragma once

#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/devs/evidence.h"

namespace logicpilot {

class DevsEvidenceCodec {
 public:
  static constexpr std::uint32_t kMagic = 0x5645504CU;  // LPEV
  static constexpr std::uint32_t kVersion = 1;
  static constexpr std::size_t kMaxArchiveBytes = 64U * 1024U * 1024U;
  static constexpr std::uint64_t kMaxRecords = 10'000'000;
  static constexpr std::uint64_t kMaxEvents = 50'000'000;
  static constexpr std::uint32_t kMaxStringBytes = 1U * 1024U * 1024U;

  static bool encode(std::span<const DevsEvidenceRecord> records,
                     std::vector<std::uint8_t>& output,
                     std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    output.clear();
    if (records.size() > kMaxRecords) {
      if (error != nullptr) *error = "evidence record count exceeds archive limit";
      return false;
    }
    append_u32(output, kMagic);
    append_u32(output, kVersion);
    append_u64(output, records.size());
    std::uint64_t event_count = 0;
    for (const DevsEvidenceRecord& record : records) {
      if (record.atom_path.size() > kMaxStringBytes ||
          record.inputs.size() > std::numeric_limits<std::uint32_t>::max() ||
          record.input_sources.size() != record.inputs.size() ||
          record.outputs.size() > std::numeric_limits<std::uint32_t>::max()) {
        if (error != nullptr) *error = "evidence record exceeds archive limits";
        output.clear();
        return false;
      }
      event_count += record.inputs.size() + record.outputs.size();
      if (event_count > kMaxEvents) {
        if (error != nullptr) *error = "evidence event count exceeds archive limit";
        output.clear();
        return false;
      }
      append_u64(output, record.sequence);
      append_u64(output, static_cast<std::uint64_t>(record.at.as_ns()));
      append_u32(output, record.atom);
      output.push_back(static_cast<std::uint8_t>(record.kind));
      append_u64(output, static_cast<std::uint64_t>(record.elapsed.as_ns()));
      append_string(output, record.atom_path);
      append_events(output, record.inputs);
      append_u32(output, static_cast<std::uint32_t>(record.input_sources.size()));
      for (const std::uint32_t source : record.input_sources) append_u32(output, source);
      append_events(output, record.outputs);
      if (output.size() > kMaxArchiveBytes - sizeof(std::uint64_t)) {
        if (error != nullptr) *error = "evidence archive exceeds byte limit";
        output.clear();
        return false;
      }
    }
    append_u64(output, checksum(output));
    return true;
  }

  [[nodiscard]] static std::vector<std::uint8_t> encode(
      std::span<const DevsEvidenceRecord> records) {
    std::vector<std::uint8_t> output;
    if (!encode(records, output, nullptr)) output.clear();
    return output;
  }

  static bool decode(std::span<const std::uint8_t> bytes,
                     std::vector<DevsEvidenceRecord>& records,
                     std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    records.clear();
    if (bytes.size() < 4 + 4 + 8 + 8 || bytes.size() > kMaxArchiveBytes) {
      return fail(error, "invalid evidence archive size");
    }
    const std::uint64_t stored_checksum = read_u64_at(bytes, bytes.size() - 8);
    if (checksum(bytes.first(bytes.size() - 8)) != stored_checksum) {
      return fail(error, "evidence archive checksum mismatch");
    }
    std::size_t offset = 0;
    std::uint32_t magic = 0, version = 0;
    std::uint64_t count = 0;
    if (!read_u32(bytes, offset, magic) || !read_u32(bytes, offset, version) ||
        !read_u64(bytes, offset, count) || magic != kMagic || version != kVersion ||
        count > kMaxRecords) {
      return fail(error, "unsupported evidence archive header");
    }
    records.reserve(static_cast<std::size_t>(count));
    std::uint64_t event_count = 0;
    for (std::uint64_t index = 0; index < count; ++index) {
      DevsEvidenceRecord record;
      std::uint64_t at = 0, elapsed = 0;
      std::uint32_t atom = 0;
      std::uint8_t kind = 0;
      if (!read_u64(bytes, offset, record.sequence) || !read_u64(bytes, offset, at) ||
          !read_u32(bytes, offset, atom) || !read_u8(bytes, offset, kind) ||
          !read_u64(bytes, offset, elapsed) || kind >
              static_cast<std::uint8_t>(DevsTransitionKind::kConfluent) ||
          !read_string(bytes, offset, record.atom_path)) {
        return fail(error, "truncated evidence record");
      }
      if (record.atom_path.size() > kMaxStringBytes) {
        return fail(error, "evidence atom path exceeds limit");
      }
      if (at > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max()) ||
          elapsed > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        return fail(error, "evidence timestamp exceeds SimTime range");
      }
      record.at = SimTime::from_ns(static_cast<std::int64_t>(at));
      record.atom = atom;
      record.kind = static_cast<DevsTransitionKind>(kind);
      record.elapsed = SimTime::from_ns(static_cast<std::int64_t>(elapsed));
      if (!read_events(bytes, offset, record.inputs) ||
          !read_u32(bytes, offset, atom)) {
        return fail(error, "truncated evidence inputs");
      }
      if (atom != record.inputs.size() || atom > std::numeric_limits<std::uint32_t>::max()) {
        return fail(error, "evidence input/source cardinality mismatch");
      }
      record.input_sources.resize(atom);
      for (std::uint32_t& source : record.input_sources) {
        if (!read_u32(bytes, offset, source)) return fail(error, "truncated evidence source");
      }
      if (!read_events(bytes, offset, record.outputs)) {
        return fail(error, "truncated evidence outputs");
      }
      event_count += record.inputs.size() + record.outputs.size();
      if (event_count > kMaxEvents) return fail(error, "evidence event count exceeds limit");
      records.push_back(std::move(record));
    }
    if (offset != bytes.size() - sizeof(std::uint64_t)) {
      records.clear();
      return fail(error, "trailing bytes in evidence archive");
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
  static void append_string(std::vector<std::uint8_t>& out, const std::string& value) {
    append_u32(out, static_cast<std::uint32_t>(value.size()));
    out.insert(out.end(), value.begin(), value.end());
  }
  static void append_events(std::vector<std::uint8_t>& out,
                            std::span<const PortEvent> events) {
    append_u32(out, static_cast<std::uint32_t>(events.size()));
    for (const PortEvent& event : events) {
      append_u32(out, event.port);
      append_u64(out, event.payload);
    }
  }
  static bool read_u8(std::span<const std::uint8_t> bytes, std::size_t& offset,
                      std::uint8_t& value) {
    if (offset >= bytes.size()) return false;
    value = bytes[offset++];
    return true;
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
  static bool read_string(std::span<const std::uint8_t> bytes, std::size_t& offset,
                          std::string& value) {
    std::uint32_t size = 0;
    if (!read_u32(bytes, offset, size) || size > kMaxStringBytes ||
        offset > bytes.size() || bytes.size() - offset < size) return false;
    value.assign(reinterpret_cast<const char*>(bytes.data() + offset), size);
    offset += size;
    return true;
  }
  static bool read_events(std::span<const std::uint8_t> bytes, std::size_t& offset,
                          std::vector<PortEvent>& events) {
    std::uint32_t count = 0;
    if (!read_u32(bytes, offset, count) || count > kMaxEvents) return false;
    events.resize(count);
    for (PortEvent& event : events) {
      if (!read_u32(bytes, offset, event.port) || !read_u64(bytes, offset, event.payload)) {
        events.clear();
        return false;
      }
    }
    return true;
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

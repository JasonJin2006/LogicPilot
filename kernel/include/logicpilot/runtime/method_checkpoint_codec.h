// Portable archive for mixed-method SimulationSessionCheckpoint bundles.
#pragma once

#include <cstdint>
#include <bit>
#include <limits>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "logicpilot/runtime/method_checkpoint.h"

namespace logicpilot {
namespace method_checkpoint_detail {
constexpr std::uint32_t kMagic = 0x4C504D43U;  // LPMC
constexpr std::uint8_t kVersion = 2;
constexpr std::uint32_t kMaxCount = 1024;
constexpr std::uint32_t kMaxBlob = 512U * 1024U * 1024U;

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
inline void append_string(std::vector<std::uint8_t>& out,
                          const std::string& value) {
  if (value.size() > kMaxBlob ||
      value.size() > std::numeric_limits<std::uint32_t>::max())
    throw std::length_error("method checkpoint string too large");
  append_u32(out, static_cast<std::uint32_t>(value.size()));
  out.insert(out.end(), value.begin(), value.end());
}
inline bool read_string(std::span<const std::uint8_t> bytes, std::size_t& offset,
                        std::string& value) {
  std::uint32_t size = 0;
  if (!read_u32(bytes, offset, size) || size > kMaxBlob ||
      size > bytes.size() - offset) return false;
  value.assign(reinterpret_cast<const char*>(bytes.data() + offset), size);
  offset += size;
  return true;
}
inline void append_blob(std::vector<std::uint8_t>& out,
                        std::span<const std::uint8_t> blob) {
  if (blob.size() > kMaxBlob ||
      blob.size() > std::numeric_limits<std::uint32_t>::max())
    throw std::length_error("method checkpoint blob too large");
  append_u32(out, static_cast<std::uint32_t>(blob.size()));
  out.insert(out.end(), blob.begin(), blob.end());
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

inline void append_string_list(std::vector<std::uint8_t>& out,
                               const std::vector<std::string>& values) {
  if (values.size() > kMaxCount)
    throw std::length_error("method checkpoint string list too large");
  append_u32(out, static_cast<std::uint32_t>(values.size()));
  for (const std::string& value : values) append_string(out, value);
}
inline bool read_string_list(std::span<const std::uint8_t> bytes,
                             std::size_t& offset,
                             std::vector<std::string>& values) {
  std::uint32_t count = 0;
  if (!read_u32(bytes, offset, count) || count > kMaxCount) return false;
  values.reserve(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    std::string value;
    if (!read_string(bytes, offset, value)) return false;
    values.push_back(std::move(value));
  }
  return true;
}
inline void append_variable(std::vector<std::uint8_t>& out,
                            const std::optional<VariableValue>& value) {
  if (!value.has_value()) {
    out.push_back(0);
  } else if (std::holds_alternative<bool>(*value)) {
    out.push_back(1);
    out.push_back(std::get<bool>(*value) ? 1 : 0);
  } else if (std::holds_alternative<std::int64_t>(*value)) {
    out.push_back(2);
    append_u64(out, static_cast<std::uint64_t>(std::get<std::int64_t>(*value)));
  } else if (std::holds_alternative<double>(*value)) {
    out.push_back(3);
    append_u64(out, std::bit_cast<std::uint64_t>(std::get<double>(*value)));
  } else {
    out.push_back(4);
    append_string(out, std::get<std::string>(*value));
  }
}
inline bool read_variable(std::span<const std::uint8_t> bytes,
                          std::size_t& offset,
                          std::optional<VariableValue>& value) {
  if (offset >= bytes.size()) return false;
  const std::uint8_t tag = bytes[offset++];
  std::uint64_t raw = 0;
  if (tag == 0) {
    value.reset();
    return true;
  }
  if (tag == 1) {
    if (offset >= bytes.size() || bytes[offset] > 1) return false;
    value = bytes[offset++] != 0;
    return true;
  }
  if (tag == 2) {
    if (!read_u64(bytes, offset, raw)) return false;
    value = static_cast<std::int64_t>(raw);
    return true;
  }
  if (tag == 3) {
    if (!read_u64(bytes, offset, raw)) return false;
    value = std::bit_cast<double>(raw);
    return true;
  }
  if (tag == 4) {
    std::string string_value;
    if (!read_string(bytes, offset, string_value)) return false;
    value = std::move(string_value);
    return true;
  }
  return false;
}
}  // namespace method_checkpoint_detail

class SimulationSessionCheckpointCodec {
 public:
  [[nodiscard]] static std::vector<std::uint8_t> encode(
      const SimulationSessionCheckpoint& checkpoint) {
    using namespace method_checkpoint_detail;
    if (checkpoint.methods.size() > kMaxCount)
      throw std::length_error("too many method checkpoint bundles");
    std::vector<std::uint8_t> out;
    append_u32(out, kMagic);
    out.push_back(kVersion);
    append_u64(out, checkpoint.model_fingerprint);
    append_u64(out, static_cast<std::uint64_t>(checkpoint.now.as_ns()));
    append_u64(out, checkpoint.dispatched_events);
    if (checkpoint.variables.size() > kMaxCount ||
        checkpoint.messages.size() > kMaxCount)
      throw std::length_error("too many shared checkpoint entries");
    append_u32(out, static_cast<std::uint32_t>(checkpoint.variables.size()));
    for (const VariableSnapshot& variable : checkpoint.variables) {
      append_string(out, variable.name);
      append_string(out, variable.declaration.owner);
      append_string(out, variable.declaration.unit);
      append_string_list(out, variable.declaration.readers);
      append_string_list(out, variable.declaration.writers);
      append_variable(out, variable.value);
    }
    append_u32(out, static_cast<std::uint32_t>(checkpoint.messages.size()));
    for (const MessageEnvelope& message : checkpoint.messages) {
      append_string(out, message.type_uri);
      append_u32(out, message.schema_version);
      append_string(out, message.encoding);
      append_string(out, message.source_method);
      append_blob(out, message.data);
    }
    append_u32(out, static_cast<std::uint32_t>(checkpoint.methods.size()));
    for (const MethodCheckpoint& method : checkpoint.methods) {
      append_string(out, method.method);
      append_u32(out, method.schema_version);
      append_u64(out, static_cast<std::uint64_t>(method.now.as_ns()));
      append_blob(out, method.state);
    }
    append_u64(out, checksum(out));
    return out;
  }

  static bool decode(std::span<const std::uint8_t> bytes,
                     SimulationSessionCheckpoint& checkpoint,
                     std::string* error = nullptr) {
    using namespace method_checkpoint_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (bytes.size() < 4 + 1 + 8 + 8 + 4 + 8)
      return fail("method checkpoint archive too small");
    std::size_t checksum_offset = bytes.size() - 8;
    std::uint64_t expected = 0;
    if (!read_u64(bytes, checksum_offset, expected) ||
        checksum(bytes.first(bytes.size() - 8)) != expected)
      return fail("method checkpoint archive checksum mismatch");
    std::size_t offset = 0;
    std::uint32_t magic = 0, count = 0;
    std::uint8_t version = 0;
    if (!read_u32(bytes, offset, magic) || magic != kMagic ||
        offset >= bytes.size() ||
        ((version = bytes[offset++]) != 1 && version != kVersion))
      return fail("unsupported method checkpoint archive");
    std::uint64_t raw = 0;
    SimulationSessionCheckpoint decoded;
    if (!read_u64(bytes, offset, decoded.model_fingerprint) ||
        !read_u64(bytes, offset, raw)) return fail("invalid session header");
    decoded.now = SimTime::from_ns(static_cast<std::int64_t>(raw));
    if (version >= 2 && !read_u64(bytes, offset, decoded.dispatched_events)) {
      return fail("invalid session dispatch counter");
    }
    if (!read_u32(bytes, offset, count) || count > kMaxCount)
      return fail("invalid shared variable count");
    decoded.variables.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      VariableSnapshot variable;
      if (!read_string(bytes, offset, variable.name) ||
          !read_string(bytes, offset, variable.declaration.owner) ||
          !read_string(bytes, offset, variable.declaration.unit) ||
          !read_string_list(bytes, offset, variable.declaration.readers) ||
          !read_string_list(bytes, offset, variable.declaration.writers) ||
          !read_variable(bytes, offset, variable.value))
        return fail("truncated shared variable checkpoint");
      decoded.variables.push_back(std::move(variable));
    }
    if (!read_u32(bytes, offset, count) || count > kMaxCount)
      return fail("invalid shared message count");
    decoded.messages.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      MessageEnvelope message;
      if (!read_string(bytes, offset, message.type_uri) ||
          !read_u32(bytes, offset, message.schema_version) ||
          !read_string(bytes, offset, message.encoding) ||
          !read_string(bytes, offset, message.source_method) ||
          !read_blob(bytes, offset, message.data))
        return fail("truncated shared message checkpoint");
      decoded.messages.push_back(std::move(message));
    }
    if (!read_u32(bytes, offset, count) || count > kMaxCount)
      return fail("invalid method checkpoint count");
    decoded.methods.reserve(count);
    for (std::uint32_t index = 0; index < count; ++index) {
      MethodCheckpoint method;
      if (!read_string(bytes, offset, method.method) ||
          !read_u32(bytes, offset, method.schema_version) ||
          !read_u64(bytes, offset, raw) ||
          !read_blob(bytes, offset, method.state))
        return fail("truncated method checkpoint");
      method.now = SimTime::from_ns(static_cast<std::int64_t>(raw));
      decoded.methods.push_back(std::move(method));
    }
    if (offset != bytes.size() - 8)
      return fail("trailing method checkpoint bytes");
    checkpoint = std::move(decoded);
    return true;
  }
};

}  // namespace logicpilot

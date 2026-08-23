#include "logicpilot/devs/checkpoint_journal.h"

#include <cstdint>
#include <exception>
#include <fstream>
#include <iterator>
#include <limits>
#include <span>
#include <vector>

#include "logicpilot/devs/checkpoint_codec.h"

namespace logicpilot {
namespace {

constexpr std::uint32_t kMagic = 0x4C504A52U;  // LPJR
constexpr std::uint8_t kVersion = 1;
constexpr std::uint64_t kMaxRecord = 512ULL * 1024ULL * 1024ULL;

void append_u32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}

void append_u64(std::vector<std::uint8_t>& bytes, std::uint64_t value) {
  for (int shift = 0; shift < 64; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}

bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << shift;
  }
  return true;
}

bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int shift = 0; shift < 64; shift += 8) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << shift;
  }
  return true;
}

}  // namespace

bool DevsCheckpointJournal::append(const DevsCheckpoint& checkpoint,
                                   std::string* error) {
  if (error != nullptr) error->clear();
  try {
    const std::vector<std::uint8_t> archive =
        DevsCheckpointCodec::encode(checkpoint);
    if (archive.size() > kMaxRecord) {
      if (error != nullptr) *error = "checkpoint journal record too large";
      return false;
    }
    std::ofstream output(path_, std::ios::binary | std::ios::app);
    if (!output) {
      if (error != nullptr) *error = "cannot open checkpoint journal for append";
      return false;
    }
    std::vector<std::uint8_t> header;
    header.reserve(4 + 1 + 8);
    append_u32(header, kMagic);
    header.push_back(kVersion);
    append_u64(header, static_cast<std::uint64_t>(archive.size()));
    output.write(reinterpret_cast<const char*>(header.data()),
                 static_cast<std::streamsize>(header.size()));
    output.write(reinterpret_cast<const char*>(archive.data()),
                 static_cast<std::streamsize>(archive.size()));
    output.flush();
    if (!output) {
      if (error != nullptr) *error = "checkpoint journal append failed";
      return false;
    }
    return true;
  } catch (const std::exception& exception) {
    if (error != nullptr) *error = exception.what();
    return false;
  }
}

bool DevsCheckpointJournal::load_latest(DevsCheckpoint& checkpoint,
                                        std::string* error,
                                        bool* truncated_tail) const {
  if (error != nullptr) error->clear();
  if (truncated_tail != nullptr) *truncated_tail = false;
  std::ifstream input(path_, std::ios::binary);
  if (!input) {
    if (error != nullptr) *error = "cannot open checkpoint journal";
    return false;
  }
  const std::vector<std::uint8_t> bytes(
      (std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  std::size_t offset = 0;
  bool found = false;
  DevsCheckpoint latest;
  while (offset < bytes.size()) {
    const std::size_t record_start = offset;
    std::uint32_t magic = 0;
    std::uint64_t size = 0;
    if (!read_u32(bytes, offset, magic) || offset >= bytes.size() ||
        bytes[offset++] != kVersion || !read_u64(bytes, offset, size) ||
        magic != kMagic || size > kMaxRecord ||
        size > bytes.size() - offset) {
      if (truncated_tail != nullptr) *truncated_tail = true;
      break;
    }
    std::string decode_error;
    DevsCheckpoint candidate;
    if (DevsCheckpointCodec::decode(
            std::span<const std::uint8_t>(bytes).subspan(
                offset, static_cast<std::size_t>(size)),
            candidate, &decode_error)) {
      latest = std::move(candidate);
      found = true;
      offset += static_cast<std::size_t>(size);
    } else {
      // A complete but invalid record is treated as a corrupt tail; records
      // before it remain recoverable.
      if (truncated_tail != nullptr) *truncated_tail = true;
      offset = record_start;
      break;
    }
  }
  if (!found) {
    if (error != nullptr) *error = "checkpoint journal has no valid record";
    return false;
  }
  checkpoint = std::move(latest);
  return true;
}

bool DevsCheckpointJournal::compact_latest(std::string* error) {
  if (error != nullptr) error->clear();
  DevsCheckpoint latest;
  if (!load_latest(latest, error)) return false;
  const std::filesystem::path temporary = path_.string() + ".compact.tmp";
  const std::filesystem::path backup = path_.string() + ".compact.bak";
  std::error_code filesystem_error;
  std::filesystem::remove(temporary, filesystem_error);
  std::filesystem::remove(backup, filesystem_error);

  DevsCheckpointJournal temporary_journal{temporary};
  if (!temporary_journal.append(latest, error)) {
    std::filesystem::remove(temporary, filesystem_error);
    return false;
  }

  // Keep a recoverable backup while replacing the destination. This is not a
  // substitute for filesystem-level atomic transactions, but it prevents a
  // failed rename from destroying the previous journal.
  std::filesystem::rename(path_, backup, filesystem_error);
  if (filesystem_error) {
    if (error != nullptr) *error = "cannot stage checkpoint journal backup";
    std::filesystem::remove(temporary, filesystem_error);
    return false;
  }
  std::filesystem::rename(temporary, path_, filesystem_error);
  if (filesystem_error) {
    std::error_code restore_error;
    std::filesystem::rename(backup, path_, restore_error);
    if (error != nullptr) *error = "cannot install compacted checkpoint journal";
    std::filesystem::remove(temporary, restore_error);
    return false;
  }
  std::filesystem::remove(backup, filesystem_error);
  return true;
}

}  // namespace logicpilot

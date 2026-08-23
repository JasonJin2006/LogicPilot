#include "logicpilot/devs/trace_store.h"

#include <fstream>
#include <system_error>

#include "logicpilot/devs/trace_codec.h"

namespace logicpilot {

bool FileLogicalTraceArchiveStore::save(
    std::span<const LogicalStepRecord> records, std::string* error) const {
  if (error != nullptr) error->clear();
  std::vector<std::uint8_t> archive;
  if (!LogicalTraceCodec::encode(records, archive, error)) return false;
  const std::filesystem::path temporary = path_.string() + ".tmp";
  const std::filesystem::path backup = path_.string() + ".bak";
  std::error_code filesystem_error;
  std::filesystem::remove(temporary, filesystem_error);
  std::filesystem::remove(backup, filesystem_error);
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  if (!output) {
    if (error != nullptr) *error = "cannot open logical trace temp file";
    return false;
  }
  output.write(reinterpret_cast<const char*>(archive.data()),
               static_cast<std::streamsize>(archive.size()));
  output.flush();
  if (!output) {
    if (error != nullptr) *error = "logical trace write failed";
    std::filesystem::remove(temporary, filesystem_error);
    return false;
  }
  output.close();
  if (std::filesystem::exists(path_)) {
    std::filesystem::rename(path_, backup, filesystem_error);
    if (filesystem_error) {
      if (error != nullptr) *error = "cannot stage logical trace backup";
      std::filesystem::remove(temporary, filesystem_error);
      return false;
    }
  }
  std::filesystem::rename(temporary, path_, filesystem_error);
  if (filesystem_error) {
    std::error_code restore_error;
    if (std::filesystem::exists(backup))
      std::filesystem::rename(backup, path_, restore_error);
    if (error != nullptr) *error = "cannot install logical trace archive";
    std::filesystem::remove(temporary, restore_error);
    return false;
  }
  std::filesystem::remove(backup, filesystem_error);
  return true;
}

bool FileLogicalTraceArchiveStore::load(
    std::vector<LogicalStepRecord>& records, std::string* error) const {
  if (error != nullptr) error->clear();
  records.clear();
  std::ifstream input(path_, std::ios::binary);
  if (!input) {
    if (error != nullptr) *error = "cannot open logical trace archive";
    return false;
  }
  input.seekg(0, std::ios::end);
  const std::streamoff size = input.tellg();
  if (size < 0 || static_cast<std::uint64_t>(size) >
                      LogicalTraceCodec::kMaxArchiveBytes) {
    if (error != nullptr) *error = "logical trace archive exceeds size limit";
    return false;
  }
  input.seekg(0, std::ios::beg);
  std::vector<std::uint8_t> archive(static_cast<std::size_t>(size));
  if (!archive.empty())
    input.read(reinterpret_cast<char*>(archive.data()), archive.size());
  if (!input && !input.eof()) {
    if (error != nullptr) *error = "logical trace read failed";
    return false;
  }
  return LogicalTraceCodec::decode(archive, records, error);
}

}  // namespace logicpilot

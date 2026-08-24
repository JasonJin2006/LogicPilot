#include "logicpilot/devs/checkpoint_store.h"

#include <exception>
#include <fstream>
#include <iterator>
#include <system_error>

namespace logicpilot {

bool FileCheckpointBlobStore::write(std::span<const std::uint8_t> bytes,
                                    std::string* error) {
  if (error != nullptr) error->clear();
  const std::filesystem::path temporary = path_.string() + ".tmp";
  const std::filesystem::path backup = path_.string() + ".bak";
  std::error_code filesystem_error;
  std::filesystem::remove(temporary, filesystem_error);
  // A crash between the two renames below leaves the good blob in .bak and
  // the primary missing; recover it before touching anything, otherwise
  // removing .bak destroys the only known-good copy.
  if (!std::filesystem::exists(path_) && std::filesystem::exists(backup)) {
    std::filesystem::rename(backup, path_, filesystem_error);
    filesystem_error.clear();
  }
  std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
  if (!output) {
    if (error != nullptr) *error = "cannot open checkpoint blob temp file";
    return false;
  }
  output.write(reinterpret_cast<const char*>(bytes.data()),
               static_cast<std::streamsize>(bytes.size()));
  output.flush();
  if (!output) {
    if (error != nullptr) *error = "checkpoint blob write failed";
    std::filesystem::remove(temporary, filesystem_error);
    return false;
  }
  output.close();
  if (std::filesystem::exists(path_)) {
    // Windows rename fails when the destination exists; a staged backup may
    // linger after an interrupted install.
    std::filesystem::remove(backup, filesystem_error);
    std::filesystem::rename(path_, backup, filesystem_error);
    if (filesystem_error) {
      if (error != nullptr) *error = "cannot stage checkpoint blob backup";
      std::filesystem::remove(temporary, filesystem_error);
      return false;
    }
  }
  std::filesystem::rename(temporary, path_, filesystem_error);
  if (filesystem_error) {
    std::error_code restore_error;
    if (std::filesystem::exists(backup)) {
      std::filesystem::rename(backup, path_, restore_error);
    }
    if (error != nullptr) *error = "cannot install checkpoint blob";
    std::filesystem::remove(temporary, restore_error);
    return false;
  }
  std::filesystem::remove(backup, filesystem_error);
  return true;
}

bool FileCheckpointBlobStore::read(std::vector<std::uint8_t>& bytes,
                                   std::string* error) const {
  if (error != nullptr) error->clear();
  std::ifstream input(path_, std::ios::binary);
  if (!input) {
    // Interrupted install fallback: the last known-good blob is staged in
    // .bak after a crash between the renames.
    input.open(path_.string() + ".bak", std::ios::binary);
    if (!input) {
      if (error != nullptr) *error = "cannot open checkpoint blob";
      return false;
    }
  }
  bytes.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
  if (!input.eof() && input.fail()) {
    if (error != nullptr) *error = "checkpoint blob read failed";
    bytes.clear();
    return false;
  }
  return true;
}

}  // namespace logicpilot

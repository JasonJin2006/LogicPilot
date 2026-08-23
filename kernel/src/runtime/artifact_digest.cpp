#include "logicpilot/runtime/artifact_digest.h"

#include <array>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <vector>

namespace logicpilot {
namespace {

constexpr std::array<std::uint32_t, 64> kRoundConstants{
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU,
    0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U,
    0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U,
    0xc19bf174U, 0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
    0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU, 0x983e5152U,
    0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U,
    0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU,
    0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U,
    0xd6990624U, 0xf40e3585U, 0x106aa070U, 0x19a4c116U, 0x1e376c08U,
    0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU,
    0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U};

constexpr std::array<std::uint32_t, 8> kInitialState{
    0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
    0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U};

constexpr std::uint32_t rotr(std::uint32_t value, unsigned amount) {
  return (value >> amount) | (value << (32U - amount));
}
constexpr std::uint32_t ch(std::uint32_t x, std::uint32_t y, std::uint32_t z) {
  return (x & y) ^ (~x & z);
}
constexpr std::uint32_t maj(std::uint32_t x, std::uint32_t y, std::uint32_t z) {
  return (x & y) ^ (x & z) ^ (y & z);
}
constexpr std::uint32_t big_sigma0(std::uint32_t x) {
  return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}
constexpr std::uint32_t big_sigma1(std::uint32_t x) {
  return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}
constexpr std::uint32_t small_sigma0(std::uint32_t x) {
  return rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3);
}
constexpr std::uint32_t small_sigma1(std::uint32_t x) {
  return rotr(x, 17) ^ rotr(x, 19) ^ (x >> 10);
}

void compress(std::array<std::uint32_t, 8>& state,
              const std::uint8_t* block) {
  std::array<std::uint32_t, 64> words{};
  for (std::size_t i = 0; i < 16; ++i) {
    words[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
               (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
               static_cast<std::uint32_t>(block[i * 4 + 3]);
  }
  for (std::size_t i = 16; i < words.size(); ++i) {
    words[i] = small_sigma1(words[i - 2]) + words[i - 7] +
               small_sigma0(words[i - 15]) + words[i - 16];
  }
  auto working = state;
  for (std::size_t i = 0; i < kRoundConstants.size(); ++i) {
    const std::uint32_t t1 = working[7] + big_sigma1(working[4]) +
                              ch(working[4], working[5], working[6]) +
                              kRoundConstants[i] + words[i];
    const std::uint32_t t2 = big_sigma0(working[0]) +
                             maj(working[0], working[1], working[2]);
    working[7] = working[6];
    working[6] = working[5];
    working[5] = working[4];
    working[4] = working[3] + t1;
    working[3] = working[2];
    working[2] = working[1];
    working[1] = working[0];
    working[0] = t1 + t2;
  }
  for (std::size_t i = 0; i < state.size(); ++i) state[i] += working[i];
}

std::string finish(std::span<const std::uint8_t> bytes) {
  std::array<std::uint32_t, 8> state = kInitialState;
  const std::size_t full_blocks = bytes.size() / 64;
  for (std::size_t i = 0; i < full_blocks; ++i) compress(state, bytes.data() + i * 64);

  std::array<std::uint8_t, 128> tail{};
  const std::size_t remainder = bytes.size() % 64;
  for (std::size_t i = 0; i < remainder; ++i) tail[i] = bytes[full_blocks * 64 + i];
  tail[remainder] = 0x80;
  const std::uint64_t bit_length = static_cast<std::uint64_t>(bytes.size()) * 8U;
  const std::size_t block_count = remainder >= 56 ? 2 : 1;
  const std::size_t length_offset = block_count * 64 - 8;
  for (int byte = 0; byte < 8; ++byte)
    tail[length_offset + static_cast<std::size_t>(byte)] =
        static_cast<std::uint8_t>(bit_length >> (56 - byte * 8));
  for (std::size_t i = 0; i < block_count; ++i) compress(state, tail.data() + i * 64);

  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (const std::uint32_t word : state) output << std::setw(8) << word;
  return output.str();
}

}  // namespace

std::string ArtifactDigest::sha256(std::span<const std::uint8_t> bytes) {
  return finish(bytes);
}

bool ArtifactDigest::sha256_file(const std::filesystem::path& path,
                                 std::string& digest, std::string* error) {
  if (error != nullptr) error->clear();
  std::ifstream input(path, std::ios::binary);
  if (!input) {
    if (error != nullptr) *error = "cannot open artifact for hashing";
    return false;
  }
  input.seekg(0, std::ios::end);
  const std::streamoff end = input.tellg();
  if (end < 0 || static_cast<std::uint64_t>(end) > 256U * 1024U * 1024U) {
    if (error != nullptr) *error = "artifact exceeds hashing size limit";
    return false;
  }
  input.seekg(0, std::ios::beg);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(end));
  if (!bytes.empty()) input.read(reinterpret_cast<char*>(bytes.data()), bytes.size());
  if (!input && !input.eof()) {
    if (error != nullptr) *error = "cannot read artifact for hashing";
    return false;
  }
  digest = sha256(bytes);
  return true;
}

bool ArtifactDigest::is_sha256_hex(std::string_view value) {
  if (value.size() != 64) return false;
  for (const char character : value) {
    const bool digit = character >= '0' && character <= '9';
    const bool lower = character >= 'a' && character <= 'f';
    const bool upper = character >= 'A' && character <= 'F';
    if (!digit && !lower && !upper) return false;
  }
  return true;
}

}  // namespace logicpilot

// Golden-file snapshot helpers for the DSL compiler tests.
//
// Goldens live in dsl/compiler/tests/golden/. Regenerate deliberately with:
//   LOGICPILOT_UPDATE_GOLDEN=1 ctest -R dsl
// (on mismatch the failing test prints the actual text for review).
#pragma once

#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

#include <catch2/catch_test_macros.hpp>

namespace logicpilot::dsl::testing {

inline std::string read_golden(const std::string& path) {
  // Text mode: Windows checkouts carry CRLF while goldens are committed as
  // LF; the CRT translates CRLF -> LF so the byte-exact snapshot comparison
  // holds on every runner (kernel's expect_json.h reads the same way).
  std::ifstream in(path);
  if (!in) {
    return {};
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

inline void write_golden(const std::string& path, const std::string& text) {
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  out << text;
}

inline bool update_goldens_enabled() {
  return std::getenv("LOGICPILOT_UPDATE_GOLDEN") != nullptr;
}

}  // namespace logicpilot::dsl::testing

#define REQUIRE_MATCHES_GOLDEN(golden_path, actual)                        \
  do {                                                                     \
    const std::string lp_golden_path_ = (golden_path);                     \
    const std::string lp_actual_ = (actual);                               \
    if (::logicpilot::dsl::testing::update_goldens_enabled()) {            \
      ::logicpilot::dsl::testing::write_golden(lp_golden_path_,            \
                                               lp_actual_);                \
    }                                                                      \
    const std::string lp_expected_ =                                       \
        ::logicpilot::dsl::testing::read_golden(lp_golden_path_);          \
    INFO("golden mismatch: " << lp_golden_path_ << "\n--- actual ---\n"    \
                             << lp_actual_);                               \
    REQUIRE(!lp_expected_.empty());                                        \
    REQUIRE(lp_expected_ == lp_actual_);                                   \
  } while (0)

// Unit tests for the Result type (logicpilot/common/result.h).
#include <catch2/catch_all.hpp>
#include <memory>
#include <string>

#include "logicpilot/common/result.h"

namespace logicpilot {

TEST_CASE("Result - basic success case", "[result]") {
  Result<int> r = Ok(42);
  
  REQUIRE(r.ok());
  REQUIRE(static_cast<bool>(r));
  REQUIRE(r.value() == 42);
}

TEST_CASE("Result - basic error case", "[result]") {
  Result<int> r = Error(ErrorCode::kFileNotFound, "test.txt not found");
  
  REQUIRE(!r.ok());
  REQUIRE(!static_cast<bool>(r));
  REQUIRE(r.error().code == ErrorCode::kFileNotFound);
  REQUIRE(r.error().message == "test.txt not found");
}

TEST_CASE("Result - void success", "[result]") {
  Result<void> r = Ok();
  
  REQUIRE(r.ok());
  REQUIRE(static_cast<bool>(r));
}

TEST_CASE("Result - void error", "[result]") {
  Result<void> r = Error(ErrorCode::kMethodNotFound, "process not registered");
  
  REQUIRE(!r.ok());
  REQUIRE(r.error().code == ErrorCode::kMethodNotFound);
}

TEST_CASE("Result - value_or", "[result]") {
  Result<int> success = Ok(100);
  Result<int> failure = Error(ErrorCode::kTimeout, "operation timed out");
  
  REQUIRE(success.value_or(0) == 100);
  REQUIRE(failure.value_or(0) == 0);
}

TEST_CASE("Result - map transformation", "[result]") {
  Result<int> success = Ok(5);
  Result<int> failure = Error(ErrorCode::kInvalidState, "bad state");
  
  auto mapped_success = success.map([](int x) { return x * 2; });
  auto mapped_failure = failure.map([](int x) { return x * 2; });
  
  REQUIRE(mapped_success.ok());
  REQUIRE(mapped_success.value() == 10);
  
  REQUIRE(!mapped_failure.ok());
  REQUIRE(mapped_failure.error().code == ErrorCode::kInvalidState);
}

TEST_CASE("Result - and_then chaining", "[result]") {
  auto make_string = [](int x) -> Result<std::string> {
    if (x > 0) {
      return Ok(std::to_string(x));
    }
    return Error(ErrorCode::kInvalidConfiguration, "negative value");
  };
  
  Result<int> positive = Ok(42);
  Result<int> negative = Ok(-1);
  Result<int> error = Error(ErrorCode::kFileNotFound, "missing");
  
  auto chained_positive = positive.and_then(make_string);
  REQUIRE(chained_positive.ok());
  REQUIRE(chained_positive.value() == "42");
  
  auto chained_negative = negative.and_then(make_string);
  REQUIRE(!chained_negative.ok());
  REQUIRE(chained_negative.error().code == ErrorCode::kInvalidConfiguration);
  
  auto chained_error = error.and_then(make_string);
  REQUIRE(!chained_error.ok());
  REQUIRE(chained_error.error().code == ErrorCode::kFileNotFound);
}

TEST_CASE("Result - or_else fallback", "[result]") {
  auto fallback = [](const ErrorInfo& err) -> Result<int> {
    if (err.code == ErrorCode::kTimeout) {
      return Ok(0);  // Retry with default
    }
    return Error(err.code, "fallback: " + err.message);
  };
  
  Result<int> success = Ok(42);
  Result<int> timeout = Error(ErrorCode::kTimeout, "timed out");
  Result<int> other_error = Error(ErrorCode::kFileNotFound, "missing");
  
  REQUIRE(success.or_else(fallback).value() == 42);
  REQUIRE(timeout.or_else(fallback).value() == 0);
  
  auto result = other_error.or_else(fallback);
  REQUIRE(!result.ok());
  REQUIRE(result.error().message.find("fallback:") != std::string::npos);
}

TEST_CASE("Result - move semantics", "[result]") {
  struct MoveOnly {
    int value;
    explicit MoveOnly(int v) : value(v) {}
    MoveOnly(const MoveOnly&) = delete;
    MoveOnly& operator=(const MoveOnly&) = delete;
    MoveOnly(MoveOnly&&) = default;
    MoveOnly& operator=(MoveOnly&&) = default;
  };
  
  Result<MoveOnly> r = Ok(MoveOnly(42));
  REQUIRE(r.ok());
  
  auto moved = std::move(r).value();
  REQUIRE(moved.value == 42);
}

TEST_CASE("Result - unique_ptr management", "[result]") {
  Result<std::unique_ptr<int>> r = Ok(std::make_unique<int>(123));
  
  REQUIRE(r.ok());
  REQUIRE(*r.value() == 123);
  
  auto ptr = std::move(r).value();
  REQUIRE(*ptr == 123);
}

TEST_CASE("ErrorInfo - full_message with context", "[result]") {
  ErrorInfo err(ErrorCode::kPermissionDenied, "access denied", "load_model");
  
  REQUIRE(err.full_message() == "load_model: access denied");
  
  ErrorInfo err_no_context(ErrorCode::kOk, "simple message");
  REQUIRE(err_no_context.full_message() == "simple message");
}

TEST_CASE("error_code_to_string", "[result]") {
  REQUIRE(std::string(error_code_to_string(ErrorCode::kOk)) == "OK");
  REQUIRE(std::string(error_code_to_string(ErrorCode::kFileNotFound)) == "File not found");
  REQUIRE(std::string(error_code_to_string(ErrorCode::kMethodNotFound)) == "Method not found");
  REQUIRE(std::string(error_code_to_string(static_cast<ErrorCode>(9999))) == "Unknown error");
}

}  // namespace logicpilot

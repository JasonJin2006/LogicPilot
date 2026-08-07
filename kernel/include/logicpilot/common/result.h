// Result type for unified error handling across LogicPilot.
//
// This provides a consistent way to handle errors throughout the codebase,
// replacing ad-hoc patterns (bool + error string, nullptr + error string)
// with a type-safe Result<T, E> abstraction similar to Rust's Result or
// tl::expected.
//
// Usage:
//   Result<std::unique_ptr<Model>, ErrorCode> load_model(...) {
//     if (!file_exists) {
//       return Error(ErrorCode::FileNotFound, "model.bin not found");
//     }
//     return std::make_unique<Model>();
//   }
//
//   auto result = load_model("model.bin");
//   if (!result.ok()) {
//     log_error(result.error().message());
//     return;
//   }
//   auto model = std::move(result).value();
#pragma once

#include <string>
#include <variant>
#include <utility>

namespace logicpilot {

/// Standard error codes used throughout LogicPilot.
enum class ErrorCode {
  kOk = 0,
  
  // Filesystem errors (F1xxx)
  kFileNotFound = 1001,
  kPermissionDenied = 1002,
  kInvalidPath = 1003,
  
  // Schema/IR errors (S2xxx)
  kSchemaVersionMismatch = 2001,
  kInvalidSchema = 2002,
  kMissingRequiredField = 2003,
  kInvalidStructure = 2004,
  
  // Runtime errors (R3xxx)
  kMethodNotFound = 3001,
  kInvalidConfiguration = 3002,
  kResourceExhausted = 3003,
  kTimeout = 3004,
  
  // Kernel errors (K4xxx)
  kKernelNotInitialized = 4001,
  kSimulationFailed = 4002,
  kInvalidState = 4003,
  
  // User-defined errors (U9xxx)
  kUserDefined = 9000,
};

/// Human-readable description of an error code.
[[nodiscard]] inline const char* error_code_to_string(ErrorCode code) {
  switch (code) {
    case ErrorCode::kOk:
      return "OK";
    case ErrorCode::kFileNotFound:
      return "File not found";
    case ErrorCode::kPermissionDenied:
      return "Permission denied";
    case ErrorCode::kInvalidPath:
      return "Invalid path";
    case ErrorCode::kSchemaVersionMismatch:
      return "Schema version mismatch";
    case ErrorCode::kInvalidSchema:
      return "Invalid schema";
    case ErrorCode::kMissingRequiredField:
      return "Missing required field";
    case ErrorCode::kInvalidStructure:
      return "Invalid structure";
    case ErrorCode::kMethodNotFound:
      return "Method not found";
    case ErrorCode::kInvalidConfiguration:
      return "Invalid configuration";
    case ErrorCode::kResourceExhausted:
      return "Resource exhausted";
    case ErrorCode::kTimeout:
      return "Timeout";
    case ErrorCode::kKernelNotInitialized:
      return "Kernel not initialized";
    case ErrorCode::kSimulationFailed:
      return "Simulation failed";
    case ErrorCode::kInvalidState:
      return "Invalid state";
    case ErrorCode::kUserDefined:
      return "User-defined error";
    default:
      return "Unknown error";
  }
}

/// Represents a structured error with code and message.
struct ErrorInfo {
  ErrorCode code{ErrorCode::kOk};
  std::string message;
  std::string context;  // Optional: function name, file location, etc.
  
  ErrorInfo() = default;
  ErrorInfo(ErrorCode c, std::string msg)
      : code(c), message(std::move(msg)) {}
  ErrorInfo(ErrorCode c, std::string msg, std::string ctx)
      : code(c), message(std::move(msg)), context(std::move(ctx)) {}
  
  [[nodiscard]] bool ok() const { return code == ErrorCode::kOk; }
  [[nodiscard]] std::string full_message() const {
    if (context.empty()) {
      return message;
    }
    return context + ": " + message;
  }
};

/// Convenience constructor for errors.
inline ErrorInfo Error(ErrorCode code, std::string message) {
  return ErrorInfo(code, std::move(message));
}

inline ErrorInfo Error(ErrorCode code, std::string message, std::string context) {
  return ErrorInfo(code, std::move(message), std::move(context));
}

/// Result<T, E> - represents either a successful value of type T or an error of type E.
///
/// This is a simplified implementation that defaults to ErrorInfo as the error type.
/// For most LogicPilot use cases, ErrorInfo provides sufficient context.
template <typename T, typename E = ErrorInfo>
class Result {
 public:
  // Construct from a successful value
  Result(T value) : data_(std::move(value)) {}
  
  // Construct from an error
  Result(E error) : data_(std::move(error)) {}
  
  // Check if the result contains a value
  [[nodiscard]] bool ok() const {
    return std::holds_alternative<T>(data_);
  }
  
  // Explicit bool conversion (same as ok())
  explicit operator bool() const { return ok(); }
  
  // Access the value (undefined behavior if error)
  [[nodiscard]] T& value() & {
    return std::get<T>(data_);
  }
  
  [[nodiscard]] const T& value() const& {
    return std::get<T>(data_);
  }
  
  [[nodiscard]] T&& value() && {
    return std::move(std::get<T>(data_));
  }
  
  [[nodiscard]] const T&& value() const&& {
    return std::move(std::get<T>(data_));
  }
  
  // Access the error (undefined behavior if ok)
  [[nodiscard]] E& error() & {
    return std::get<E>(data_);
  }
  
  [[nodiscard]] const E& error() const& {
    return std::get<E>(data_);
  }
  
  // Get value or default
  template <typename U>
  [[nodiscard]] T value_or(U&& default_value) const& {
    if (ok()) {
      return value();
    }
    return static_cast<T>(std::forward<U>(default_value));
  }
  
  template <typename U>
  [[nodiscard]] T value_or(U&& default_value) && {
    if (ok()) {
      return std::move(value());
    }
    return static_cast<T>(std::forward<U>(default_value));
  }
  
  // Map: transform T -> U, keeping error type E
  template <typename F>
  auto map(F&& f) const -> Result<std::decay_t<std::invoke_result_t<F, const T&>>, E> {
    using NewT = std::decay_t<std::invoke_result_t<F, const T&>>;
    if (ok()) {
      return Result<NewT, E>(std::invoke(std::forward<F>(f), value()));
    }
    return Result<NewT, E>(error());
  }
  
  template <typename F>
  auto map(F&& f) -> Result<std::decay_t<std::invoke_result_t<F, T&&>>, E> {
    using NewT = std::decay_t<std::invoke_result_t<F, T&&>>;
    if (ok()) {
      return Result<NewT, E>(std::invoke(std::forward<F>(f), std::move(value())));
    }
    return Result<NewT, E>(std::move(error()));
  }
  
  // And then: chain operations, short-circuiting on error
  template <typename F>
  auto and_then(F&& f) const -> std::invoke_result_t<F, const T&> {
    if (ok()) {
      return std::invoke(std::forward<F>(f), value());
    }
    return std::invoke_result_t<F, const T&>(error());
  }
  
  template <typename F>
  auto and_then(F&& f) -> std::invoke_result_t<F, T&&> {
    if (ok()) {
      return std::invoke(std::forward<F>(f), std::move(value()));
    }
    return std::invoke_result_t<F, T&&>(std::move(error()));
  }
  
  // Or else: provide fallback on error
  template <typename F>
  Result or_else(F&& f) const& {
    if (ok()) {
      return *this;
    }
    return std::invoke(std::forward<F>(f), error());
  }
  
  template <typename F>
  Result or_else(F&& f) && {
    if (ok()) {
      return std::move(*this);
    }
    return std::invoke(std::forward<F>(f), std::move(error()));
  }

 private:
  std::variant<T, E> data_;
};

// Specialization for void success type
template <typename E>
class Result<void, E> {
 public:
  Result() : has_error_(false) {}
  Result(E error) : error_(std::move(error)), has_error_(true) {}
  
  [[nodiscard]] bool ok() const { return !has_error_; }
  explicit operator bool() const { return ok(); }
  
  [[nodiscard]] const E& error() const& { return error_; }
  [[nodiscard]] E& error() & { return error_; }
  [[nodiscard]] E&& error() && { return std::move(error_); }
  
  template <typename F>
  Result and_then(F&& f) const {
    if (ok()) {
      return std::invoke(std::forward<F>(f));
    }
    return Result(error_);
  }
  
  template <typename F>
  Result or_else(F&& f) const& {
    if (ok()) {
      return *this;
    }
    return std::invoke(std::forward<F>(f), error_);
  }
  
  template <typename F>
  Result or_else(F&& f) && {
    if (ok()) {
      return std::move(*this);
    }
    return std::invoke(std::forward<F>(f), std::move(error_));
  }

 private:
  E error_;
  bool has_error_;
};

// Helper to create successful results
template <typename T>
Result<std::decay_t<T>> Ok(T&& value) {
  return Result<std::decay_t<T>>(std::forward<T>(value));
}

inline Result<void> Ok() {
  return Result<void>();
}

}  // namespace logicpilot

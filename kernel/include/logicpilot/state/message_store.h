// Typed cross-method message arena.
//
// Scheduler events intentionally retain a compact uint64 payload. When a
// method needs more than an inline scalar, that payload is a MessageId into
// this replication-local arena. This avoids putting C++ objects in the event
// heap while preserving type, schema version, encoding, and origin metadata.
#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <limits>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace logicpilot {

using MessageId = std::uint64_t;
inline constexpr MessageId kInvalidMessageId = 0;

struct MessageEnvelope {
  std::string type_uri;
  std::uint32_t schema_version{1};
  std::string encoding{"application/octet-stream"};
  std::string source_method;
  std::vector<std::uint8_t> data;
};

// Runtime contract for a message type. A store only enforces contracts that
// have been explicitly registered; unregistered envelopes remain compatible
// with legacy/native methods that predate typed message declarations.
struct MessageTypeContract {
  std::string type_uri;
  std::uint32_t schema_version{1};
  std::string encoding;
};

class MessageSnapshotMigrationPlan {
 public:
  using Converter = std::function<bool(MessageEnvelope& message,
                                       std::string* error)>;

  bool rename_type(std::string source, std::string target) {
    if (source.empty() || target.empty()) return false;
    renames_[std::move(source)] = std::move(target);
    return true;
  }
  bool convert_type(std::string type_uri, Converter converter) {
    if (type_uri.empty() || !converter) return false;
    converters_[std::move(type_uri)] = std::move(converter);
    return true;
  }

  bool apply(std::span<const MessageEnvelope> source,
             std::vector<MessageEnvelope>& target,
             std::string* error = nullptr) const {
    if (error != nullptr) error->clear();
    target.clear();
    for (const MessageEnvelope& original : source) {
      MessageEnvelope migrated = original;
      if (const auto rename_it = renames_.find(migrated.type_uri);
          rename_it != renames_.end()) {
        migrated.type_uri = rename_it->second;
      }
      if (const auto converter_it = converters_.find(migrated.type_uri);
          converter_it != converters_.end()) {
        std::string conversion_error;
        if (!converter_it->second(migrated, &conversion_error)) {
          if (error != nullptr) {
            *error = conversion_error.empty() ? "message conversion failed"
                                               : conversion_error;
          }
          target.clear();
          return false;
        }
      }
      if (migrated.type_uri.empty()) {
        if (error != nullptr) *error = "message migration produced empty type";
        target.clear();
        return false;
      }
      target.push_back(std::move(migrated));
    }
    return true;
  }

 private:
  std::map<std::string, std::string> renames_;
  std::map<std::string, Converter> converters_;
};

class MessageStore {
public:
  bool register_type(MessageTypeContract contract, std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    if (contract.type_uri.empty() || contract.schema_version == 0) {
      if (error != nullptr) *error = "message type contract requires a URI and schema version";
      return false;
    }
    const auto it = contracts_.find(contract.type_uri);
    if (it != contracts_.end()) {
      if (it->second.schema_version == contract.schema_version &&
          it->second.encoding == contract.encoding) {
        return true;
      }
      if (error != nullptr) {
        *error = "message type contract conflicts for '" + contract.type_uri + "'";
      }
      return false;
    }
    contracts_.emplace(contract.type_uri, std::move(contract));
    return true;
  }

  [[nodiscard]] const MessageTypeContract* contract(std::string_view type_uri) const {
    const auto it = contracts_.find(std::string(type_uri));
    return it == contracts_.end() ? nullptr : &it->second;
  }

  [[nodiscard]] bool validate(const MessageEnvelope& message,
                              std::string* error = nullptr) const {
    if (error != nullptr) error->clear();
    if (message.type_uri.empty() || message.schema_version == 0) {
      if (error != nullptr) *error = "message requires a URI and schema version";
      return false;
    }
    const MessageTypeContract* expected = contract(message.type_uri);
    if (expected == nullptr) return true;
    if (expected->schema_version != message.schema_version) {
      if (error != nullptr) {
        *error = "message schema version mismatch for '" + message.type_uri +
                 "' (expected " + std::to_string(expected->schema_version) +
                 ", got " + std::to_string(message.schema_version) + ")";
      }
      return false;
    }
    if (!expected->encoding.empty() && expected->encoding != message.encoding) {
      if (error != nullptr) {
        *error = "message encoding mismatch for '" + message.type_uri + "'";
      }
      return false;
    }
    return true;
  }

  [[nodiscard]] MessageId publish(MessageEnvelope message) {
    last_error_.clear();
    if (!validate(message, &last_error_) ||
        messages_.size() >= std::numeric_limits<MessageId>::max()) {
      if (last_error_.empty()) last_error_ = "message store capacity exhausted";
      return kInvalidMessageId;
    }
    messages_.push_back(std::move(message));
    return static_cast<MessageId>(messages_.size());
  }

  [[nodiscard]] const MessageEnvelope* get(MessageId id) const {
    if (id == kInvalidMessageId || id > messages_.size())
      return nullptr;
    return &messages_[static_cast<std::size_t>(id - 1)];
  }

  [[nodiscard]] bool is_type(MessageId id, std::string_view type_uri,
                             std::uint32_t schema_version) const {
    const MessageEnvelope* message = get(id);
    return message != nullptr && message->type_uri == type_uri &&
           message->schema_version == schema_version;
  }

  void clear() {
    messages_.clear();
    contracts_.clear();
    last_error_.clear();
  }
  [[nodiscard]] std::size_t size() const { return messages_.size(); }
  [[nodiscard]] const std::string& last_error() const { return last_error_; }

  [[nodiscard]] std::vector<MessageEnvelope> snapshot() const {
    return messages_;
  }
  bool restore(std::vector<MessageEnvelope> messages, std::string* error = nullptr) {
    if (error != nullptr) error->clear();
    for (const MessageEnvelope& message : messages) {
      if (!validate(message, error)) {
        messages_.clear();
        return false;
      }
    }
    messages_ = std::move(messages);
    return true;
  }

private:
  std::vector<MessageEnvelope> messages_;
  std::map<std::string, MessageTypeContract> contracts_;
  std::string last_error_;
};

}  // namespace logicpilot

// Typed cross-method message arena.
//
// Scheduler events intentionally retain a compact uint64 payload. When a
// method needs more than an inline scalar, that payload is a MessageId into
// this replication-local arena. This avoids putting C++ objects in the event
// heap while preserving type, schema version, encoding, and origin metadata.
#pragma once

#include <cstdint>
#include <limits>
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

class MessageStore {
public:
  [[nodiscard]] MessageId publish(MessageEnvelope message) {
    if (message.type_uri.empty() || messages_.size() >= std::numeric_limits<MessageId>::max()) {
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

  void clear() { messages_.clear(); }
  [[nodiscard]] std::size_t size() const { return messages_.size(); }

private:
  std::vector<MessageEnvelope> messages_;
};

}  // namespace logicpilot

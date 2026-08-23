// Cross-partition event transport contract.
//
// The executor currently uses DeterministicPartitionTransport in-process. The
// interface deliberately carries all routing metadata needed by a future IPC
// or network transport, while receive() imposes one deterministic ordering at
// the conservative barrier.
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/port_event.h"

namespace logicpilot {

struct DevsPartitionEvent {
  SimTime at{SimTime::zero()};
  std::uint64_t epoch{0};
  std::uint32_t source_partition{0};
  std::uint32_t target_partition{0};
  std::uint32_t source_atom{0};
  std::uint32_t target_atom{0};
  PortId target_port{kInvalidPort};
  std::uint64_t payload{0};
  std::uint64_t sequence{0};
};

enum class PartitionPeerStatus : std::uint32_t {
  kIdle = 0,
  kActive = 1,
  kFailed = 2,
};

struct PartitionReplayRequest {
  std::uint64_t epoch{0};
  std::uint32_t source_partition{0};
  std::uint32_t target_partition{0};
  std::uint64_t first_missing_sequence{0};
  std::uint64_t observed_sequence{0};
};

template <std::size_t Capacity = 1024>
class PartitionReplayHistory {
  static_assert(Capacity >= 1, "PartitionReplayHistory capacity must be >= 1");

 public:
  void record(DevsPartitionEvent event) {
    if (events_.size() == Capacity) events_.pop_front();
    events_.push_back(std::move(event));
  }

  // Returns true only when every sequence in the requested inclusive range is
  // retained. The output is always sorted by sequence for deterministic resend.
  [[nodiscard]] bool replay(const PartitionReplayRequest& request,
                            std::vector<DevsPartitionEvent>& output) const {
    output.clear();
    if (request.observed_sequence < request.first_missing_sequence) return false;
    for (const DevsPartitionEvent& event : events_) {
      if (event.epoch == request.epoch &&
          event.source_partition == request.source_partition &&
          event.target_partition == request.target_partition &&
          event.sequence >= request.first_missing_sequence &&
          event.sequence <= request.observed_sequence) {
        output.push_back(event);
      }
    }
    std::sort(output.begin(), output.end(), [](const DevsPartitionEvent& left,
                                               const DevsPartitionEvent& right) {
      return left.sequence < right.sequence;
    });
    const std::uint64_t expected = request.observed_sequence -
                                   request.first_missing_sequence + 1;
    return output.size() == expected;
  }

  [[nodiscard]] std::size_t size() const { return events_.size(); }

 private:
  std::deque<DevsPartitionEvent> events_;
};

// Shared-memory-friendly control word. It contains no pointers or owning
// objects, so a platform adapter can placement-create it in a mapped region.
class PartitionPeerControl {
 public:
  void begin_epoch(std::uint64_t epoch, SimTime now) {
    status_.store(static_cast<std::uint32_t>(PartitionPeerStatus::kIdle),
                  std::memory_order_release);
    epoch_.store(epoch, std::memory_order_release);
    heartbeat_ns_.store(now.as_ns(), std::memory_order_release);
    sent_.store(0, std::memory_order_release);
    received_.store(0, std::memory_order_release);
    replay_pending_.store(false, std::memory_order_release);
    status_.store(static_cast<std::uint32_t>(PartitionPeerStatus::kActive),
                  std::memory_order_release);
  }

  [[nodiscard]] bool touch(std::uint64_t expected_epoch, SimTime now) {
    if (!active(expected_epoch)) return false;
    heartbeat_ns_.store(now.as_ns(), std::memory_order_release);
    sent_.fetch_add(1, std::memory_order_relaxed);
    return true;
  }

  [[nodiscard]] bool alive(std::uint64_t expected_epoch, SimTime now,
                           SimTime timeout) const {
    if (!active(expected_epoch)) return false;
    if (timeout.is_infinity()) return true;
    const std::int64_t heartbeat =
        heartbeat_ns_.load(std::memory_order_acquire);
    const std::int64_t current = now.as_ns();
    return current >= heartbeat && current - heartbeat <= timeout.as_ns();
  }

  void mark_received(std::uint64_t expected_epoch) {
    if (active(expected_epoch)) {
      received_.fetch_add(1, std::memory_order_relaxed);
    }
  }

  void mark_failed(std::uint64_t expected_epoch) {
    if (epoch_.load(std::memory_order_acquire) == expected_epoch) {
      status_.store(static_cast<std::uint32_t>(PartitionPeerStatus::kFailed),
                    std::memory_order_release);
    }
  }

  void request_replay(std::uint64_t expected_epoch, std::uint32_t source_partition,
                      std::uint32_t target_partition, std::uint64_t first_missing,
                      std::uint64_t observed) {
    if (!active(expected_epoch)) return;
    replay_source_.store(source_partition, std::memory_order_relaxed);
    replay_target_.store(target_partition, std::memory_order_relaxed);
    replay_first_missing_.store(first_missing, std::memory_order_relaxed);
    replay_observed_.store(observed, std::memory_order_relaxed);
    replay_pending_.store(true, std::memory_order_release);
  }

  [[nodiscard]] bool take_replay_request(PartitionReplayRequest& request) {
    if (!replay_pending_.exchange(false, std::memory_order_acq_rel)) return false;
    request.epoch = epoch();
    request.source_partition = replay_source_.load(std::memory_order_acquire);
    request.target_partition = replay_target_.load(std::memory_order_acquire);
    request.first_missing_sequence = replay_first_missing_.load(std::memory_order_acquire);
    request.observed_sequence = replay_observed_.load(std::memory_order_acquire);
    return true;
  }

  [[nodiscard]] bool active(std::uint64_t expected_epoch) const {
    return epoch_.load(std::memory_order_acquire) == expected_epoch &&
           status_.load(std::memory_order_acquire) ==
               static_cast<std::uint32_t>(PartitionPeerStatus::kActive);
  }
  [[nodiscard]] std::uint64_t epoch() const {
    return epoch_.load(std::memory_order_acquire);
  }
  [[nodiscard]] PartitionPeerStatus status() const {
    return static_cast<PartitionPeerStatus>(
        status_.load(std::memory_order_acquire));
  }
  [[nodiscard]] std::uint64_t sent() const {
    return sent_.load(std::memory_order_acquire);
  }
  [[nodiscard]] std::uint64_t received() const {
    return received_.load(std::memory_order_acquire);
  }

 private:
  alignas(64) std::atomic<std::uint64_t> epoch_{0};
  alignas(64) std::atomic<std::int64_t> heartbeat_ns_{0};
  std::atomic<std::uint32_t> status_{
      static_cast<std::uint32_t>(PartitionPeerStatus::kIdle)};
  std::atomic<std::uint64_t> sent_{0};
  std::atomic<std::uint64_t> received_{0};
  std::atomic<bool> replay_pending_{false};
  std::atomic<std::uint32_t> replay_source_{0};
  std::atomic<std::uint32_t> replay_target_{0};
  std::atomic<std::uint64_t> replay_first_missing_{0};
  std::atomic<std::uint64_t> replay_observed_{0};
};

namespace partition_transport_detail {

constexpr std::uint32_t kFrameMagic = 0x4C505458U;  // LPTX
constexpr std::uint8_t kFrameVersion = 1;
constexpr std::size_t kFrameSize = 4 + 1 + 8 + 8 + 5 * 4 + 8 + 8 + 8;

inline void append_u32(std::vector<std::uint8_t>& bytes,
                       std::uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}

inline void append_u64(std::vector<std::uint8_t>& bytes,
                       std::uint64_t value) {
  for (int shift = 0; shift < 64; shift += 8) {
    bytes.push_back(static_cast<std::uint8_t>(value >> shift));
  }
}

inline bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << shift;
  }
  return true;
}

inline bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
                     std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int shift = 0; shift < 64; shift += 8) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << shift;
  }
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

inline bool event_less(const DevsPartitionEvent& left,
                       const DevsPartitionEvent& right) {
  if (left.at != right.at) return left.at < right.at;
  if (left.sequence != right.sequence) return left.sequence < right.sequence;
  if (left.source_partition != right.source_partition) {
    return left.source_partition < right.source_partition;
  }
  if (left.source_atom != right.source_atom) {
    return left.source_atom < right.source_atom;
  }
  if (left.target_atom != right.target_atom) {
    return left.target_atom < right.target_atom;
  }
  return left.target_port < right.target_port;
}

}  // namespace partition_transport_detail

class DevsPartitionEventCodec {
 public:
  [[nodiscard]] static std::vector<std::uint8_t> encode(
      const DevsPartitionEvent& event) {
    using namespace partition_transport_detail;
    std::vector<std::uint8_t> bytes;
    bytes.reserve(kFrameSize);
    append_u32(bytes, kFrameMagic);
    bytes.push_back(kFrameVersion);
    append_u64(bytes, event.epoch);
    append_u64(bytes, static_cast<std::uint64_t>(event.at.as_ns()));
    append_u32(bytes, event.source_partition);
    append_u32(bytes, event.target_partition);
    append_u32(bytes, event.source_atom);
    append_u32(bytes, event.target_atom);
    append_u32(bytes, static_cast<std::uint32_t>(event.target_port));
    append_u64(bytes, event.payload);
    append_u64(bytes, event.sequence);
    append_u64(bytes, checksum(bytes));
    return bytes;
  }

  [[nodiscard]] static bool decode(std::span<const std::uint8_t> bytes,
                                   DevsPartitionEvent& event,
                                   std::string* error = nullptr) {
    using namespace partition_transport_detail;
    const auto fail = [&](const char* message) {
      if (error != nullptr) *error = message;
      return false;
    };
    if (error != nullptr) error->clear();
    if (bytes.size() != kFrameSize) return fail("invalid frame size");
    std::uint64_t expected_checksum = 0;
    std::size_t checksum_offset = bytes.size() - 8;
    if (!read_u64(bytes, checksum_offset, expected_checksum)) {
      return fail("invalid checksum field");
    }
    if (checksum(bytes.first(bytes.size() - 8)) != expected_checksum) {
      return fail("partition event checksum mismatch");
    }
    std::size_t offset = 0;
    std::uint32_t magic = 0;
    if (!read_u32(bytes, offset, magic) || magic != kFrameMagic ||
        offset >= bytes.size() || bytes[offset++] != kFrameVersion) {
      return fail("unsupported partition event frame");
    }
    std::uint64_t epoch = 0, at_raw = 0;
    std::uint32_t source_partition = 0, target_partition = 0;
    std::uint32_t source_atom = 0, target_atom = 0, target_port = 0;
    if (!read_u64(bytes, offset, epoch) ||
        !read_u64(bytes, offset, at_raw) ||
        !read_u32(bytes, offset, source_partition) ||
        !read_u32(bytes, offset, target_partition) ||
        !read_u32(bytes, offset, source_atom) ||
        !read_u32(bytes, offset, target_atom) ||
        !read_u32(bytes, offset, target_port) ||
        !read_u64(bytes, offset, event.payload) ||
        !read_u64(bytes, offset, event.sequence) ||
        target_port > std::numeric_limits<PortId>::max() ||
        at_raw > static_cast<std::uint64_t>(
                      std::numeric_limits<std::int64_t>::max())) {
      return fail("malformed partition event fields");
    }
    event.at = SimTime::from_ns(static_cast<std::int64_t>(at_raw));
    event.epoch = epoch;
    event.source_partition = source_partition;
    event.target_partition = target_partition;
    event.source_atom = source_atom;
    event.target_atom = target_atom;
    event.target_port = static_cast<PortId>(target_port);
    return offset == bytes.size() - 8 ? true : fail("trailing frame bytes");
  }
};

class IDevsPartitionTransport {
 public:
  virtual ~IDevsPartitionTransport() = default;

  virtual void send(DevsPartitionEvent event) = 0;
  [[nodiscard]] virtual std::vector<DevsPartitionEvent> receive(
      SimTime at, std::uint32_t target_partition) = 0;
  [[nodiscard]] virtual std::size_t pending() const = 0;
};

class DeterministicPartitionTransport final : public IDevsPartitionTransport {
 public:
  void send(DevsPartitionEvent event) override {
    pending_.push_back(std::move(event));
  }

  [[nodiscard]] std::vector<DevsPartitionEvent> receive(
      SimTime at, std::uint32_t target_partition) override {
    std::vector<DevsPartitionEvent> result;
    std::vector<DevsPartitionEvent> remaining;
    result.reserve(pending_.size());
    remaining.reserve(pending_.size());
    for (DevsPartitionEvent& event : pending_) {
      if (event.at == at && event.target_partition == target_partition) {
        result.push_back(std::move(event));
      } else {
        remaining.push_back(std::move(event));
      }
    }
    pending_ = std::move(remaining);
    std::sort(result.begin(), result.end(),
              partition_transport_detail::event_less);
    return result;
  }

  [[nodiscard]] std::size_t pending() const override { return pending_.size(); }

 private:
  std::vector<DevsPartitionEvent> pending_;
};

// Loopback adapter that exercises the exact wire framing used by a future
// shared-memory/IPC transport. Invalid frames are dropped and surfaced via
// healthy()/last_error() rather than being silently delivered.
class SerializedPartitionTransport final : public IDevsPartitionTransport {
 public:
  void send(DevsPartitionEvent event) override {
    frames_.push_back(DevsPartitionEventCodec::encode(event));
  }

  void send_frame(std::vector<std::uint8_t> frame) {
    frames_.push_back(std::move(frame));
  }

  [[nodiscard]] std::vector<DevsPartitionEvent> receive(
      SimTime at, std::uint32_t target_partition) override {
    std::vector<DevsPartitionEvent> result;
    std::vector<std::vector<std::uint8_t>> remaining;
    remaining.reserve(frames_.size());
    for (std::vector<std::uint8_t>& frame : frames_) {
      DevsPartitionEvent event;
      std::string error;
      if (!DevsPartitionEventCodec::decode(frame, event, &error)) {
        healthy_ = false;
        last_error_ = std::move(error);
        continue;
      }
      if (event.at == at && event.target_partition == target_partition) {
        result.push_back(event);
      } else {
        remaining.push_back(std::move(frame));
      }
    }
    frames_ = std::move(remaining);
    std::sort(result.begin(), result.end(),
              partition_transport_detail::event_less);
    return result;
  }

  [[nodiscard]] std::size_t pending() const override { return frames_.size(); }
  [[nodiscard]] bool healthy() const { return healthy_; }
  [[nodiscard]] const std::string& last_error() const { return last_error_; }

 private:
  std::vector<std::vector<std::uint8_t>> frames_;
  bool healthy_{true};
  std::string last_error_;
};

// Bounded sequence-number ring suitable for placement in a shared-memory
// region. The producer/consumer API performs no allocation after construction;
// the sequence protocol also works for multiple producers/consumers when the
// surrounding platform provides process-shared atomics.
template <std::size_t Capacity, std::size_t FrameBytes>
class PartitionFrameRing {
  static_assert(Capacity >= 2, "PartitionFrameRing capacity must be >= 2");
  static_assert(FrameBytes >= partition_transport_detail::kFrameSize,
                "PartitionFrameRing frame storage is too small");

  struct Slot {
    std::atomic<std::uint64_t> sequence{0};
    std::uint32_t size{0};
    std::array<std::uint8_t, FrameBytes> bytes{};
  };

 public:
  PartitionFrameRing() {
    for (std::uint64_t index = 0; index < Capacity; ++index) {
      slots_[index].sequence.store(index, std::memory_order_relaxed);
    }
  }

  PartitionFrameRing(const PartitionFrameRing&) = delete;
  PartitionFrameRing& operator=(const PartitionFrameRing&) = delete;

  [[nodiscard]] bool try_push(std::span<const std::uint8_t> frame) {
    if (frame.empty() || frame.size() > FrameBytes) return false;
    std::uint64_t position = enqueue_.load(std::memory_order_relaxed);
    for (;;) {
      Slot& slot = slots_[position % Capacity];
      const std::uint64_t sequence =
          slot.sequence.load(std::memory_order_acquire);
      const auto difference = static_cast<std::int64_t>(sequence - position);
      if (difference == 0) {
        if (enqueue_.compare_exchange_weak(
                position, position + 1, std::memory_order_relaxed,
                std::memory_order_relaxed)) {
          std::memcpy(slot.bytes.data(), frame.data(), frame.size());
          slot.size = static_cast<std::uint32_t>(frame.size());
          slot.sequence.store(position + 1, std::memory_order_release);
          return true;
        }
      } else if (difference < 0) {
        return false;  // full
      } else {
        position = enqueue_.load(std::memory_order_relaxed);
      }
    }
  }

  [[nodiscard]] bool try_pop(std::array<std::uint8_t, FrameBytes>& frame,
                             std::size_t& size) {
    std::uint64_t position = dequeue_.load(std::memory_order_relaxed);
    for (;;) {
      Slot& slot = slots_[position % Capacity];
      const std::uint64_t sequence =
          slot.sequence.load(std::memory_order_acquire);
      const auto difference =
          static_cast<std::int64_t>(sequence - (position + 1));
      if (difference == 0) {
        if (dequeue_.compare_exchange_weak(
                position, position + 1, std::memory_order_relaxed,
                std::memory_order_relaxed)) {
          size = slot.size;
          std::memcpy(frame.data(), slot.bytes.data(), size);
          slot.sequence.store(position + Capacity, std::memory_order_release);
          return true;
        }
      } else if (difference < 0) {
        return false;  // empty
      } else {
        position = dequeue_.load(std::memory_order_relaxed);
      }
    }
  }

  [[nodiscard]] std::size_t approximate_size() const {
    const std::uint64_t write = enqueue_.load(std::memory_order_acquire);
    const std::uint64_t read = dequeue_.load(std::memory_order_acquire);
    const std::uint64_t difference = write >= read ? write - read : 0;
    return static_cast<std::size_t>(
        std::min<std::uint64_t>(difference, Capacity));
  }

 private:
  alignas(64) std::atomic<std::uint64_t> enqueue_{0};
  alignas(64) std::atomic<std::uint64_t> dequeue_{0};
  std::array<Slot, Capacity> slots_{};
};

template <std::size_t Capacity = 256>
class PartitionReplayWindow {
  static_assert(Capacity >= 1, "PartitionReplayWindow capacity must be >= 1");
  struct Entry {
    std::uint64_t epoch{0};
    std::uint32_t source_partition{0};
    std::uint64_t sequence{0};
  };

 public:
  struct Observation {
    bool accepted{false};
    bool duplicate{false};
    bool gap{false};
    std::uint64_t expected_sequence{0};
    std::uint64_t observed_sequence{0};
  };

  void begin_epoch(std::uint64_t epoch) {
    epoch_ = epoch;
    size_ = 0;
    cursor_ = 0;
    watermarks_ = {};
  }

  [[nodiscard]] bool accept(std::uint64_t epoch,
                            std::uint32_t source_partition,
                            std::uint64_t sequence) {
    return observe(epoch, source_partition, sequence).accepted;
  }

  [[nodiscard]] Observation observe(std::uint64_t epoch,
                                    std::uint32_t source_partition,
                                    std::uint64_t sequence) {
    Observation observation;
    observation.observed_sequence = sequence;
    if (epoch != epoch_) return observation;
    for (std::size_t index = 0; index < size_; ++index) {
      const Entry& entry = entries_[index];
      if (entry.epoch == epoch &&
          entry.source_partition == source_partition &&
          entry.sequence == sequence) {
        observation.duplicate = true;
        return observation;
      }
    }
    for (Watermark& watermark : watermarks_) {
      if (watermark.valid && watermark.epoch == epoch &&
          watermark.source_partition == source_partition) {
        if (watermark.highest_sequence != std::numeric_limits<std::uint64_t>::max() &&
            sequence > watermark.highest_sequence + 1) {
          observation.gap = true;
          observation.expected_sequence = watermark.highest_sequence + 1;
        }
        watermark.highest_sequence = std::max(watermark.highest_sequence, sequence);
        break;
      }
      if (!watermark.valid) {
        watermark = Watermark{true, epoch, source_partition, sequence};
        break;
      }
    }
    const Entry value{epoch, source_partition, sequence};
    if (size_ < Capacity) {
      entries_[size_++] = value;
    } else {
      entries_[cursor_] = value;
      cursor_ = (cursor_ + 1) % Capacity;
    }
    observation.accepted = true;
    return observation;
  }

  [[nodiscard]] std::size_t size() const { return size_; }

 private:
  struct Watermark {
    bool valid{false};
    std::uint64_t epoch{0};
    std::uint32_t source_partition{0};
    std::uint64_t highest_sequence{0};
  };

  std::uint64_t epoch_{0};
  std::size_t size_{0};
  std::size_t cursor_{0};
  std::array<Entry, Capacity> entries_{};
  std::array<Watermark, Capacity> watermarks_{};
};

template <std::size_t Capacity = 64, std::size_t FrameBytes = 64>
class RingPartitionTransport final : public IDevsPartitionTransport {
 public:
  explicit RingPartitionTransport(
      PartitionFrameRing<Capacity, FrameBytes>& ring,
      PartitionPeerControl* peer = nullptr, std::uint64_t expected_epoch = 0,
      SimTime peer_timeout = SimTime::infinity(),
      bool enable_replay_window = false,
      PartitionReplayHistory<Capacity>* history = nullptr)
      : ring_(ring), peer_(peer), expected_epoch_(expected_epoch),
        peer_timeout_(peer_timeout), replay_enabled_(enable_replay_window),
        history_(history) {
    replay_.begin_epoch(expected_epoch_);
  }

  void begin_epoch(std::uint64_t epoch) {
    expected_epoch_ = epoch;
    replay_.begin_epoch(epoch);
    healthy_ = true;
    last_error_.clear();
  }

  void send(DevsPartitionEvent event) override {
    if (peer_ != nullptr && !peer_->touch(expected_epoch_, event.at)) {
      healthy_ = false;
      last_error_ = "partition peer epoch is not active";
      return;
    }
    if (peer_ != nullptr) event.epoch = expected_epoch_;
    const auto frame = DevsPartitionEventCodec::encode(event);
    if (!ring_.try_push(frame)) {
      healthy_ = false;
      last_error_ = "partition frame ring is full";
      return;
    }
    if (history_ != nullptr) history_->record(event);
  }

  [[nodiscard]] std::vector<DevsPartitionEvent> receive(
      SimTime at, std::uint32_t target_partition) override {
    std::vector<DevsPartitionEvent> result;
    if (peer_ != nullptr &&
        !peer_->alive(expected_epoch_, at, peer_timeout_)) {
      healthy_ = false;
      last_error_ = peer_->epoch() != expected_epoch_
                        ? "partition peer epoch mismatch"
                        : peer_->status() == PartitionPeerStatus::kFailed
                              ? "partition peer marked failed"
                        : "partition peer heartbeat timed out";
      return result;
    }
    for (DevsPartitionEvent& event : deferred_) {
      if (event.at == at && event.target_partition == target_partition) {
        result.push_back(event);
        if (peer_ != nullptr) peer_->mark_received(expected_epoch_);
      }
    }
    deferred_.erase(
        std::remove_if(deferred_.begin(), deferred_.end(),
                       [at, target_partition](const DevsPartitionEvent& event) {
                         return event.at == at &&
                                event.target_partition == target_partition;
                       }),
        deferred_.end());

    std::array<std::uint8_t, FrameBytes> frame{};
    std::size_t size = 0;
    while (ring_.try_pop(frame, size)) {
      DevsPartitionEvent event;
      std::string error;
      if (!DevsPartitionEventCodec::decode(
              std::span<const std::uint8_t>(frame.data(), size), event,
              &error)) {
        healthy_ = false;
        last_error_ = std::move(error);
        continue;
      }
      if (peer_ != nullptr && event.epoch != expected_epoch_) {
        healthy_ = false;
        last_error_ = "partition event epoch mismatch";
        continue;
      }
      if (replay_enabled_) {
        const auto observation = replay_.observe(event.epoch, event.source_partition,
                                                 event.sequence);
        if (!observation.accepted) continue;  // duplicate or stale replay
        if (observation.gap) {
          healthy_ = false;
          last_error_ = "partition event sequence gap (expected " +
                        std::to_string(observation.expected_sequence) + " got " +
                        std::to_string(observation.observed_sequence) + ")";
          if (peer_ != nullptr) {
            peer_->request_replay(expected_epoch_, event.source_partition,
                                  target_partition, observation.expected_sequence,
                                  observation.observed_sequence);
          }
        }
      }
      if (event.at == at && event.target_partition == target_partition) {
        result.push_back(event);
        if (peer_ != nullptr) peer_->mark_received(expected_epoch_);
      } else {
        deferred_.push_back(std::move(event));
      }
    }
    std::sort(result.begin(), result.end(),
              partition_transport_detail::event_less);
    return result;
  }

  [[nodiscard]] std::size_t pending() const override {
    return ring_.approximate_size() + deferred_.size();
  }
  [[nodiscard]] bool healthy() const { return healthy_; }
  [[nodiscard]] const std::string& last_error() const { return last_error_; }

 private:
  PartitionFrameRing<Capacity, FrameBytes>& ring_;
  std::vector<DevsPartitionEvent> deferred_;
  PartitionPeerControl* peer_{nullptr};
  std::uint64_t expected_epoch_{0};
  SimTime peer_timeout_{SimTime::infinity()};
  bool replay_enabled_{false};
  PartitionReplayHistory<Capacity>* history_{nullptr};
  PartitionReplayWindow<Capacity> replay_;
  bool healthy_{true};
  std::string last_error_;
};

}  // namespace logicpilot

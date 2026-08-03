// EventHandlerRegistry - index-addressed event dispatch table.
//
// Handlers are registered once during model setup (cold path). Events only
// store a HandlerId, so the per-event hot path costs one bounds-checked
// indirect call instead of a std::function invocation.
#pragma once

#include <cassert>
#include <functional>
#include <vector>

#include "logicpilot/core/scheduler/event.h"

namespace logicpilot {

class EventHandlerRegistry {
 public:
  using Handler = std::function<void(const Event&)>;

  // Register a handler; returns its stable id. Registration is a cold-path
  // operation (model setup), so std::function storage here is acceptable.
  HandlerId add(Handler handler) {
    const auto id = static_cast<HandlerId>(handlers_.size());
    handlers_.push_back(std::move(handler));
    return id;
  }

  [[nodiscard]] std::size_t size() const { return handlers_.size(); }

  void dispatch(const Event& event) const {
    assert(event.handler < handlers_.size());
    const Handler& h = handlers_[event.handler];
    assert(h);
    h(event);
  }

  const Handler& at(HandlerId id) const {
    assert(id < handlers_.size());
    return handlers_[id];
  }

  void clear() { handlers_.clear(); }

 private:
  std::vector<Handler> handlers_;
};

}  // namespace logicpilot

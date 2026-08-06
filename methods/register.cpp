// register_all_methods implementation (see methods/register.h).
#include "register.h"

#include "logicpilot/runtime/method_registry.h"
#include "process_runtime.h"
#include "statechart_runtime.h"

namespace logicpilot {

void register_all_methods() {
  register_builtin_methods();
  register_process_method();
  register_statechart_method();
}

}  // namespace logicpilot

// register_all_methods implementation (see methods/register.h).
//
// Each built-in method plugin is guarded by the LP_WITH_METHOD_* compile
// definition that the matching LOGICPILOT_METHOD_* CMake option sets. A
// driver linked against a pruned aggregate simply registers fewer methods;
// models requesting a disabled method fail with KR1004 at run time.
#include "register.h"

#include "logicpilot/runtime/method_registry.h"
#if defined(LP_WITH_METHOD_AGENT)
#include "agent_runtime.h"
#endif
#if defined(LP_WITH_METHOD_PROCESS)
#include "process_runtime.h"
#endif
#if defined(LP_WITH_METHOD_SD)
#include "sd_runtime.h"
#endif
#if defined(LP_WITH_METHOD_STATECHART)
#include "statechart_runtime.h"
#endif

namespace logicpilot {

void register_all_methods() {
  register_builtin_methods();
#if defined(LP_WITH_METHOD_AGENT)
  register_agent_method();
#endif
#if defined(LP_WITH_METHOD_SD)
  register_sd_method();
#endif
#if defined(LP_WITH_METHOD_PROCESS)
  register_process_method();
#endif
#if defined(LP_WITH_METHOD_STATECHART)
  register_statechart_method();
#endif
}

}  // namespace logicpilot

// Registration entry of the kernel-native DEVS method runtime (ADR-0068
// Phase B). The core never auto-registers it: drivers and tests opt in via
// register_all_methods() (methods/register.h) or this declaration.
#pragma once

namespace logicpilot {

// Idempotent; safe to call from any driver or test before lowering.
void register_builtin_methods();

}  // namespace logicpilot

// Built-in method runtime registration (Method Runtime Layer).
//
// register_all_methods() registers every linked method plugin (kernel-native
// devs/agent/sd + the process and statechart method libraries) into the
// MethodRegistry. Drivers (lpcli / lp-server) call it once at startup;
// tests call it before lowering models through build_replication_model().
#pragma once

namespace logicpilot {

void register_all_methods();

}  // namespace logicpilot

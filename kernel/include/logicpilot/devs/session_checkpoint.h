// Legacy structured DEVS checkpoints, kept OUT of the neutral core
// (ADR-0068 Phase A).
//
// The modern, method-neutral contract lives on SimulationSession itself
// (save_method_checkpoint / restore_method_checkpoint over
// MethodCheckpoint bundles). These free functions remain for callers that
// specifically need the structured DevsCheckpoint of a single DEVS runtime:
// they perform the same KR1012/KR1013/KR1014/KR1015 gating the former
// session methods applied and reach the runtime through the
// CheckpointedDevRuntime capability interface instead of a hard-wired
// SimulationMethod virtual.
#pragma once

#include <string>
#include <vector>

#include "logicpilot/devs/checkpoint.h"
#include "logicpilot/runtime/runtime_diagnostics.h"

namespace logicpilot {

class SimulationSession;

namespace devs {

bool save_session_checkpoint(
    SimulationSession& session, DevsCheckpoint& checkpoint,
    std::string* error = nullptr,
    std::vector<RuntimeDiagnostic>* diagnostics = nullptr);

bool restore_session_checkpoint(
    SimulationSession& session, const DevsCheckpoint& checkpoint,
    std::string* error = nullptr,
    std::vector<RuntimeDiagnostic>* diagnostics = nullptr);

}  // namespace devs
}  // namespace logicpilot

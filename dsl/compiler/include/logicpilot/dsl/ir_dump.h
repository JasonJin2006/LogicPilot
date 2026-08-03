// Structural dump of a loaded ModelFile (deterministic text rendering).
//
// FlatBuffers binary layout is construction-order sensitive, so golden
// regression compares this textual structure instead of raw bytes.
#pragma once

#include <string>

#include "logicpilot/devs/ir_loader.h"

namespace logicpilot::dsl {

// Render the whole model tree: kinds, names, nodes, distributions,
// couplings, params. Stable field order; one line per fact.
[[nodiscard]] std::string dump_ir(const IrModelFile& file);

}  // namespace logicpilot::dsl

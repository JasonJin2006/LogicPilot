// Machine-readable serialization of the model's declared experiments
// (IR v2 direction; v1 carries them as a compile sidecar, not in the frozen
// F1 IR). Consumed by the AI optimizer so the search is model-driven:
//
//   { "experiments": [ { "name": "Optimization", "objective": "minimize",
//     "metric": "Wq", "variable": "servers", "range": [1, 4],
//     "budget": 20 } ] }
#pragma once

#include <string>
#include <vector>

#include "logicpilot/dsl/ast.h"

namespace logicpilot::dsl {

[[nodiscard]] std::string experiments_to_json(
    const std::vector<ExperimentDecl>& experiments);

}  // namespace logicpilot::dsl

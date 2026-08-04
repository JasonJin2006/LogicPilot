// IR v2 migration converters (Phase B, process path).
//
// The runtime keeps consuming the frozen v1 views; a v2 ModelFile (thin Node
// container + SemanticsRef, schemas/ir_v2.fbs) is translated back into a v1
// buffer on load, so every existing engine runs v2 files unchanged. The
// v1 -> v2 direction lets the DSL compiler emit v2 (lowering dual-write via
// `lpcli compile --ir-version 2`).
//
// v2 process models are represented as a root Node { semantics: process/model,
// children: [ resource Nodes, flow Node ] } where the flow Node's children are
// source/queue/service block Nodes with typed Var params. Other libraries
// (devs/agent/equation) are not yet convertible and produce an error.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace logicpilot {

// Rebuild a v1 ModelFile buffer from a v2 ModelFile buffer (process path).
// Returns empty with `error` filled on invalid input / unsupported blocks.
[[nodiscard]] std::vector<std::uint8_t> convert_v2_to_v1(
    const std::uint8_t* data, std::size_t size, std::string* error = nullptr);

// Rebuild a v2 ModelFile buffer from a v1 ModelFile buffer (process path).
[[nodiscard]] std::vector<std::uint8_t> convert_v1_to_v2(
    const std::uint8_t* data, std::size_t size, std::string* error = nullptr);

}  // namespace logicpilot

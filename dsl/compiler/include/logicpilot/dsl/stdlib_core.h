// Generated from libraries/core.lplib by
// scripts/gen-stdlib-header.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the library file: node scripts/gen-stdlib-header.mjs
#pragma once

namespace logicpilot::dsl {

// Embedded core library source: the spatial markup blocks. Its own header
// because it is hand written rather than catalog-generated, and because the
// registry loads it separately so the two can be reasoned about apart.
// Stored in chunks because MSVC rejects single string literals beyond ~16 KiB.
inline const char* const kStdlibCoreChunks[] = {
    R"lp(// Core spatial markup, declared as a library instead of as compiler code.
//
// `node` and `path` are the two declaration kinds whose entire handling is data:
// no ports, a handful of typed fields, and a lowering that emits a plain
// {library, block} node from the declared shape. They were nonetheless hardcoded
// in the compiler's kind dispatch next to the kinds that genuinely need code
// (`agent`, `continuous`, `statechart` each lower to a dedicated IR structure),
// with the result that the language core owned an AnyLogic spatial formalism it
// does not fully implement: `z` was validated as a numeric constant and then
// dropped on the floor, because the kernel's NodePos is two-dimensional.
//
// Declaring them here makes the two properties that mattered true at once: the
// compiler's kind list no longer names a formalism, and a `z` a model declares
// reaches the IR instead of vanishing between validation and lowering.
//
// The library is called `core` because that is what the IR has always carried for
// these kinds (`{core, node}` / `{core, path}`). The kernel, the compiler's IR
// goldens and the IDE's 3D projection all key on it, so the name is part of the
// contract rather than a label chosen now.
//
// Hand written, unlike libraries/process.lplib which is generated from
// libraries/pml-catalog.json.
library core {
  version = 1

  // `node <Name> { x = <f>; y = <f>; z = <f> }` - a place the path network
  // connects, in the model's own units. The kernel's path solver reads x/y (its
  // NodePos is 2D); z is carried so a model that declares it round-trips.
  block node {
    x: float = 0
    y: float = 0
    z: float = 0
  }

  // `path <Name> { node1 = <Node>; node2 = <Node> }` - a straight network segment
  // between two places, weighted by the Euclidean distance between them. The two
  // fields are references to node names, so a quoted string is rejected rather
  // than silently becoming a dangling edge.
  block path {
    node1: ref = ""
    node2: ref = ""
  }
})lp"
};

inline std::string stdlib_core_source() {
  std::string source;
  for (const char* chunk : kStdlibCoreChunks) {
    source += chunk;
  }
  return source;
}

}  // namespace logicpilot::dsl

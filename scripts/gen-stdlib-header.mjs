// Regenerate dsl/compiler/include/logicpilot/dsl/stdlib_process.h from
// libraries/process.lplib (ADR-0005-style checked-in generated artifact).
// The compiler embeds this file as the builtin process-library registry.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const source = readFileSync(`${root}/libraries/process.lplib`, 'utf8');
const header = `// Generated from libraries/process.lplib by
// scripts/gen-stdlib-header.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the library file: node scripts/gen-stdlib-header.mjs
#pragma once

namespace logicpilot::dsl {

// Embedded standard process library source (block shapes). The compiler
// loads it into the block registry at analyze time.
inline const char* kStdlibProcessSource = R"lp(
${source.trimEnd()}
)lp";

}  // namespace logicpilot::dsl
`;
writeFileSync(`${root}/dsl/compiler/include/logicpilot/dsl/stdlib_process.h`,
              header);
console.log('wrote dsl/compiler/include/logicpilot/dsl/stdlib_process.h');

// Regenerate dsl/compiler/include/logicpilot/dsl/stdlib_process.h from
// libraries/process.lplib (ADR-0005-style checked-in generated artifact).
// The compiler embeds this file as the builtin process-library registry.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const source = readFileSync(`${root}/libraries/process.lplib`, 'utf8');

// Split the embedded library source into chunked string literals: MSVC
// caps single string literals (raw included) well below our catalog-driven
// library size, so the header stores chunks and the loader joins them.
const CHUNK_SIZE = 8000;
const chunks = [];
for (let offset = 0; offset < source.length; offset += CHUNK_SIZE) {
  chunks.push(source.slice(offset, offset + CHUNK_SIZE));
}
const chunkArray = chunks
  .map((chunk) => `    R"lp(${chunk})lp"`)
  .join(',\n');

const header = `// Generated from libraries/process.lplib by
// scripts/gen-stdlib-header.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the library file: node scripts/gen-stdlib-header.mjs
#pragma once

namespace logicpilot::dsl {

// Embedded standard process library source (block shapes). The compiler
// loads it into the block registry at analyze time. Stored in chunks
// because MSVC rejects single string literals beyond ~16 KiB.
inline const char* const kStdlibProcessChunks[] = {
${chunkArray}
};

inline std::string stdlib_process_source() {
  std::string source;
  for (const char* chunk : kStdlibProcessChunks) {
    source += chunk;
  }
  return source;
}

}  // namespace logicpilot::dsl
`;
writeFileSync(`${root}/dsl/compiler/include/logicpilot/dsl/stdlib_process.h`,
              header);
console.log('wrote dsl/compiler/include/logicpilot/dsl/stdlib_process.h');

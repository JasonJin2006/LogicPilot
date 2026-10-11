// Regenerate the embedded standard-library headers from libraries/*.lplib
// (ADR-0005-style checked-in generated artifacts):
//
//   libraries/process.lplib -> dsl/compiler/include/logicpilot/dsl/stdlib_process.h
//   libraries/core.lplib    -> dsl/compiler/include/logicpilot/dsl/stdlib_core.h
//
// The compiler embeds both as its builtin library registry. They are separate
// headers because they are separate libraries with separate provenance: process
// is catalog-generated, core is hand written, and each needs its own accessor.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the latter stays percent-encoded, so a
// checkout under a path with spaces or non-ASCII characters broke this
// generator before it could open the library file.
const root = fileURLToPath(new URL('..', import.meta.url));

// Split the embedded library source into chunked string literals: MSVC
// caps single string literals (raw included) well below our catalog-driven
// library size, so the header stores chunks and the loader joins them.
const CHUNK_SIZE = 8000;

function emit({ lplib, header, accessor, chunks, doc }) {
  const source = readFileSync(`${root}/libraries/${lplib}`, 'utf8');
  const literals = [];
  for (let offset = 0; offset < source.length; offset += CHUNK_SIZE) {
    literals.push(source.slice(offset, offset + CHUNK_SIZE));
  }
  const chunkArray = literals.map((chunk) => `    R"lp(${chunk})lp"`).join(',\n');

  const text = `// Generated from libraries/${lplib} by
// scripts/gen-stdlib-header.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the library file: node scripts/gen-stdlib-header.mjs
#pragma once

namespace logicpilot::dsl {

${doc}
inline const char* const ${chunks}[] = {
${chunkArray}
};

inline std::string ${accessor}() {
  std::string source;
  for (const char* chunk : ${chunks}) {
    source += chunk;
  }
  return source;
}

}  // namespace logicpilot::dsl
`;
  writeFileSync(`${root}/dsl/compiler/include/logicpilot/dsl/${header}`, text);
  console.log(`wrote dsl/compiler/include/logicpilot/dsl/${header}`);
}

emit({
  lplib: 'process.lplib',
  header: 'stdlib_process.h',
  accessor: 'stdlib_process_source',
  chunks: 'kStdlibProcessChunks',
  doc:
    '// Embedded standard process library source (block shapes). The compiler\n' +
    '// loads it into the block registry at analyze time. Stored in chunks\n' +
    '// because MSVC rejects single string literals beyond ~16 KiB.',
});
emit({
  lplib: 'core.lplib',
  header: 'stdlib_core.h',
  accessor: 'stdlib_core_source',
  chunks: 'kStdlibCoreChunks',
  doc:
    '// Embedded core library source: the spatial markup blocks. Its own header\n' +
    '// because it is hand written rather than catalog-generated, and because the\n' +
    '// registry loads it separately so the two can be reasoned about apart.\n' +
    '// Stored in chunks because MSVC rejects single string literals beyond ~16 KiB.',
});
